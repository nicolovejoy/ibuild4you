import { getAuthenticatedUser, getAdminDb, getProjectRole, getUserDisplayName } from '@/lib/api/firebase-server-helpers'
import { buildSystemPrompt } from '@/lib/agent/system-prompt'
import { fetchPrototypeFeedback } from '@/lib/api/prototype-feedback'
import { AGENT_MODEL, AGENT_MAX_TOKENS, AGENT_TEMPERATURE } from '@/lib/agent/constants'
import { logAnthropicCall } from '@/lib/observability/anthropic'
import { accumulateSessionUsage } from '@/lib/observability/session-cost'
import Anthropic from '@anthropic-ai/sdk'
import type { BriefContent, BriefRole, WireframeMockup } from '@/lib/types'

// Agent kickoff (#31). When a maker opens a stale session, the frontend calls
// this route to have the agent greet them first — typing indicator + a
// name-aware recap (#26/#27) — without the maker having to type. It mirrors
// /api/chat's context load but: stores no maker message, touches no
// notify/reminder timestamps, and ends the conversation with a synthetic user
// turn so Claude's user-first rule is satisfied without polluting history.
//
// Guards against the infinite-reload / multi-tab loop via last_kickoff_at on
// the session: once we've greeted a given "return", we refuse to greet again
// until the maker actually speaks. The route is the authority — the client
// predicate (lib/agent/kickoff.ts) is just an optimization to avoid the call.

// Anthropic isn't constructed at module load so tests can run without the key.
function getAnthropic() {
  return new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
}

const KICKOFF_DEBOUNCE_MS = 30 * 1000

