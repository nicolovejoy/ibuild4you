import { getAuthenticatedUser, getAdminDb, getProjectRole, getUserDisplayName, hasSystemRole } from '@/lib/api/firebase-server-helpers'
import { buildSystemPrompt } from '@/lib/agent/system-prompt'
import { loadAttachmentBlocks, type AttachmentBlock } from '@/lib/agent/attachments'
import { AGENT_MODEL, AGENT_MAX_TOKENS, AGENT_TEMPERATURE } from '@/lib/agent/constants'
import Anthropic from '@anthropic-ai/sdk'
import type { BriefContent } from '@/lib/types'

// Debounce window for maker-activity notifications. The cron at /api/cron/notify
// sends a digest email only once notify_after has passed with no new messages.
const NOTIFY_DEBOUNCE_MS = 5 * 60 * 1000

function getAnthropic() {
  return new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
}

export async function POST(request: Request) {
  const auth = await getAuthenticatedUser(request)
  if (auth.error) return auth.error

  const body = await request.json()
  const { session_id, content, file_ids } = body

  if (!session_id || (!content?.trim() && (!file_ids || file_ids.length === 0))) {
    return new Response(JSON.stringify({ error: 'session_id and content (or file_ids) are required' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  const db = getAdminDb()

  // Look up session → project, verify membership (chat = maker+)
  const sessionDoc = await db.collection('sessions').doc(session_id).get()
  if (!sessionDoc.exists) {
    return new Response(JSON.stringify({ error: 'Session not found' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  const projectId = sessionDoc.data()?.project_id
  const projectDoc = await db.collection('projects').doc(projectId).get()
  const projectData = projectDoc.data() || {}

  const role = await getProjectRole(db, projectId, auth.uid, auth.email, auth.systemRoles)
  if (!projectDoc.exists || !role) {
    return new Response(JSON.stringify({ error: 'Not found' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    })
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

  // Queue a debounced notification. The cron at /api/cron/notify picks up projects
  // where notify_after has passed and sends a single digest email.
  if (!hasSystemRole(auth, 'admin')) {
    const notifyAfter = new Date(Date.now() + NOTIFY_DEBOUNCE_MS).toISOString()
    const existingPending = projectData.notify_pending_since as string | undefined | null
    await db.collection('projects').doc(projectId).update({
      notify_after: notifyAfter,
      notify_pending_since: existingPending || now,
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
    }
  })

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
  let claudeMessages: ClaudeMessage[]
  try {
    claudeMessages = await Promise.all(
      storedMessages.map(async (m): Promise<ClaudeMessage> => {
        const role = m.role === 'user' ? 'user' : 'assistant'
        if (role === 'user' && m.file_ids.length > 0) {
          const blocks = await loadAttachmentBlocks(db, m.file_ids, projectId)
          if (blocks.length > 0) {
            const contentBlocks: ContentBlock[] = [...blocks]
            contentBlocks.push({ type: 'text', text: m.content || '(file attached)' })
            return { role, content: contentBlocks }
          }
        }
        return { role, content: m.content }
      }),
    )
  } catch (err) {
    if (err instanceof Error && err.message.startsWith('attachments_too_large')) {
      return new Response(
        JSON.stringify({ error: 'Attachments exceed the 25MB per-message limit.' }),
        { status: 413, headers: { 'Content-Type': 'application/json' } },
      )
    }
    throw err
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
  const systemPrompt = buildSystemPrompt({
    briefContent,
    projectContext,
    sessionNumber,
    seedQuestions,
    builderDirectives,
    sessionMode,
    layoutMockups,
    identity,
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
          const prevInput = (currentSession.token_usage_input as number) || 0
          const prevOutput = (currentSession.token_usage_output as number) || 0
          await sessionRef.update({
            token_usage_input: prevInput + finalMessage.usage.input_tokens,
            token_usage_output: prevOutput + finalMessage.usage.output_tokens,
            model: AGENT_MODEL,
            updated_at: responseTime,
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
