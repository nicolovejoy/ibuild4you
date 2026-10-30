import { describe, it, expect, vi, beforeEach } from 'vitest'
import { POST, OPTIONS } from '../route'
import { RATE_LIMIT_PER_HOUR } from '@/lib/feedback/limits'
import { _resetRateLimit } from '@/lib/api/rate-limit'
import { signIdentityAssertion } from '@/lib/feedback/identity'

// =============================================================================
// Tests for POST /api/feedback — the public widget submission endpoint.
//
// Covers: CORS preflight, honeypot, render-time check, required-field validation,
// projectId-must-resolve-to-an-app gate, happy path, and rate limiting.
//
// Firebase Admin SDK and Resend are mocked so tests run without secrets.
// =============================================================================

const mockAdd = vi.fn<(doc: Record<string, unknown>) => Promise<{ id: string }>>(
  async () => ({ id: 'feedback-1' })
)
// Burst-counter query: feedback.where('project_id','==',slug).get(). Default: no
// prior notes in the window. Override .docs in a test to simulate a burst.
const mockFeedbackWhereGet = vi.fn(async () => ({ docs: [] as Array<{ data: () => Record<string, unknown> }> }))
const mockContextAdd = vi.fn<(doc: Record<string, unknown>) => Promise<{ id: string }>>(
  async () => ({ id: 'context-1' })
)
// Loop apps: apps/{slug}.get() for a canonical slug, then
// apps.where('legacy_slugs','array-contains',x).limit(1).get() for a legacy one.
// Default: one app, slug 'sample-cafe', no legacy slugs.
type AppDoc = { id: string; data: () => Record<string, unknown> }
const SAMPLE_APP: Record<string, unknown> = { slug: 'sample-cafe', name: 'Sample Cafe' }
let appsStore: Record<string, Record<string, unknown>> = {}
const mockAppDocGet = vi.fn(async (id: string) => ({
  exists: id in appsStore,
  id,
  data: () => appsStore[id],
}))
const mockAppLegacyGet = vi.fn(async (legacy: string) => {
  const hit = Object.entries(appsStore).find(([, a]) =>
    ((a.legacy_slugs as string[] | undefined) ?? []).includes(legacy)
  )
  const docs: AppDoc[] = hit ? [{ id: hit[0], data: () => hit[1] }] : []
  return { empty: docs.length === 0, docs }
})
const mockVerifyIdToken = vi.fn<(token: string) => Promise<{ uid: string }>>(async () => ({ uid: 'user-1' }))
const mockResendSend = vi.fn<(payload: Record<string, unknown>) => Promise<{ id: string }>>(
  async () => ({ id: 'email-1' })
)
// #149: loop_signing_secrets/{app slug}. Default: no secret configured
// (doc doesn't exist) — every test that exercises a real identityAssertion
// overrides this to return the secret it signed the token with.
const mockSecretGet = vi.fn<
  () => Promise<{ exists: boolean; data: () => { keys: Record<string, string>; active_kid: string } | undefined }>
>(async () => ({ exists: false, data: () => undefined }))

vi.mock('@/lib/firebase/admin', () => ({
  getAdminDb: vi.fn(() => ({
    collection: vi.fn((name: string) => {
      if (name === 'apps') {
        return {
          doc: (id: string) => {
            // Real Firestore throws synchronously on these ids.
            if (id.includes('/') || /^__.*__$/.test(id)) throw new Error(`invalid doc id ${id}`)
            return { get: () => mockAppDocGet(id) }
          },
          where: (_f: string, _op: string, v: string) => ({
            limit: () => ({ get: () => mockAppLegacyGet(v) }),
          }),
        }
      }
      if (name === 'prototype_context') {
        return { add: mockContextAdd }
      }
      if (name === 'loop_signing_secrets') {
        return { doc: () => ({ get: mockSecretGet }) }
      }
      // feedback
      return { add: mockAdd, where: () => ({ get: mockFeedbackWhereGet }) }
    }),
  })),
  getAdminAuth: vi.fn(() => ({ verifyIdToken: mockVerifyIdToken })),
}))

