import { toLocale } from '@/lib/locale'
import { getAuthenticatedUser, getAdminDb, getProjectRole, getUserDisplayName } from '@/lib/api/firebase-server-helpers'
import { countsAsMakerActivity } from '@/lib/projects/project-view'
import { buildSystemPromptParts } from '@/lib/agent/system-prompt'
import { fetchUnfoldedNotes } from '@/lib/api/brief-notes'
import { fetchPrototypeFeedback } from '@/lib/api/prototype-feedback'
import { fetchPrototypeContext } from '@/lib/api/prototype-context'
import { fetchPinnedArtifacts } from '@/lib/api/artifact-context'
import { fetchSiblingDecisions } from '@/lib/api/sibling-decisions'
import { fetchPreviousConversations } from '@/lib/api/previous-conversations'
import { cacheSystemPrompt } from '@/lib/agent/prompt-cache'
import { resolveChatModel, chatModelOptions } from '@/lib/agent/model-config'
import { logAnthropicCall } from '@/lib/observability/anthropic'
import { accumulateSessionUsage } from '@/lib/observability/session-cost'
import Anthropic from '@anthropic-ai/sdk'
import { isArchivedSession } from '@/lib/sessions/active'
import { isUnqueuedReturn } from '@/lib/sessions/queued'
import { unqueuedGreeting } from '@/lib/sessions/unqueued-greeting'
import { sendUnqueuedNotification } from '@/lib/email/unqueued-notify'
import type { BriefContent, BriefRole } from '@/lib/types'

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

  // Kickoff is maker re-engagement (#110): a builder/admin opening the
  // participant view shouldn't consume it — the solo-maker greeting would name
  // the absent maker, and last_kickoff_at would block the real greeting later.
  if (!countsAsMakerActivity(role)) return noop('builder_side_opener')

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

  // Opens with an agent message the maker hasn't answered — the welcome posted
  // at session creation (a return session with a welcome written for this
  // round). That is the greeting; don't add a second.
  if (storedMessages.length > 0 && makerMessages.length === 0) return noop('opener_already_posted')

  // Claim this return: read last_kickoff_at and stamp it in one transaction,
  // before streaming. A plain read-then-write let two requests 68ms apart both
  // pass the check and both greet (F4FC, 2026-10-17); inside a transaction the
  // second one re-reads, sees the first one's stamp, and declines.
  const now = new Date().toISOString()
  const sessionRef = db.collection('sessions').doc(session_id)
  const declined = await db.runTransaction(async (tx) => {
    const fresh = (await tx.get(sessionRef)).data() || {}
    const lastKickoffAt = fresh.last_kickoff_at as string | undefined | null
    const lastKickoffMs = lastKickoffAt ? new Date(lastKickoffAt).getTime() : 0
    // Already greeted this return — the maker hasn't spoken since our last
    // kickoff. This is what kills the reload loop (gap is measured from the maker
    // message, which doesn't move when we post a greeting).
    if (lastKickoffMs && lastKickoffMs >= lastMakerAtMs) return 'already_kicked_off'
    // Multi-tab burst.
    if (lastKickoffMs && Date.now() - lastKickoffMs < KICKOFF_DEBOUNCE_MS) return 'debounced'
    tx.update(sessionRef, { last_kickoff_at: now, updated_at: now })
    return null
  })
  if (declined) return noop(declined)

  // Nothing-queued path (#214): store + stream the canned greeting, flag the
  // maker as waiting, and email the builder once per session. Never touches
  // last_maker_message_at / notify_* (kickoff isn't maker activity).
  async function respondUnqueued() {
    const greeting = unqueuedGreeting(toLocale(projectData.language), projectData.requester_first_name as string | undefined)
    await db.collection('messages').add({
      session_id,
      role: 'agent',
      content: greeting,
      kind: 'unqueued_greeting',
      created_at: now,
      updated_at: now,
    })
    await db
      .collection('projects')
      .doc(projectId)
      .update({ maker_waiting_since: projectData.maker_waiting_since ?? now, updated_at: now })

    if (!sessionData.unqueued_notified_at) {
      await db.collection('sessions').doc(session_id).update({ unqueued_notified_at: now })
      try {
        await sendUnqueuedNotification({
          makerName: (projectData.requester_first_name as string | undefined) || 'Your maker',
          projectTitle: (projectData.title as string | undefined) || 'your brief',
          slug: projectData.slug as string,
          openedAt: now,
        })
      } catch (err) {
        console.error('[kickoff] unqueued notification failed:', err)
      }
    }

    const encoder = new TextEncoder()
    return new Response(
      new ReadableStream({
        start(controller) {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ text: greeting })}\n\n`))
          controller.enqueue(encoder.encode('data: [DONE]\n\n'))
          controller.close()
        },
      }),
      { headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' } },
    )
  }

  // #214: a return between rounds with nothing queued -> canned greeting, no
  // model. Mid-intake returns (the maker has spoken in this session and the
  // builder has not harvested the round) keep the normal recap greeting.
  if (isUnqueuedReturn({ project: projectData, sessionHasMakerMessage: makerMessages.length > 0 })) {
    return respondUnqueued()
  }

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
  const sessionIds = sessionsSnap.docs.filter((d) => !isArchivedSession(d.data())).map((d) => d.id)
  const sessionNumber = sessionIds.indexOf(session_id) + 1

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

  // #72: ground the kickoff recap in real prototype feedback + structural
  // page captures too.
  // Same block as /api/chat so the stable system prompt stays byte-identical
  // between the kickoff and the maker's first turn (cache read, not a rewrite).
  const [prototypeFeedback, prototypeContext, pinnedArtifacts, siblingDecisions, previousConversations, unfoldedNotes] = await Promise.all([
    fetchPrototypeFeedback(db, projectId, projectData.slug as string | undefined, Date.now()),
    fetchPrototypeContext(db, projectId, projectData.slug as string | undefined, Date.now()),
    fetchPinnedArtifacts(db, projectId),
    fetchSiblingDecisions(db, { id: projectId, github_repo: projectData.github_repo as string | undefined }),
    fetchPreviousConversations(db, sessionIds, session_id),
    fetchUnfoldedNotes(db, briefSnap.empty ? null : briefSnap.docs[0].id),
  ])

  const systemPrompt = buildSystemPromptParts({
    briefContent,
    projectContext,
    sessionNumber,
    seedQuestions,
    builderDirectives,
    sessionMode,
    identity,
    makerFirstName,
    makerLastName,
    gapSinceLastMakerMessageMs,
    participants,
    prototypeFeedback,
    prototypeContext,
    pinnedArtifacts,
    siblingDecisions,
    previousConversations,
    unfoldedNotes,
    // Read from the project (not the session snapshot) so a language set
    // after a session started still applies.
    language: toLocale(projectData.language),
  })

  // Cache the stable system block only. Kickoff never advances
  // last_maker_message_at, and the gap recap now rides in the uncached
  // volatile block, so the cached prefix here is byte-identical to the
  // maker's very next /api/chat turn — a real cache read. The messages end
  // in a synthetic turn that's never sent again, so marking them would only
  // pay the cache-write premium for no read — see lib/agent/prompt-cache.ts.
  const cachedSystem = cacheSystemPrompt(systemPrompt)

  // --- Stream + store the agent greeting ---
  const chatModel = resolveChatModel() // same override as /api/chat (#184)
  const stream = getAnthropic().messages.stream({
    model: chatModel,
    system: cachedSystem,
    messages: claudeMessages,
    ...chatModelOptions(chatModel),
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
        const finalMessage = await stream.finalMessage()
        // A greeting with no text (refusal, or the output budget spent on
        // thinking) is not stored: an empty agent turn in history is a 400
        // on every later /api/chat request. last_kickoff_at stays stamped, so
        // the maker simply starts the conversation themselves.
        if (!fullResponse.trim()) {
          console.warn('kickoff_empty_response', { session_id, stop_reason: finalMessage.stop_reason })
        } else {
          await db.collection('messages').add({
            session_id,
            role: 'agent',
            content: fullResponse,
            created_at: responseTime,
            updated_at: responseTime,
          })
        }

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
            ...accumulateSessionUsage(currentSession, usage, chatModel),
            model: chatModel,
            updated_at: responseTime,
          })

          void logAnthropicCall({
            project_id: projectId,
            route: 'chat/kickoff',
            model: chatModel,
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
