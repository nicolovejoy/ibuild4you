import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { authorizeIntegration, integrationError } from '../integration-auth'

const SECRET = 'test-secret-value-not-real'
const ok = { 'X-Integration-Secret': SECRET, 'X-Integration-Namespace': 'stars-demo' }
const req = (headers: Record<string, string>) =>
  new Request('http://localhost/api/integrations/stars-demo/messages', { headers })

describe('authorizeIntegration', () => {
  beforeEach(() => {
    vi.stubEnv('STARS_INTEGRATION_SECRET', SECRET)
  })
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('accepts the right secret and namespace and mints a request id', () => {
    const r = authorizeIntegration(req(ok))
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.namespace).toBe('stars-demo')
    expect(r.requestId).toMatch(/^[0-9a-f-]{36}$/)
  })

  it('401s a wrong secret with the fixed body', async () => {
    const r = authorizeIntegration(req({ ...ok, 'X-Integration-Secret': 'nope' }))
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.response.status).toBe(401)
    const body = await r.response.json()
    expect(body.error.code).toBe('unauthorized')
    expect(body.error.request_id).toMatch(/^[0-9a-f-]{36}$/)
    expect(Object.keys(body)).toEqual(['error'])
  })

  it('401s a secret of another length without throwing', () => {
    expect(authorizeIntegration(req({ ...ok, 'X-Integration-Secret': 'x' })).ok).toBe(false)
  })

  it('401s a missing secret header', () => {
    expect(authorizeIntegration(req({ 'X-Integration-Namespace': 'stars-demo' })).ok).toBe(false)
  })

  it('401s a missing or wrong namespace', () => {
    expect(authorizeIntegration(req({ 'X-Integration-Secret': SECRET })).ok).toBe(false)
    expect(authorizeIntegration(req({ ...ok, 'X-Integration-Namespace': 'other' })).ok).toBe(false)
  })

  it('ignores an Authorization bearer token (Firebase path) entirely', () => {
    expect(
      authorizeIntegration(req({ Authorization: `Bearer ${SECRET}`, 'X-Integration-Namespace': 'stars-demo' })).ok
    ).toBe(false)
  })

  it('fails closed when the env var is unset', () => {
    vi.stubEnv('STARS_INTEGRATION_SECRET', '')
    expect(authorizeIntegration(req(ok)).ok).toBe(false)
  })

  it('in production, 400s invalid_request when the edge says plain http', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    const r = authorizeIntegration(req({ ...ok, 'x-forwarded-proto': 'http' }))
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.response.status).toBe(400)
    expect((await r.response.json()).error.code).toBe('invalid_request')
    expect(authorizeIntegration(req({ ...ok, 'x-forwarded-proto': 'https' })).ok).toBe(true)
  })

  it('in production, 400s invalid_request when x-forwarded-proto is absent', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    const r = authorizeIntegration(req(ok))
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.response.status).toBe(400)
  })

  it('400s invalid_request when content-length exceeds the body cap, before the secret is checked', async () => {
    const r = authorizeIntegration(req({ ...ok, 'content-length': String(64 * 1024 + 1) }))
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.response.status).toBe(400)
    expect((await r.response.json()).error.code).toBe('invalid_request')
    expect(authorizeIntegration(req({ ...ok, 'content-length': String(64 * 1024) })).ok).toBe(true)
  })

  it('outside production, ignores x-forwarded-proto so local smoke scripts work', () => {
    expect(authorizeIntegration(req({ ...ok, 'x-forwarded-proto': 'http' })).ok).toBe(true)
  })
})

describe('integrationError', () => {
  it('maps every code to its status', async () => {
    const cases = [
      ['unauthorized', 401],
      ['forbidden', 403],
      ['stale', 409],
      ['invalid_request', 400],
      ['reply_pending', 202],
      ['rate_limited', 429],
      ['unavailable', 503],
    ] as const
    for (const [code, status] of cases) {
      const res = integrationError('rid-1', code)
      expect(res.status).toBe(status)
      expect(await res.json()).toEqual({ error: { code, request_id: 'rid-1' } })
    }
  })
})
