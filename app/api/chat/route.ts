import { getAuthenticatedUser, getAdminDb, getProjectRole, getUserDisplayName, hasSystemRole } from '@/lib/api/firebase-server-helpers'
import { buildSystemPrompt } from '@/lib/agent/system-prompt'
import { fetchPrototypeFeedback } from '@/lib/api/prototype-feedback'
import { loadAttachmentBlocks, type AttachmentBlock, type DroppedAttachment } from '@/lib/agent/attachments'
import { AGENT_MODEL, AGENT_MAX_TOKENS, AGENT_TEMPERATURE } from '@/lib/agent/constants'
import { logAnthropicCall } from '@/lib/observability/anthropic'
import { accumulateSessionUsage } from '@/lib/observability/session-cost'
import Anthropic from '@anthropic-ai/sdk'
import type { BriefContent, BriefRole } from '@/lib/types'

// Debounce window for maker-activity notifications. The cron at /api/cron/notify
// sends a digest email only once notify_after has passed with no new messages.
const NOTIFY_DEBOUNCE_MS = 5 * 60 * 1000

function getAnthropic() {
  return new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
}

// Small helper so every error path returns a parseable JSON envelope (never a
// raw framework HTML 500). The client reads `error` off this — see
// useStreamingChat's tolerant error handling.
function jsonError(error: string, status: number) {
  return new Response(JSON.stringify({ error }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

// Turns dropped-attachment info into a note the agent acts on, so it tells the
// maker "I couldn't open that file" instead of silently saying nothing came
// through. Phrased as context (not a command) per Opus-4.x guidance.
function buildAttachmentNote(dropped: DroppedAttachment[]): string {
  const phrase = (d: DroppedAttachment) => {
    switch (d.reason) {
      case 'unsupported':
        return `"${d.filename}" (a format I can't open — PDFs, images, text, and Word docs work)`
      case 'pending':
        return `"${d.filename}" (the upload may not have finished)`
      default:
        return `"${d.filename}" (I couldn't read the file)`
    }
  }
  const list = dropped.map(phrase).join('; ')
  return (
    `<attachment_note>The maker tried to attach a file I could not read: ${list}. ` +
    `Briefly let them know you couldn't open it and suggest re-sending it as a PDF ` +
    `(or pasting the text directly). Do not pretend you can see its contents.</attachment_note>`
  )
}

// Thin wrapper: everything before the SSE response runs synchronously and can
// throw (Firestore reads, attachment loads, prompt assembly). A raw throw here
// would surface as a framework HTML 500 that the client can't parse — so we
// catch and return a JSON envelope. Errors during streaming are handled
// separately inside the ReadableStream (chat_stream_error).
export async function POST(request: Request) {
  try {
    return await handleChat(request)
  } catch (err) {
    console.error('chat_request_error', {
      message: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
    })
    return jsonError('Something went wrong. Please try again.', 500)
  }
}

async function handleChat(request: Request): Promise<Response> {
  const auth = await getAuthenticatedUser(request)
  if (auth.error) return auth.error

  let body
  try {
    body = await request.json()
  } catch {
    return jsonError('Invalid JSON body', 400)
  }
  const { session_id, content, file_ids } = body

  if (!session_id || (!content?.trim() && (!file_ids || file_ids.length === 0))) {
    return jsonError('session_id and content (or file_ids) are required', 400)
  }

  const db = getAdminDb()

  // Look up session → project, verify membership (chat = maker+)
  const sessionDoc = await db.collection('sessions').doc(session_id).get()
  if (!sessionDoc.exists) {
    return jsonError('Session not found', 404)
  }

  const projectId = sessionDoc.data()?.project_id
  const projectDoc = await db.collection('projects').doc(projectId).get()
  const projectData = projectDoc.data() || {}

  const role = await getProjectRole(db, projectId, auth.uid, auth.email, auth.systemRoles, auth)
  if (!projectDoc.exists || !role) {
    return jsonError('Not found', 404)
  }

  const now = new Date().toISOString()
  const senderDisplayName = await getUserDisplayName(db, auth.uid, auth.email)

  // Store the user message
  await db.collection('messages').add({
    session_id,
    role: 'user',
    content: content?.trim() || '',
    sender_email: auth.email,
    sender_display_name: senderDisplayName,
    ...(file_ids?.length && { file_ids }),
    created_at: now,
    updated_at: now,
  })

  // Capture the previous maker-message timestamp BEFORE we overwrite it below,
  // so we can pass the real time-gap into the system prompt for the
  // welcome-back recap (#26). Otherwise the gap would always be ~0.
  const previousMakerMessageAt = projectData.last_maker_message_at as string | undefined | null

  // Queue a debounced notification + record the maker timestamp for idle-based
  // brief regeneration. The cron at /api/cron/notify picks up projects where
  // notify_after has passed and sends a single digest email; the same cron
  // also auto-regenerates the brief when last_maker_message_at is older than
  // 10 minutes and the brief is stale.
  if (!hasSystemRole(auth, 'admin')) {
    const notifyAfter = new Date(Date.now() + NOTIFY_DEBOUNCE_MS).toISOString()
    const existingPending = projectData.notify_pending_since as string | undefined | null
    await db.collection('projects').doc(projectId).update({
      notify_after: notifyAfter,
      notify_pending_since: existingPending || now,
      last_maker_message_at: now,
      // Maker has engaged — reset the auto-reminder cycle so the next prepped
      // session starts fresh (cron at /api/cron/maker-reminders reads these).
      reminders_sent_count: 0,
      last_reminder_sent_at: null,
      updated_at: now,
    })
  }

  // Load conversation history for this session
  const messagesSnap = await db
    .collection('messages')
    .where('session_id', '==', session_id)
    .orderBy('created_at', 'asc')
    .get()

  const storedMessages = messagesSnap.docs.map((doc) => {
    const data = doc.data()
    return {
      role: data.role as 'user' | 'agent',
      content: (data.content as string) || '',
      file_ids: (data.file_ids as string[] | undefined) || [],
      sender_email: (data.sender_email as string | undefined) || '',
      sender_display_name: (data.sender_display_name as string | undefined) || '',
    }
  })

  // Multi-human brief: when more than one distinct person has posted in this
  // session, Claude needs to tell the speakers apart. We prefix each user turn
  // with the speaker's name. Solo sessions stay byte-identical (no prefix) so
  // single-maker behavior never regresses.
  const humanSenders = new Set(
    storedMessages.filter((m) => m.role === 'user' && m.sender_email).map((m) => m.sender_email)
  )
  const multiHuman = humanSenders.size > 1
  const speakerName = (m: { sender_display_name: string; sender_email: string }) =>
    m.sender_display_name || m.sender_email.split('@')[0] || 'Someone'
  const prefixUser = (
    m: { role: 'user' | 'agent'; content: string; sender_display_name: string; sender_email: string },
    fallback: string
  ) => {
    const text = m.content || fallback
    if (m.role !== 'user' || !multiHuman || !text) return text
    return `${speakerName(m)}: ${text}`
  }

  // For user messages with attachments, fetch each file from S3 and inline it
  // into the Claude content array as a document/image block. Files attached
  // to earlier turns stay in context on every subsequent turn (Anthropic
  // prompt caching, set per-block in the helper, keeps this affordable).
  type TextBlock = { type: 'text'; text: string; cache_control?: { type: 'ephemeral' } }
  type ContentBlock = AttachmentBlock | TextBlock
  type ClaudeMessage = {
    role: 'user' | 'assistant'
    content: string | ContentBlock[]
  }
  let assembled: { message: ClaudeMessage; dropped: DroppedAttachment[] }[]
  try {
    assembled = await Promise.all(
      storedMessages.map(async (m): Promise<{ message: ClaudeMessage; dropped: DroppedAttachment[] }> => {
        const role = m.role === 'user' ? 'user' : 'assistant'
        if (role === 'user' && m.file_ids.length > 0) {
          const { blocks, dropped } = await loadAttachmentBlocks(db, m.file_ids, projectId)
          if (blocks.length > 0) {
            const contentBlocks: ContentBlock[] = [...blocks]
            contentBlocks.push({ type: 'text', text: prefixUser(m, '(file attached)') })
            return { message: { role, content: contentBlocks }, dropped }
          }
          return { message: { role, content: prefixUser(m, '') }, dropped }
        }
        return { message: { role, content: prefixUser(m, '') }, dropped: [] }
      }),
    )
  } catch (err) {
    if (err instanceof Error && err.message.startsWith('attachments_too_large')) {
      return jsonError('Attachments exceed the 25MB per-message limit.', 413)
    }
    throw err
  }
  const claudeMessages: ClaudeMessage[] = assembled.map((a) => a.message)

  // If the maker referenced files we couldn't read, annotate the most recent
  // user turn that had drops with a note so the agent surfaces it instead of
  // claiming nothing came through. Only the latest such turn is annotated, so
  // the agent doesn't re-nag about files dropped earlier in the conversation.
  for (let i = assembled.length - 1; i >= 0; i--) {
    if (storedMessages[i].role !== 'user' || assembled[i].dropped.length === 0) continue
    const note: ContentBlock = { type: 'text', text: buildAttachmentNote(assembled[i].dropped) }
    const existing = claudeMessages[i].content
    claudeMessages[i] = {
      role: claudeMessages[i].role,
      content: Array.isArray(existing)
        ? [...existing, note]
        : existing
          ? [{ type: 'text', text: existing }, note]
          : [note],
    }
    break
  }

  // Claude requires conversations to start with a user message.
  // With a welcome message, the first stored message is 'assistant'.
  if (claudeMessages.length > 0 && claudeMessages[0].role === 'assistant') {
    claudeMessages.unshift({ role: 'user', content: 'Hi' })
  }

  // Anthropic caps cache_control markers at 4 per request. Place ONE marker
  // on the last block of the most recent user message that has attachments.
  // The cache then covers the entire prefix (history + all attachments) and
  // is reused on subsequent turns. With 16+ attachments, tagging each block
  // 400s the request — see attachments.ts.
  for (let i = claudeMessages.length - 1; i >= 0; i--) {
    const m = claudeMessages[i]
    if (m.role !== 'user' || !Array.isArray(m.content) || m.content.length === 0) continue
    const hasAttachment = m.content.some((b) => b.type === 'document' || b.type === 'image')
    if (!hasAttachment) continue
    const lastBlock = m.content[m.content.length - 1]
    lastBlock.cache_control = { type: 'ephemeral' }
    break
  }

  // Count sessions for this project to determine session number
  const sessionsSnap = await db
    .collection('sessions')
    .where('project_id', '==', projectId)
    .orderBy('created_at', 'asc')
    .get()
  const sessionIds = sessionsSnap.docs.map((d) => d.id)
  const sessionNumber = sessionIds.indexOf(session_id) + 1

  // Load current brief if exists
  let briefContent: BriefContent | null = null
  const briefSnap = await db
    .collection('briefs')
    .where('project_id', '==', projectId)
    .orderBy('version', 'desc')
    .limit(1)
    .get()
  if (!briefSnap.empty) {
    briefContent = briefSnap.docs[0].data().content as BriefContent
  }

  // Build system prompt — read config from session (snapshotted), fall back to project
  const sessionData = sessionDoc.data() || {}
  const projectContext = projectData.context as string | null || null
  const seedQuestions = (sessionData.seed_questions ?? projectData.seed_questions) as string[] | undefined
  const builderDirectives = (sessionData.builder_directives ?? projectData.builder_directives) as string[] | undefined
  const sessionMode = (sessionData.session_mode ?? projectData.session_mode) as 'discover' | 'converge' | undefined
  const layoutMockups = (sessionData.layout_mockups ?? projectData.layout_mockups) as import('@/lib/types').WireframeMockup[] | undefined
  const identity = (sessionData.identity ?? projectData.identity) as string | undefined
  // Maker name + time-gap are read live (not snapshotted into the session)
  // so name edits and real elapsed time reflect on every turn.
  const makerFirstName = projectData.requester_first_name as string | undefined
  const makerLastName = projectData.requester_last_name as string | undefined
  const gapSinceLastMakerMessageMs = previousMakerMessageAt
    ? Date.now() - new Date(previousMakerMessageAt).getTime()
    : undefined

  // Multi-human roster for the system prompt: who has actually posted in this
  // session, in first-appearance order, tagged with their brief_role. Only
  // built when 2+ humans are present, so solo sessions do one fewer read and
  // keep the existing single-maker framing.
  let participants: { name: string; brief_role: BriefRole | null }[] | undefined
  if (multiHuman) {
    const membersSnap = await db
      .collection('project_members')
      .where('project_id', '==', projectId)
      .get()
    const roleByEmail = new Map(
      membersSnap.docs.map((d) => [d.data().email as string, (d.data().brief_role as BriefRole | null) ?? null])
    )
    const seen = new Map<string, string>()
    for (const m of storedMessages) {
      if (m.role !== 'user' || !m.sender_email || seen.has(m.sender_email)) continue
      seen.set(m.sender_email, speakerName(m))
    }
    participants = [...seen].map(([email, name]) => ({ name, brief_role: roleByEmail.get(email) ?? null }))
  }

  // #72: ground Sam in what the maker actually reported from the running
  // prototype (Loop feedback, keyed by slug) instead of confabulating.
  const prototypeFeedback = await fetchPrototypeFeedback(
    db,
    projectData.slug as string | undefined,
    Date.now(),
  )

  const systemPrompt = buildSystemPrompt({
    briefContent,
    projectContext,
    sessionNumber,
    seedQuestions,
    builderDirectives,
    sessionMode,
    layoutMockups,
    identity,
    makerFirstName,
    makerLastName,
    gapSinceLastMakerMessageMs,
    participants,
    prototypeFeedback,
  })

  // Stream response from Claude
  const stream = getAnthropic().messages.stream({
    model: AGENT_MODEL,
    system: systemPrompt,
    messages: claudeMessages,
    max_tokens: AGENT_MAX_TOKENS,
    temperature: AGENT_TEMPERATURE,
  })

  const encoder = new TextEncoder()
  let fullResponse = ''
  const streamStart = Date.now()

  const readable = new ReadableStream({
    async start(controller) {
      try {
        for await (const event of stream) {
          if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
            fullResponse += event.delta.text
            const chunk = `data: ${JSON.stringify({ text: event.delta.text })}\n\n`
            controller.enqueue(encoder.encode(chunk))
          }
        }

        // Store the complete agent response
        const responseTime = new Date().toISOString()
        await db.collection('messages').add({
          session_id,
          role: 'agent',
          content: fullResponse,
          created_at: responseTime,
          updated_at: responseTime,
        })

        // Track token usage + model on the session
        const finalMessage = await stream.finalMessage()
        if (finalMessage.usage) {
          const sessionRef = db.collection('sessions').doc(session_id)
          const currentSession = (await sessionRef.get()).data() || {}
          const usage = {
            input_tokens: finalMessage.usage.input_tokens,
            output_tokens: finalMessage.usage.output_tokens,
            cache_read_input_tokens: finalMessage.usage.cache_read_input_tokens ?? 0,
            cache_creation_input_tokens: finalMessage.usage.cache_creation_input_tokens ?? 0,
          }
          await sessionRef.update({
            ...accumulateSessionUsage(currentSession, usage, AGENT_MODEL),
            model: AGENT_MODEL,
            updated_at: responseTime,
          })

          void logAnthropicCall({
            project_id: projectId,
            route: 'chat',
            model: AGENT_MODEL,
            usage,
            duration_ms: Date.now() - streamStart,
            session_id,
          })
        }

        controller.enqueue(encoder.encode('data: [DONE]\n\n'))
        controller.close()
      } catch (err) {
        // Surface Anthropic's status + message body so future failures are
        // diagnosable from runtime logs alone, not just the SDK error name.
        const anthropicStatus =
          err && typeof err === 'object' && 'status' in err ? (err as { status: number }).status : undefined
        const anthropicError =
          err && typeof err === 'object' && 'error' in err
            ? (err as { error: unknown }).error
            : undefined
        console.error('chat_stream_error', {
          session_id,
          project_id: projectId,
          anthropic_status: anthropicStatus,
          anthropic_error: anthropicError,
          message: err instanceof Error ? err.message : String(err),
        })
        controller.error(err)
      }
    },
  })

  return new Response(readable, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  })
}