const mockListAppGrants = vi.fn<(slug: string) => Promise<Array<{ email: string; role: string }>>>(
  async () => []
)
let garmConfigured = true
vi.mock('@/lib/garm-loop', () => ({
  listAppGrants: (slug: string) => mockListAppGrants(slug),
  loopGarmConfigured: () => garmConfigured,
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
    projectId: 'sample-cafe',
    type: 'bug',
    body: 'Header is broken on mobile',
    submitterEmail: 'sam@example.com',
    pageUrl: 'https://sample-cafe.com/menu',
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
  appsStore = { 'sample-cafe': { ...SAMPLE_APP } }
  garmConfigured = true
  mockListAppGrants.mockResolvedValue([])
  mockFeedbackWhereGet.mockResolvedValue({ docs: [] })
  mockSecretGet.mockResolvedValue({ exists: false, data: () => undefined })
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
    expect(written.project_id).toBe('sample-cafe')
    expect(written.type).toBe('bug')
    expect(written.body).toBe('Header is broken on mobile')
    expect(written.submitter_email).toBe('sam@example.com')
    expect(written.status).toBe('new')
    expect(written.submitter_uid).toBeNull() // no Bearer token

    expect(mockResendSend).toHaveBeenCalledOnce()
    const email = mockResendSend.mock.calls[0][0]
    expect(email.subject).toBe('[bug] Sample Cafe: Header is broken on mobile')
    expect(email.text).toContain('Review: https://ibuild4you.com/admin/apps/sample-cafe?id=feedback-1')
    expect(email.text).toContain('From: sam@example.com')
    expect(email.html).toContain('<a href=')
    // Lone note → no burst suffix.
    expect(email.subject).not.toContain('note this session')
  })

  it("sends to NOTIFICATION_EMAILS plus the app's owners and collaborators, not viewers", async () => {
    mockListAppGrants.mockResolvedValue([
      { email: 'eric@x.com', role: 'owner' },
      { email: 'v@x.com', role: 'viewer' },
      { email: 'eric@x.com', role: 'collaborator' },
    ])
    await POST(makeRequest(validPayload()))
    expect(mockListAppGrants).toHaveBeenCalledWith('sample-cafe')
    expect(mockResendSend.mock.calls[0][0].to).toEqual(['nlovejoy@me.com', 'eric@x.com'])
  })

  it('falls back to NOTIFICATION_EMAILS when Garm throws', async () => {
    mockListAppGrants.mockRejectedValue(new Error('down'))
    await POST(makeRequest(validPayload()))
    expect(mockResendSend.mock.calls[0][0].to).toEqual(['nlovejoy@me.com'])
  })

  it('falls back to NOTIFICATION_EMAILS when Garm is not configured', async () => {
    garmConfigured = false
    await POST(makeRequest(validPayload()))
    expect(mockListAppGrants).not.toHaveBeenCalled()
    expect(mockResendSend.mock.calls[0][0].to).toEqual(['nlovejoy@me.com'])
  })

  it('FEEDBACK_NOTIFY_SUPPRESS=on makes no Garm call', async () => {
    process.env.FEEDBACK_NOTIFY_SUPPRESS = 'on'
    try {
      await POST(makeRequest(validPayload()))
      expect(mockListAppGrants).not.toHaveBeenCalled()
    } finally {
      delete process.env.FEEDBACK_NOTIFY_SUPPRESS
    }
  })

  it('FEEDBACK_NOTIFY_SUPPRESS=on skips the notification but still writes the doc', async () => {
    process.env.FEEDBACK_NOTIFY_SUPPRESS = 'on'
    try {
      const res = await POST(makeRequest(validPayload()))
      expect(res.status).toBe(201)
      expect(mockAdd).toHaveBeenCalledOnce()
      expect(mockResendSend).not.toHaveBeenCalled()
    } finally {
      delete process.env.FEEDBACK_NOTIFY_SUPPRESS
    }
  })

  it('any value other than exactly "on" still notifies', async () => {
    process.env.FEEDBACK_NOTIFY_SUPPRESS = 'true'
    try {
      const res = await POST(makeRequest(validPayload()))
      expect(res.status).toBe(201)
      expect(mockResendSend).toHaveBeenCalledOnce()
    } finally {
      delete process.env.FEEDBACK_NOTIFY_SUPPRESS
    }
  })

  it('adds an ordinal burst suffix when prior notes exist in the window', async () => {
    const recent = new Date().toISOString()
    // One prior note in the last 15 min → this is the 2nd.
    mockFeedbackWhereGet.mockResolvedValue({
      docs: [{ data: () => ({ created_at: recent }) }],
    })
    const res = await POST(makeRequest(validPayload()))
    expect(res.status).toBe(201)
    const email = mockResendSend.mock.calls[0][0]
    expect(email.subject).toContain(' · 2nd note this session')
  })

  it('ignores prior notes older than the 15-minute burst window', async () => {
    const old = new Date(Date.now() - 20 * 60 * 1000).toISOString()
    mockFeedbackWhereGet.mockResolvedValue({
      docs: [{ data: () => ({ created_at: old }) }],
    })
    const res = await POST(makeRequest(validPayload()))
    expect(res.status).toBe(201)
    const email = mockResendSend.mock.calls[0][0]
    expect(email.subject).not.toContain('note this session')
  })

  it('anonymous submission marks the submitter as not captured', async () => {
    const res = await POST(makeRequest(validPayload({ submitterEmail: '' })))
    expect(res.status).toBe(201)
    const email = mockResendSend.mock.calls[0][0]
    expect(email.text).toContain('From: submitter not captured (widget not identity-aware yet)')
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

  it('404 Unknown project when the slug matches no app and no legacy slug', async () => {
    const res = await POST(makeRequest(validPayload({ projectId: 'no-such-project' })))
    expect(res.status).toBe(404)
    expect(await res.json()).toEqual({ error: 'Unknown project' })
    expect(mockAdd).not.toHaveBeenCalled()
  })

  it('404 Unknown project for a projectId that is not a valid slug (no 500)', async () => {
    const res = await POST(makeRequest(validPayload({ projectId: 'a/b' })))
    expect(res.status).toBe(404)
    expect(await res.json()).toEqual({ error: 'Unknown project' })
  })

  it('stores project_id as the canonical slug when posted under a legacy slug', async () => {
    appsStore = {
      byside: { slug: 'byside', name: 'Byside', legacy_slugs: ['byside-old-brief-slug'] },
    }
    const res = await POST(makeRequest(validPayload({ projectId: 'byside-old-brief-slug' })))
    expect(res.status).toBe(201)
    expect(mockAdd.mock.calls[0][0].project_id).toBe('byside')
    const email = mockResendSend.mock.calls[0][0]
    expect(email.subject).toContain('Byside')
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

// #72 slice B1 — optional structural capture rides along with a submission and
// lands in the separate prototype_context collection (agent-facing), never on
// the feedback row itself beyond a has_capture flag.
describe('POST /api/feedback — capture', () => {
  const capture = {
    v: 1,
    route: '/checkout',
    title: 'Checkout — Byside',
    outline: 'h1: Checkout\nbuttons: Place order',
  }

  it('writes a prototype_context row and flags the feedback row', async () => {
    const res = await POST(makeRequest(validPayload({ capture })))
    expect(res.status).toBe(201)

    const feedbackRow = mockAdd.mock.calls[0][0]
    expect(feedbackRow.has_capture).toBe(true)
    expect(feedbackRow.capture).toBeUndefined() // capture never lands on the inbox row

    expect(mockContextAdd).toHaveBeenCalledOnce()
    const row = mockContextAdd.mock.calls[0][0]
    expect(row.project_id).toBe('sample-cafe')
    expect(row.feedback_id).toBe('feedback-1')
    expect(row.source).toBe('loop-widget')
    expect(row.capture_version).toBe(1)
    expect(row.route).toBe('/checkout')
    expect(row.title).toBe('Checkout — Byside')
    expect(row.outline).toContain('Place order')
    expect(row.viewport).toBe('375x812')
    expect(row.status).toBe('active')
    expect(row.submitter_uid).toBeNull()
  })

  it('no capture → no prototype_context write, no flag', async () => {
    const res = await POST(makeRequest(validPayload()))
    expect(res.status).toBe(201)
    expect(mockContextAdd).not.toHaveBeenCalled()
    expect(mockAdd.mock.calls[0][0].has_capture).toBeUndefined()
  })

  it('ignores a malformed capture without failing the submission', async () => {
    const res = await POST(makeRequest(validPayload({ capture: { v: 99, nonsense: true } })))
    expect(res.status).toBe(201)
    expect(mockAdd).toHaveBeenCalledOnce()
    expect(mockContextAdd).not.toHaveBeenCalled()
  })

  it('slices oversized capture fields server-side', async () => {
    const res = await POST(
      makeRequest(
        validPayload({
          capture: { ...capture, outline: 'x'.repeat(9000), route: '/' + 'r'.repeat(500) },
        })
      )
    )
    expect(res.status).toBe(201)
    const row = mockContextAdd.mock.calls[0][0]
    expect((row.outline as string).length).toBeLessThanOrEqual(4000)
    expect((row.route as string).length).toBeLessThanOrEqual(300)
  })

  it('context write failure does not fail the submission', async () => {
    mockContextAdd.mockRejectedValueOnce(new Error('firestore down'))
    const res = await POST(makeRequest(validPayload({ capture })))
    expect(res.status).toBe(201)
  })
})

describe('POST /api/feedback — rate limiting', () => {
  it(`429s after attempt ${RATE_LIMIT_PER_HOUR + 1} from the same IP within the hour`, async () => {
    const headers = { 'x-forwarded-for': '1.2.3.4' }

    for (let i = 0; i < RATE_LIMIT_PER_HOUR; i++) {
      const res = await POST(makeRequest(validPayload(), { headers }))
      expect(res.status).toBe(201)
    }

    const res = await POST(makeRequest(validPayload(), { headers }))
    expect(res.status).toBe(429)
    expect(res.headers.get('Retry-After')).toBeTruthy()
    // A cross-origin widget can only read Retry-After if it is exposed.
    expect(res.headers.get('Access-Control-Expose-Headers')).toContain('Retry-After')
    // Did not write or notify on the rate-limited call.
    expect(mockAdd).toHaveBeenCalledTimes(RATE_LIMIT_PER_HOUR)
  })

  it('separates rate-limit buckets by IP', async () => {
    for (let i = 0; i < RATE_LIMIT_PER_HOUR; i++) {
      const res = await POST(makeRequest(validPayload(), { headers: { 'x-forwarded-for': '1.2.3.4' } }))
      expect(res.status).toBe(201)
    }
    const res = await POST(
      makeRequest(validPayload(), { headers: { 'x-forwarded-for': '5.6.7.8' } })
    )
    expect(res.status).toBe(201)
  })
})

// #149/#150 — host-app identity relay + the feedback_requires_identity gate.
describe('POST /api/feedback — identity relay (#149) and requires-identity (#150)', () => {
  const SECRET = 'test-secret-32-bytes-of-entropy!'

  function signToken(overrides: Partial<Parameters<typeof signIdentityAssertion>[0]> = {}) {
    return signIdentityAssertion(
      {
        v: 1,
        email: 'verified@example.com',
        project: 'sample-cafe',
        ts: Math.floor(Date.now() / 1000),
        kid: 'k1',
        ...overrides,
      },
      SECRET
    )
  }

  function configureSecret() {
    mockSecretGet.mockResolvedValue({
      exists: true,
      data: () => ({ keys: { k1: SECRET }, active_kid: 'k1' }),
    })
  }

  it('a valid assertion overrides submitterEmail and sets submitter_email_verified', async () => {
    configureSecret()
    const res = await POST(
      makeRequest(
        validPayload({ submitterEmail: 'typed@example.com', identityAssertion: signToken() })
      )
    )
    expect(res.status).toBe(201)
    const written = mockAdd.mock.calls[0][0]
    expect(written.submitter_email).toBe('verified@example.com')
    expect(written.submitter_email_verified).toBe(true)
  })

  it('an invalid (tampered) token is silently treated as anonymous', async () => {
    configureSecret()
    const token = signToken()
    const tampered = token.slice(0, -2) + 'xx'
    const res = await POST(
      makeRequest(validPayload({ submitterEmail: '', identityAssertion: tampered }))
    )
    expect(res.status).toBe(201)
    const written = mockAdd.mock.calls[0][0]
    expect(written.submitter_email).toBeNull()
    expect(written.submitter_email_verified).toBeUndefined()
  })

  it('an assertion for the wrong project is silently treated as anonymous', async () => {
    configureSecret()
    const res = await POST(
      makeRequest(
        validPayload({ submitterEmail: '', identityAssertion: signToken({ project: 'other-project' }) })
      )
    )
    expect(res.status).toBe(201)
    const written = mockAdd.mock.calls[0][0]
    expect(written.submitter_email_verified).toBeUndefined()
  })

  it('reads loop_signing_secrets by the canonical slug', async () => {
    appsStore = {
      'sample-cafe': { slug: 'sample-cafe', name: 'Sample Cafe', legacy_slugs: ['old-brief'] },
    }
    const secretDoc = vi.fn(() => ({ get: mockSecretGet }))
    const { getAdminDb } = await import('@/lib/firebase/admin')
    const base = (getAdminDb as unknown as () => { collection: (n: string) => unknown })()
    vi.mocked(getAdminDb).mockReturnValueOnce({
      collection: (n: string) => (n === 'loop_signing_secrets' ? { doc: secretDoc } : base.collection(n)),
    } as unknown as ReturnType<typeof getAdminDb>)
    configureSecret()
    // Posted under the legacy slug; assertion signed for the canonical one.
    const res = await POST(
      makeRequest(validPayload({ projectId: 'old-brief', identityAssertion: signToken() }))
    )
    expect(res.status).toBe(201)
    expect(secretDoc).toHaveBeenCalledWith('sample-cafe')
    expect(mockAdd.mock.calls[0][0].submitter_email_verified).toBe(true)
  })

  it('verifies an assertion signed with a legacy slug of the same app', async () => {
    appsStore = {
      'sample-cafe': { slug: 'sample-cafe', name: 'Sample Cafe', legacy_slugs: ['old-brief'] },
    }
    configureSecret()
    const res = await POST(
      makeRequest(
        validPayload({
          projectId: 'old-brief',
          submitterEmail: '',
          identityAssertion: signToken({ project: 'old-brief' }),
        })
      )
    )
    expect(res.status).toBe(201)
    const written = mockAdd.mock.calls[0][0]
    expect(written.project_id).toBe('sample-cafe')
    expect(written.submitter_email_verified).toBe(true)
    expect(written.submitter_email).toBe('verified@example.com')
  })

  it("does not verify a token signed for another app's slug posted under a different app's legacy id", async () => {
    appsStore = {
      byside: { slug: 'byside', name: 'Byside', legacy_slugs: ['byside-old-brief-slug'] },
      musicforge: { slug: 'musicforge', name: 'MusicForge' },
    }
    configureSecret()
    const res = await POST(
      makeRequest(
        validPayload({
          projectId: 'byside-old-brief-slug',
          submitterEmail: '',
          identityAssertion: signToken({ project: 'musicforge' }),
        })
      )
    )
    expect(res.status).toBe(201)
    const written = mockAdd.mock.calls[0][0]
    expect(written.project_id).toBe('byside')
    expect(written.submitter_email_verified).toBeUndefined()
    expect(written.submitter_email).toBeNull()
  })

  it('no secret configured for the project → assertion silently ignored', async () => {
    // mockSecretGet default (from beforeEach) is exists:false.
    const res = await POST(makeRequest(validPayload({ identityAssertion: signToken() })))
    expect(res.status).toBe(201)
    const written = mockAdd.mock.calls[0][0]
    expect(written.submitter_email_verified).toBeUndefined()
  })

  it('verified submissions bypass the rate limit', async () => {
    configureSecret()
    const headers = { 'x-forwarded-for': '9.9.9.9' }
    for (let i = 0; i < RATE_LIMIT_PER_HOUR; i++) {
      const res = await POST(makeRequest(validPayload(), { headers }))
      expect(res.status).toBe(201)
    }
    // Bucket is now full for this IP — an unverified request 429s...
    const blocked = await POST(makeRequest(validPayload(), { headers }))
    expect(blocked.status).toBe(429)
    // ...but a verified one still goes through.
    const verifiedRes = await POST(
      makeRequest(validPayload({ identityAssertion: signToken() }), { headers })
    )
    expect(verifiedRes.status).toBe(201)
  })

  it('a valid Bearer also bypasses the rate limit', async () => {
    const headers = { 'x-forwarded-for': '9.9.9.10', Authorization: 'Bearer good-token' }
    for (let i = 0; i < RATE_LIMIT_PER_HOUR; i++) {
      const res = await POST(makeRequest(validPayload(), { headers: { 'x-forwarded-for': '9.9.9.10' } }))
      expect(res.status).toBe(201)
    }
    const res = await POST(makeRequest(validPayload(), { headers }))
    expect(res.status).toBe(201)
  })

  it('403s an unverified submission when feedback_requires_identity is true', async () => {
    appsStore['sample-cafe'].feedback_requires_identity = true
    const res = await POST(makeRequest(validPayload({ submitterEmail: 'typed@example.com' })))
    expect(res.status).toBe(403)
    expect(mockAdd).not.toHaveBeenCalled()
  })

  it('201s a verified (assertion) submission when feedback_requires_identity is true', async () => {
    appsStore['sample-cafe'].feedback_requires_identity = true
    configureSecret()
    const res = await POST(makeRequest(validPayload({ identityAssertion: signToken() })))
    expect(res.status).toBe(201)
  })

  it('a valid Bearer satisfies feedback_requires_identity even without an assertion', async () => {
    appsStore['sample-cafe'].feedback_requires_identity = true
    const res = await POST(
      makeRequest(validPayload(), { headers: { Authorization: 'Bearer good-token' } })
    )
    expect(res.status).toBe(201)
  })

  it('honours apps.feedback_requires_identity', async () => {
    appsStore['sample-cafe'].feedback_requires_identity = true
    const anon = await POST(makeRequest(validPayload({ submitterEmail: '' })))
    expect(anon.status).toBe(403)
    appsStore['sample-cafe'].feedback_requires_identity = false
    const open = await POST(makeRequest(validPayload({ submitterEmail: '' })))
    expect(open.status).toBe(201)
  })

  it('feedback_requires_identity absent (flag off) leaves anonymous submissions unchanged', async () => {
    const res = await POST(makeRequest(validPayload({ submitterEmail: '' })))
    expect(res.status).toBe(201)
    const written = mockAdd.mock.calls[0][0]
    expect(written.submitter_email).toBeNull()
  })
})
