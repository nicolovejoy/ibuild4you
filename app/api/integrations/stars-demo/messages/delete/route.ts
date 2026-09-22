import { NextResponse } from 'next/server'
import { getAdminDb } from '@/lib/firebase/admin'
import { authorizeIntegration, integrationError } from '@/lib/api/integration-auth'
import { parseDelete } from '@/lib/integration/validate'
import { deleteMessageCascade, getGroup, getMessage, getOp, getParticipant, putOp } from '@/lib/integration/store'

// Owner-scoped hard delete (08a §2): the participant's own message plus the
// facilitator replies answering it. Already-gone is success with []. A replay
// returns the original removed IDs paired with the group's current version.
export async function POST(request: Request) {
  const auth = authorizeIntegration(request)
  if (!auth.ok) return auth.response
  const { namespace, requestId } = auth

  let input
  try {
    input = parseDelete(await request.json())
  } catch {
    input = null
  }
  if (!input) return integrationError(requestId, 'invalid_request')

  const db = getAdminDb()
  try {
    const [group, participant] = await Promise.all([
      getGroup(db, namespace, input.round, input.topic_id),
      getParticipant(db, namespace, input.round, input.participant_id),
    ])
    if (!group || !participant || !participant.topic_ids.includes(input.topic_id)) {
      return integrationError(requestId, 'forbidden')
    }

    const replay = await getOp(db, namespace, input.idempotency_key)
    if (replay) return NextResponse.json({ ...replay, version: group.version })

    const now = new Date().toISOString()
    const message = await getMessage(db, input.message_id)
    let removed: string[] = []
    let version = group.version
    if (message && message.group_id === group.id) {
      if (message.kind !== 'participant' || message.author_id !== input.participant_id) {
        return integrationError(requestId, 'forbidden')
      }
      ;({ removed, version } = await deleteMessageCascade(db, group, message, now))
    }
    const stored = { round: input.round, topic_id: input.topic_id, removed_message_ids: removed }
    await putOp(db, { namespace, round: input.round, key: input.idempotency_key, kind: 'delete', response: stored, now })
    return NextResponse.json({ ...stored, version })
  } catch (err) {
    console.error('integration_error', {
      request_id: requestId,
      op: 'delete',
      name: err instanceof Error ? err.name : typeof err,
    })
    return integrationError(requestId, 'unavailable')
  }
}
