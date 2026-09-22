import { NextResponse } from 'next/server'
import { getAdminDb } from '@/lib/firebase/admin'
import { authorizeIntegration, integrationError } from '@/lib/api/integration-auth'
import { parseListQuery, parseSend } from '@/lib/integration/validate'
import {
  claimSend,
  findReplyTo,
  getGroup,
  getParticipant,
  listMessages,
  releaseClaim,
  writeReply,
  type GroupRow,
} from '@/lib/integration/store'
import { generateFacilitatorReply } from '@/lib/integration/facilitator'
import { toWireMessage, type MessageRow } from '@/lib/integration/types'

// Group conversation API for stars-demo round two (contract 08a §2). No
// Firebase auth, no project membership, no sessions/messages/briefs: every
// read and write is scoped to the integration_* collections.

function logError(requestId: string, op: string, err: unknown) {
  console.error('integration_error', { request_id: requestId, op, name: err instanceof Error ? err.name : typeof err })
}

// List (08a §2). A topic never ensured lists as empty with a sentinel version.
export async function GET(request: Request) {
  const auth = authorizeIntegration(request)
  if (!auth.ok) return auth.response
  const { namespace, requestId } = auth

  const input = parseListQuery(new URL(request.url))
  if (!input) return integrationError(requestId, 'invalid_request')

  try {
    const db = getAdminDb()
    const group = await getGroup(db, namespace, input.round, input.topic_id)
    if (!group) {
      return NextResponse.json({ round: input.round, topic_id: input.topic_id, version: 'none', messages: [] })
    }
    const messages = await listMessages(db, group.id)
    return NextResponse.json({
      round: input.round,
      topic_id: input.topic_id,
      version: group.version,
      messages: messages.map(toWireMessage),
    })
  } catch (err) {
    logError(requestId, 'list', err)
    return integrationError(requestId, 'unavailable')
  }
}

// Send (08a §2): participant message first under the key-derived document
// with a claim token, then exactly one facilitator reply via compare-and-set.
// Before the message exists, failures are 4xx/503; after it exists, the only
// non-success answer is 202 reply_pending (08a §4).
export async function POST(request: Request) {
  const auth = authorizeIntegration(request)
  if (!auth.ok) return auth.response
  const { namespace, requestId } = auth

  let input
  try {
    input = parseSend(await request.json())
  } catch {
    input = null
  }
  if (!input) return integrationError(requestId, 'invalid_request')
  const { round, topic_id } = input

  const db = getAdminDb()
  const respond = (version: string, message: MessageRow, reply: MessageRow) =>
    NextResponse.json({ round, topic_id, version, message: toWireMessage(message), reply: toWireMessage(reply) })

  // Phase 1 — policy checks and the claim. Nothing is written until claimSend.
  let claim: Awaited<ReturnType<typeof claimSend>>
  let group: GroupRow
  try {
    const [g, participant] = await Promise.all([
      getGroup(db, namespace, round, topic_id),
      getParticipant(db, namespace, round, input.participant_id),
    ])
    if (!g || !participant || !participant.topic_ids.includes(topic_id)) {
      return integrationError(requestId, 'forbidden')
    }
    if (participant.author_label !== input.author_label) return integrationError(requestId, 'invalid_request')
    if (input.seen_version !== undefined && input.seen_version !== g.version) {
      return integrationError(requestId, 'stale')
    }
    group = g
    claim = await claimSend(db, {
      namespace,
      group,
      participant_id: input.participant_id,
      author_label: participant.author_label,
      idempotency_key: input.idempotency_key,
      body: input.body,
      now: new Date().toISOString(),
    })
  } catch (err) {
    logError(requestId, 'send', err)
    return integrationError(requestId, 'unavailable')
  }
  if (claim.outcome === 'mismatch') return integrationError(requestId, 'invalid_request')

  // Phase 2 — the message exists. From here every failure is reply_pending.
  try {
    if (claim.outcome !== 'created') {
      const existing = await findReplyTo(db, group.id, claim.message.id)
      if (existing) {
        if (claim.outcome === 'claimed') await releaseClaim(db, claim.message.id)
        const fresh = (await getGroup(db, namespace, round, topic_id))!
        return respond(fresh.version, claim.message, existing)
      }
      if (claim.outcome === 'busy') return integrationError(requestId, 'reply_pending')
    }

    const history = await listMessages(db, group.id)
    const result = await generateFacilitatorReply({
      groupId: group.id,
      topicTitle: input.topic_title,
      topicPrompt: input.topic_prompt,
      history,
    })
    if (!result.ok) {
      await releaseClaim(db, claim.message.id)
      return integrationError(requestId, 'reply_pending')
    }

    const participantIds = [...new Set(history.filter((m) => m.kind === 'participant').map((m) => m.author_id))]
    const written = await writeReply(db, {
      group,
      messageId: claim.message.id,
      token: claim.token,
      body: result.body,
      participantIds,
      now: new Date().toISOString(),
    })
    if (written.won) return respond(written.version, claim.message, written.reply)

    // Lost the compare-and-set: a later retry re-claimed and (maybe) wrote.
    const winner = await findReplyTo(db, group.id, claim.message.id)
    if (!winner) return integrationError(requestId, 'reply_pending')
    const fresh = (await getGroup(db, namespace, round, topic_id))!
    return respond(fresh.version, claim.message, winner)
  } catch (err) {
    logError(requestId, 'send', err)
    try {
      await releaseClaim(db, claim.message.id)
    } catch {
      // best effort; the claim expires on its own
    }
    return integrationError(requestId, 'reply_pending')
  }
}
