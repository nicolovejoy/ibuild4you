import { NextResponse } from 'next/server'
import { getAdminDb } from '@/lib/firebase/admin'
import { authorizeIntegration, integrationError } from '@/lib/api/integration-auth'
import { parseEnsure } from '@/lib/integration/validate'
import { createParticipant, ensureGroup, getParticipant } from '@/lib/integration/store'

// Ensure participant (08a §7): register the opaque participant and label for
// the round and create the topic groups lazily. Idempotent by (namespace,
// participant_id): a re-run leaves the record untouched and reports
// created: false. No key, no integration_ops record.
export async function POST(request: Request) {
  const auth = authorizeIntegration(request)
  if (!auth.ok) return auth.response
  const { namespace, requestId } = auth

  let input
  try {
    input = parseEnsure(await request.json())
  } catch {
    input = null
  }
  if (!input) return integrationError(requestId, 'invalid_request')

  const db = getAdminDb()
  try {
    const now = new Date().toISOString()
    const existing = await getParticipant(db, namespace, input.round, input.participant_id)
    if (existing) {
      return NextResponse.json({
        round: input.round,
        participant_id: input.participant_id,
        topic_ids: existing.topic_ids,
        created: false,
      })
    }
    for (const topic of input.topic_ids) await ensureGroup(db, namespace, input.round, topic, now)
    const created = await createParticipant(db, {
      namespace,
      round: input.round,
      participant_id: input.participant_id,
      author_label: input.author_label,
      topic_ids: input.topic_ids,
      created_at: now,
    })
    const stored = created
      ? input.topic_ids
      : (await getParticipant(db, namespace, input.round, input.participant_id))!.topic_ids
    return NextResponse.json({ round: input.round, participant_id: input.participant_id, topic_ids: stored, created })
  } catch (err) {
    console.error('integration_error', {
      request_id: requestId,
      op: 'ensure',
      name: err instanceof Error ? err.name : typeof err,
    })
    return integrationError(requestId, 'unavailable')
  }
}
