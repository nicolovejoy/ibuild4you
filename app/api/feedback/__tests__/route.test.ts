import { describe, it, expect, vi, beforeEach } from 'vitest'
import { POST, OPTIONS } from '../route'
import { _resetRateLimit } from '@/lib/api/rate-limit'

// =============================================================================
// Tests for POST /api/feedback — the public widget submission endpoint.
//
// Covers: CORS preflight, honeypot, render-time check, required-field validation,
// projectId-must-exist gate, happy path, and rate limiting.
//
// Firebase Admin SDK and Resend are mocked so tests run without secrets.
// =============================================================================

const mockAdd = vi.fn<(doc: Record<string, unknown>) => Promise<{ id: string }>>(
  async () => ({ id: 'feedback-1' })
)
const mockProjectsGet = vi.fn(async () => ({
  empty: false,
  docs: [{ id: 'project-1', data: () => ({ title: 'Bakery Louise', slug: 'bakery-louise' }) }],
}))
const mockVerifyIdToken = vi.fn<(token: string) => Promise<{ uid: string }>>(async () => ({ uid: 'user-1' }))
const mockResendSend = vi.fn<(payload: Record<string, unknown>) => Promise<{ id: string }>>(
  async () => ({ id: 'email-1' })
)

vi.mock('@/lib/firebase/admin', () => ({
  getAdminDb: vi.fn(() => ({
    collection: vi.fn((name: string) => {
      if (name === 'projects') {
        return {
          where: () => ({ limit: () => ({ get: mockProjectsGet }) }),
        }
      }
      // feedback
      return { add: mockAdd }
    }),
  })),
  getAdminAuth: vi.fn(() => ({ verifyIdToken: mockVerifyIdToken })),
}))

vi.mock('resend', () => ({
  Resend: vi.fn(() => ({ emails: { send: mockResendSend } })),
}))

function makeRequest(
  body: Record<string, unknown>,
  opts: { headers?: Record<string, string> } = {}
) {
  return new Request('http://localhost/api/feedback', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(opts.headers ?? {}) },
    body: JSON.stringify(body),
  })
}

function validPayload(overrides: Record<string, unknown> = {}) {
  return {
    projectId: 'bakery-louise',
    type: 'bug',
    body: 'Header is broken on mobile',
    submitterEmail: 'jamie@example.com',
    pageUrl: 'https://bakery-louise.com/menu',
    userAgent: 'Mozilla/5.0',
    viewport: '375x812',
    website: '', // honeypot, must be empty
    _ts: Date.now() - 5_000, // 5s old — passes the 2s floor
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  _resetRateLimit()
  mockProjectsGet.mockResolvedValue({
    empty: false,
    docs: [{ id: 'project-1', data: () => ({ title: 'Bakery Louise', slug: 'bakery-louise' }) }],
  })
})

describe('OPTIONS /api/feedback (CORS preflight)', () => {
  it('returns 204 with CORS headers', async () => {
    const res = await OPTIONS()
    expect(res.status).toBe(204)
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*')
    expect(res.headers.get('Access-Control-Allow-Methods')).toContain('POST')
  })
})

