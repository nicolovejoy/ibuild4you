import { createHash, randomUUID, timingSafeEqual } from 'node:crypto'
import { NextResponse } from 'next/server'

// Server-to-server auth for stars-demo round two (contract 08a §1, §4).
// Deliberately NOT an AuthSuccess: no uid/email/systemRoles, so this context
// can never be passed to getProjectRole / isApprovedEmail and can never
// inherit member or admin access. Integration routes are the only consumers.

export const NAMESPACE = 'stars-demo' as const
export const SECRET_HEADER = 'x-integration-secret'
export const NAMESPACE_HEADER = 'x-integration-namespace'
const SECRET_ENV = 'STARS_INTEGRATION_SECRET'

export type IntegrationErrorCode =
  | 'unauthorized'
  | 'forbidden'
  | 'stale'
  | 'invalid_request'
  | 'reply_pending'
  | 'rate_limited'
  | 'unavailable'

const STATUS_BY_CODE: Record<IntegrationErrorCode, number> = {
  unauthorized: 401,
  forbidden: 403,
  stale: 409,
  invalid_request: 400,
  reply_pending: 202,
  rate_limited: 429,
  unavailable: 503,
}

export type IntegrationContext = { ok: true; namespace: typeof NAMESPACE; requestId: string }
export type IntegrationRefusal = { ok: false; response: NextResponse }

// The entire error body, always: { error: { code, request_id } }. Never a
// message, provider error, prompt, identity or body (08a §4).
export function integrationError(requestId: string, code: IntegrationErrorCode): NextResponse {
  return NextResponse.json({ error: { code, request_id: requestId } }, { status: STATUS_BY_CODE[code] })
}

// Hash both sides so timingSafeEqual always sees equal-length buffers
// (it throws on a length mismatch, which would itself leak the length).
function digest(value: string): Buffer {
  return createHash('sha256').update(value).digest()
}

export function authorizeIntegration(request: Request): IntegrationContext | IntegrationRefusal {
  const requestId = randomUUID()
  const refuse = (code: IntegrationErrorCode): IntegrationRefusal => ({
    ok: false,
    response: integrationError(requestId, code),
  })

  // Vercel's edge already redirects http→https before we run; in production
  // this is belt and braces for any proxy that forwards plain http. Outside
  // production it is skipped so local smoke scripts work (08a §1).
  if (process.env.NODE_ENV === 'production') {
    const proto = request.headers.get('x-forwarded-proto')
    if (proto && proto !== 'https') return refuse('invalid_request')
  }

  if (request.headers.get(NAMESPACE_HEADER) !== NAMESPACE) return refuse('unauthorized')

  const expected = process.env[SECRET_ENV]
  const presented = request.headers.get(SECRET_HEADER)
  if (!expected || !presented) return refuse('unauthorized')
  if (!timingSafeEqual(digest(presented), digest(expected))) return refuse('unauthorized')

  return { ok: true, namespace: NAMESPACE, requestId }
}
