import { NextResponse } from 'next/server'
import { getAdminDb } from '@/lib/firebase/admin'
import { authorizeIntegration, integrationError } from '@/lib/api/integration-auth'
import { parseNamespaceErase } from '@/lib/integration/validate'
import { eraseNamespaceRound, getOp, putOp } from '@/lib/integration/store'

// Retention erase (08a §7): the whole namespace+round, run by a stars-demo
// script once the summary is written. Same secret as every other call.
export async function POST(request: Request) {
  const auth = authorizeIntegration(request)
  if (!auth.ok) return auth.response
  const { namespace, requestId } = auth

  let input
  try {
    input = parseNamespaceErase(await request.json())
  } catch {
    input = null
  }
  if (!input) return integrationError(requestId, 'invalid_request')

  const db = getAdminDb()
  try {
    const replay = await getOp(db, namespace, input.operation_key)
    if (replay) return NextResponse.json(replay)
    const now = new Date().toISOString()
    const { topics_cleared } = await eraseNamespaceRound(db, namespace, input.round)
    const response = { round: input.round, status: 'confirmed', topics_cleared }
    // Written after the sweep so the record itself survives it.
    await putOp(db, {
      namespace,
      round: input.round,
      key: input.operation_key,
      kind: 'namespace_erase',
      response,
      now,
    })
    return NextResponse.json(response)
  } catch (err) {
    console.error('integration_error', {
      request_id: requestId,
      op: 'namespace_erase',
      name: err instanceof Error ? err.name : typeof err,
    })
    return NextResponse.json({ round: input.round, status: 'pending', topics_cleared: [] })
  }
}