// 200 no-op: the client should not surface an error when a kickoff is correctly
// declined (already greeted, maker mid-turn, multi-tab race). It just renders
// the existing messages.
function noop(reason: string) {
  return new Response(JSON.stringify({ kicked_off: false, reason }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
}

export async function POST(request: Request) {
  const auth = await getAuthenticatedUser(request)
  if (auth.error) return auth.error

  const body = await request.json()
  const { session_id } = body
  if (!session_id) {
    return new Response(JSON.stringify({ error: 'session_id is required' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  const db = getAdminDb()

  const sessionDoc = await db.collection('sessions').doc(session_id).get()
  if (!sessionDoc.exists) {
    return new Response(JSON.stringify({ error: 'Session not found' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  const sessionData = sessionDoc.data() || {}
  const projectId = sessionData.project_id
  const projectDoc = await db.collection('projects').doc(projectId).get()
  const projectData = projectDoc.data() || {}

  const role = await getProjectRole(db, projectId, auth.uid, auth.email, auth.systemRoles, auth)
  if (!projectDoc.exists || !role) {
    return new Response(JSON.stringify({ error: 'Not found' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
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
      created_at: (data.created_at as string) || '',
      sender_email: (data.sender_email as string | undefined) || '',
      sender_display_name: (data.sender_display_name as string | undefined) || '',
    }
  })

  // --- Guards (server is the authority; mirrors lib/agent/kickoff.ts) ---
  // The maker is mid-turn if the last stored message is theirs — don't
  // interrupt. An empty session is fine: since #70 a return session starts with
  // no canned welcome, and we still want to greet if the project has history.
  if (storedMessages.length > 0) {
    const last = storedMessages[storedMessages.length - 1]
    if (last.role !== 'agent') return noop('maker_mid_turn')
  }

  // Prior maker activity to recap — judged at the project level, not just this
  // session (so a blank return session still qualifies). A true first-ever
  // session (no history anywhere) is declined; the welcome message greets them.
  const makerMessages = storedMessages.filter((m) => m.role === 'user')
  const lastMakerInSessionMs = makerMessages.reduce((max, m) => {
    const t = m.created_at ? new Date(m.created_at).getTime() : 0
    return t > max ? t : max
  }, 0)
  const projectLastMakerAt = projectData.last_maker_message_at as string | undefined | null
  const projectLastMakerMs = projectLastMakerAt ? new Date(projectLastMakerAt).getTime() : 0
  const lastMakerAtMs = Math.max(lastMakerInSessionMs, projectLastMakerMs)
  if (!lastMakerAtMs) return noop('no_maker_history')

  const lastKickoffAt = sessionData.last_kickoff_at as string | undefined | null
  const lastKickoffMs = lastKickoffAt ? new Date(lastKickoffAt).getTime() : 0
  // Already greeted this return — the maker hasn't spoken since our last
  // kickoff. This is what kills the reload loop (gap is measured from the maker
  // message, which doesn't move when we post a greeting).
  if (lastKickoffMs && lastKickoffMs >= lastMakerAtMs) return noop('already_kicked_off')
  // Multi-tab burst.
  if (lastKickoffMs && Date.now() - lastKickoffMs < KICKOFF_DEBOUNCE_MS) return noop('debounced')

  // Stamp last_kickoff_at NOW, before streaming, so a concurrent tab's request
  // refuses immediately instead of double-greeting.
  const now = new Date().toISOString()
  await db.collection('sessions').doc(session_id).update({ last_kickoff_at: now, updated_at: now })

  // --- Build the Claude conversation (text-only history) ---
  // Multi-human: prefix user turns with the speaker's name so Claude can tell
  // collaborators apart (matches /api/chat). Solo sessions stay unprefixed.
  const humanSenders = new Set(
    storedMessages.filter((m) => m.role === 'user' && m.sender_email).map((m) => m.sender_email),
  )
  const multiHuman = humanSenders.size > 1
  const speakerName = (m: { sender_display_name: string; sender_email: string }) =>
    m.sender_display_name || m.sender_email.split('@')[0] || 'Someone'

  const claudeMessages: { role: 'user' | 'assistant'; content: string }[] = storedMessages
    .filter((m) => m.content)
    .map((m) => {
      const role = m.role === 'user' ? ('user' as const) : ('assistant' as const)
      const content = role === 'user' && multiHuman ? `${speakerName(m)}: ${m.content}` : m.content
      return { role, content }
    })

  // Claude requires the conversation to start with a user message.
  if (claudeMessages.length > 0 && claudeMessages[0].role === 'assistant') {
    claudeMessages.unshift({ role: 'user', content: 'Hi' })
  }
  // Synthetic final user turn: satisfies the user-first rule and tells Claude
  // to greet now. Not stored — it never appears in the visible history. In a
  // multi-human brief we name the person who actually opened the session (the
  // authenticated caller) so Sam greets *them* specifically rather than
  // guessing — otherwise "the user" is ambiguous when several people share the
  // brief.
  const openerName = multiHuman ? await getUserDisplayName(db, auth.uid, auth.email) : null
  claudeMessages.push({
    role: 'user',
    content: openerName
      ? `(${openerName} just opened the session — greet them by name, picking up where things left off.)`
      : '(The user just opened the session — greet them now, picking up where things left off.)',
  })

  // --- Session number, brief, config → system prompt (mirrors /api/chat) ---
  const sessionsSnap = await db
    .collection('sessions')
    .where('project_id', '==', projectId)
    .orderBy('created_at', 'asc')
    .get()
  const sessionNumber = sessionsSnap.docs.map((d) => d.id).indexOf(session_id) + 1

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

  const projectContext = (projectData.context as string | null) || null
  const seedQuestions = (sessionData.seed_questions ?? projectData.seed_questions) as string[] | undefined
  const builderDirectives = (sessionData.builder_directives ?? projectData.builder_directives) as string[] | undefined
  const sessionMode = (sessionData.session_mode ?? projectData.session_mode) as 'discover' | 'converge' | undefined
  const layoutMockups = (sessionData.layout_mockups ?? projectData.layout_mockups) as WireframeMockup[] | undefined
  const identity = (sessionData.identity ?? projectData.identity) as string | undefined
  const makerFirstName = projectData.requester_first_name as string | undefined
  const makerLastName = projectData.requester_last_name as string | undefined

  // Gap drives the "Returning after a break" recap (#26). Read from the project
  // timestamp like /api/chat — but here we never overwrite it (no maker turn).
  const previousMakerMessageAt = projectData.last_maker_message_at as string | undefined | null
  const gapSinceLastMakerMessageMs = previousMakerMessageAt
    ? Date.now() - new Date(previousMakerMessageAt).getTime()
    : lastMakerAtMs
      ? Date.now() - lastMakerAtMs
      : undefined

  let participants: { name: string; brief_role: BriefRole | null }[] | undefined
  if (multiHuman) {
    const membersSnap = await db.collection('project_members').where('project_id', '==', projectId).get()
    const roleByEmail = new Map(
      membersSnap.docs.map((d) => [d.data().email as string, (d.data().brief_role as BriefRole | null) ?? null]),
    )
    const seen = new Map<string, string>()
    for (const m of storedMessages) {
      if (m.role !== 'user' || !m.sender_email || seen.has(m.sender_email)) continue
      seen.set(m.sender_email, speakerName(m))
    }
    participants = [...seen].map(([email, name]) => ({ name, brief_role: roleByEmail.get(email) ?? null }))
  }

  // #72: ground the kickoff recap in real prototype feedback too.
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

  // --- Stream + store the agent greeting ---
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
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({ text: event.delta.text })}\n\n`))
          }
        }

        const responseTime = new Date().toISOString()
        await db.collection('messages').add({
          session_id,
          role: 'agent',
          content: fullResponse,
          created_at: responseTime,
          updated_at: responseTime,
        })

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
            route: 'chat/kickoff',
            model: AGENT_MODEL,
            usage,
            duration_ms: Date.now() - streamStart,
            session_id,
          })
        }

        controller.enqueue(encoder.encode('data: [DONE]\n\n'))
        controller.close()
      } catch (err) {
        const anthropicStatus =
          err && typeof err === 'object' && 'status' in err ? (err as { status: number }).status : undefined
        const anthropicError =
          err && typeof err === 'object' && 'error' in err ? (err as { error: unknown }).error : undefined
        console.error('kickoff_stream_error', {
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
