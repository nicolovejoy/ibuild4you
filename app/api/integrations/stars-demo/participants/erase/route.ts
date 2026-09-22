import { NextResponse } from 'next/server'
import { getAdminDb } from '@/lib/firebase/admin'
import { authorizeIntegration, integrationError } from '@/lib/api/integration-auth'
import { parseErase } from '@/lib/integration/validate'
import { eraseParticipant, getOp, putOp } from '@/lib/integration/store'

// Erase person (08a §2): job-safe. Unknown participant → confirmed with no
// topics; any failure → pending (200) so stars-demo retries the same key and
// never reports completion until confirmed. Only a confirmed result is
// recorded for replay.
export async function POST(request: Request) {
  const auth = authorizeIntegration(request)
  if (!auth.ok) return auth.response
  const { namespace, requestId } = auth

  let input
  try {
    input = parseErase(await request.json())
  } catch {
    input = null
  }
  if (!input) return integrationError(requestId, 'invalid_request')

  const db = getAdminDb()
  try {
    const replay = await getOp(db, namespace, input.operation_key)
    if (replay) return NextResponse.json(replay)
    const now = new Date().toISOString()
    const { topics_cleared } = await eraseParticipant(db, namespace, input.round, input.participant_id, now)
    const response = { round: input.round, participant_id: input.participant_id, status: 'confirmed', topics_cleared }
    await putOp(db, { namespace, round: input.round, key: input.operation_key, kind: 'erase', response, now })
    return NextResponse.json(response)
  } catch (err) {
    console.error('integration_error', {
      request_id: requestId,
      op: 'erase',
      name: err instanceof Error ? err.name : typeof err,
    })
    return NextResponse.json({
      round: input.round,
      participant_id: input.participant_id,
      status: 'pending',
      topics_cleared: [],
    })
  }
}