describe('POST /api/feedback — validation', () => {
  it('happy path writes the doc and sends the notification', async () => {
    const res = await POST(makeRequest(validPayload()))
    expect(res.status).toBe(201)
    const data = await res.json()
    expect(data.id).toBe('feedback-1')

    expect(mockAdd).toHaveBeenCalledOnce()
    const written = mockAdd.mock.calls[0][0]
    expect(written.project_id).toBe('bakery-louise')
    expect(written.type).toBe('bug')
    expect(written.body).toBe('Header is broken on mobile')
    expect(written.submitter_email).toBe('jamie@example.com')
    expect(written.status).toBe('new')
    expect(written.submitter_uid).toBeNull() // no Bearer token

    expect(mockResendSend).toHaveBeenCalledOnce()
    const email = mockResendSend.mock.calls[0][0]
    expect(email.subject).toContain('Bakery Louise')
  })

  it('silently 200s a honeypot trigger (does not write or notify)', async () => {
    const res = await POST(makeRequest(validPayload({ website: 'http://spammer.example' })))
    expect(res.status).toBe(200)
    expect(mockAdd).not.toHaveBeenCalled()
    expect(mockResendSend).not.toHaveBeenCalled()
  })

  it('rejects submissions that arrive faster than the render-time floor', async () => {
    const res = await POST(makeRequest(validPayload({ _ts: Date.now() - 500 })))
    expect(res.status).toBe(400)
    expect(mockAdd).not.toHaveBeenCalled()
  })

  it('rejects stale submissions older than 24h', async () => {
    const res = await POST(makeRequest(validPayload({ _ts: Date.now() - 48 * 60 * 60 * 1000 })))
    expect(res.status).toBe(400)
  })

  it('rejects missing _ts', async () => {
    const payload = validPayload()
    delete (payload as Record<string, unknown>)._ts
    const res = await POST(makeRequest(payload))
    expect(res.status).toBe(400)
  })

  it('rejects unknown type', async () => {
    const res = await POST(makeRequest(validPayload({ type: 'rant' })))
    expect(res.status).toBe(400)
    const err = await res.json()
    expect(err.error).toMatch(/type/)
  })

  it('rejects empty body', async () => {
    const res = await POST(makeRequest(validPayload({ body: '   ' })))
    expect(res.status).toBe(400)
  })

  it('rejects bodies over the size limit', async () => {
    const res = await POST(makeRequest(validPayload({ body: 'x'.repeat(5001) })))
    expect(res.status).toBe(400)
  })

  it('returns 404 when projectId does not match any project slug', async () => {
    mockProjectsGet.mockResolvedValueOnce({ empty: true, docs: [] })
    const res = await POST(makeRequest(validPayload({ projectId: 'no-such-project' })))
    expect(res.status).toBe(404)
    expect(mockAdd).not.toHaveBeenCalled()
  })

  it('resolves submitter_uid from a valid Bearer token', async () => {
    const res = await POST(
      makeRequest(validPayload(), { headers: { Authorization: 'Bearer good-token' } })
    )
    expect(res.status).toBe(201)
    expect(mockVerifyIdToken).toHaveBeenCalledWith('good-token')
    const written = mockAdd.mock.calls[0][0]
    expect(written.submitter_uid).toBe('user-1')
  })

  it('ignores invalid Bearer tokens (stays anonymous, does not 401)', async () => {
    mockVerifyIdToken.mockRejectedValueOnce(new Error('bad token'))
    const res = await POST(
      makeRequest(validPayload(), { headers: { Authorization: 'Bearer bad-token' } })
    )
    expect(res.status).toBe(201)
    const written = mockAdd.mock.calls[0][0]
    expect(written.submitter_uid).toBeNull()
  })

  it('submission succeeds even if Resend throws', async () => {
    mockResendSend.mockRejectedValueOnce(new Error('email infra down'))
    const res = await POST(makeRequest(validPayload()))
    expect(res.status).toBe(201)
    expect(mockAdd).toHaveBeenCalledOnce()
  })
})

describe('POST /api/feedback — rate limiting', () => {
  it('429s after the 6th attempt from the same IP within the hour', async () => {
    const headers = { 'x-forwarded-for': '1.2.3.4' }

    for (let i = 0; i < 5; i++) {
      const res = await POST(makeRequest(validPayload(), { headers }))
      expect(res.status).toBe(201)
    }

    const res = await POST(makeRequest(validPayload(), { headers }))
    expect(res.status).toBe(429)
    expect(res.headers.get('Retry-After')).toBeTruthy()
    // Did not write or notify on the rate-limited call.
    expect(mockAdd).toHaveBeenCalledTimes(5)
  })

  it('separates rate-limit buckets by IP', async () => {
    for (let i = 0; i < 5; i++) {
      const res = await POST(makeRequest(validPayload(), { headers: { 'x-forwarded-for': '1.2.3.4' } }))
      expect(res.status).toBe(201)
    }
    const res = await POST(
      makeRequest(validPayload(), { headers: { 'x-forwarded-for': '5.6.7.8' } })
    )
    expect(res.status).toBe(201)
  })
})
