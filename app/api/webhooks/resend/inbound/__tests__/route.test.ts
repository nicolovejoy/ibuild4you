import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// =============================================================================
// Tests for POST /api/webhooks/resend/inbound.
//
// Mocks: svix verifier, Firebase admin (firestore), and global fetch (for the
// inbound body retrieval). The route never makes a real network call here.
// =============================================================================

// --- svix mock --------------------------------------------------------------
// vi.mock is hoisted, so all referenced names must be defined inside the
// factory. We grab the fake error class back out via `await import('svix')`
// in tests that need to throw it.
vi.mock('svix', () => {
  class FakeWebhookVerificationError extends Error {}
  const verify = vi.fn<(body: string) => unknown>()
  return {
    Webhook: vi.fn().mockImplementation(() => ({ verify })),
    WebhookVerificationError: FakeWebhookVerificationError,
    __mockVerify: verify, // test-only handle for assertions
  }
})

// Re-fetch the mocked verify handle once at module load.
import * as svixMock from 'svix'
const mockVerify = (svixMock as unknown as { __mockVerify: ReturnType<typeof vi.fn> }).__mockVerify
const FakeWebhookVerificationError = (
  svixMock as unknown as { WebhookVerificationError: new (m: string) => Error }
).WebhookVerificationError

// --- firestore mock ---------------------------------------------------------
const mockReplyAdd = vi.fn<(doc: Record<string, unknown>) => Promise<{ id: string }>>(
  async () => ({ id: 'reply-1' })
)
const mockFeedbackUpdate = vi.fn<(patch: Record<string, unknown>) => Promise<void>>(
  async () => undefined
)
const mockFeedbackGet = vi.fn<() => Promise<{ exists: boolean; data?: () => Record<string, unknown> }>>(
  async () => ({ exists: true, data: () => ({ status: 'acknowledged' }) })
)
const mockFeedbackDoc = vi.fn(() => ({
  get: mockFeedbackGet,
  update: mockFeedbackUpdate,
  collection: vi.fn(() => ({ add: mockReplyAdd })),
}))

vi.mock('@/lib/firebase/admin', () => ({
  getAdminDb: vi.fn(() => ({
    collection: vi.fn((name: string) => {
      if (name === 'feedback') return { doc: mockFeedbackDoc }
      return { doc: vi.fn() }
    }),
  })),
  getAdminAuth: vi.fn(),
}))

// --- import under test (after mocks) ---------------------------------------
import { POST } from '../route'
import { FEEDBACK_INBOX_HOST } from '@/lib/feedback/inbound'

// --- helpers ---------------------------------------------------------------
const ORIGINAL_FETCH = globalThis.fetch
const ORIGINAL_ENV = { ...process.env }

function makeRequest(
  body: Record<string, unknown>,
  opts: { headers?: Record<string, string> } = {}
) {
  return new Request('http://localhost/api/webhooks/resend/inbound', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'svix-id': 'msg_1',
      'svix-timestamp': String(Math.floor(Date.now() / 1000)),
      'svix-signature': 'v1,fake',
      ...(opts.headers ?? {}),
    },
    body: JSON.stringify(body),
  })
}

function receivedEvent(overrides: Record<string, unknown> = {}) {
  return {
    type: 'email.received',
    data: {
      email_id: 'em_123',
      from: 'jamie@example.com',
      to: [`feedback+fb-1@${FEEDBACK_INBOX_HOST}`],
      subject: 'Re: Update on your feedback',
      message_id: '<thread@example.com>',
      ...overrides,
    },
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  process.env = { ...ORIGINAL_ENV, RESEND_INBOUND_SECRET: 'whsec_test', RESEND_API_KEY: 'rk_test' }
  // Default: signature valid — verify() returns the parsed payload.
  mockVerify.mockImplementation((raw: string) => JSON.parse(raw))
  // Default: body fetch returns text successfully.
  globalThis.fetch = vi.fn(async () =>
    new Response(JSON.stringify({ text: 'Two more notes on the bug.' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  ) as unknown as typeof fetch
  // Default: feedback doc exists.
  mockFeedbackGet.mockResolvedValue({
    exists: true,
    data: () => ({ status: 'acknowledged' }),
  })
})

afterEach(() => {
  globalThis.fetch = ORIGINAL_FETCH
  process.env = ORIGINAL_ENV
})

describe('POST /api/webhooks/resend/inbound — auth & config', () => {
  it('500s when RESEND_INBOUND_SECRET is unset (refuses inbound rather than accepting unsigned)', async () => {
    delete process.env.RESEND_INBOUND_SECRET
    const res = await POST(makeRequest(receivedEvent()))
    expect(res.status).toBe(500)
    expect(mockReplyAdd).not.toHaveBeenCalled()
  })

  it('401s on signature verification failure', async () => {
    mockVerify.mockImplementation(() => {
      throw new FakeWebhookVerificationError('bad sig')
    })
    const res = await POST(makeRequest(receivedEvent()))
    expect(res.status).toBe(401)
    expect(mockReplyAdd).not.toHaveBeenCalled()
    expect(mockFeedbackUpdate).not.toHaveBeenCalled()
  })
})

describe('POST /api/webhooks/resend/inbound — routing', () => {
  it('ignores non-received event types with 200 (so Resend stops retrying)', async () => {
    const res = await POST(makeRequest({ type: 'email.delivered', data: {} }))
    expect(res.status).toBe(200)
    const j = await res.json()
    expect(j.ignored).toBe('email.delivered')
    expect(mockReplyAdd).not.toHaveBeenCalled()
  })

  it('ignores received events with no plus-addressed recipient', async () => {
    const res = await POST(
      makeRequest(receivedEvent({ to: ['support@elsewhere.com'] }))
    )
    expect(res.status).toBe(200)
    const j = await res.json()
    expect(j.ignored).toBe('no-feedback-id')
    expect(mockReplyAdd).not.toHaveBeenCalled()
  })

  it('ignores received events when the feedback doc does not exist', async () => {
    mockFeedbackGet.mockResolvedValueOnce({ exists: false })
    const res = await POST(makeRequest(receivedEvent()))
    expect(res.status).toBe(200)
    const j = await res.json()
    expect(j.ignored).toBe('feedback-not-found')
    expect(mockReplyAdd).not.toHaveBeenCalled()
    expect(mockFeedbackUpdate).not.toHaveBeenCalled()
  })
})

describe('POST /api/webhooks/resend/inbound — happy path', () => {
  it('writes a reply with the fetched body and bumps the parent to new', async () => {
    const res = await POST(makeRequest(receivedEvent()))
    expect(res.status).toBe(200)
    const j = await res.json()
    expect(j.feedback_id).toBe('fb-1')

    expect(mockFeedbackDoc).toHaveBeenCalledWith('fb-1')

    expect(mockReplyAdd).toHaveBeenCalledOnce()
    const written = mockReplyAdd.mock.calls[0][0]
    expect(written.feedback_id).toBe('fb-1')
    expect(written.from).toBe('submitter')
    expect(written.from_email).toBe('jamie@example.com')
    expect(written.body).toBe('Two more notes on the bug.')
    expect(written.via_email).toBe(true)

    expect(mockFeedbackUpdate).toHaveBeenCalledOnce()
    const patch = mockFeedbackUpdate.mock.calls[0][0]
    expect(patch.status).toBe('new')
    expect(typeof patch.updated_at).toBe('string')
  })

  it('falls back to a placeholder body when Resend body fetch fails (still writes the reply)', async () => {
    globalThis.fetch = vi.fn(async () =>
      new Response('{"error":"not found"}', { status: 404 })
    ) as unknown as typeof fetch
    const res = await POST(makeRequest(receivedEvent()))
    expect(res.status).toBe(200)
    expect(mockReplyAdd).toHaveBeenCalledOnce()
    const written = mockReplyAdd.mock.calls[0][0] as { body: string }
    expect(written.body).toMatch(/Reply received/)
    expect(written.body).toMatch(/404/)
    // Status bump still happens — admin needs to see the row.
    expect(mockFeedbackUpdate).toHaveBeenCalledOnce()
  })

  it('strips HTML when text is absent but html is present', async () => {
    globalThis.fetch = vi.fn(async () =>
      new Response(JSON.stringify({ html: '<p>Hi <b>there</b></p><p>Two notes.</p>' }), {
        status: 200,
      })
    ) as unknown as typeof fetch
    const res = await POST(makeRequest(receivedEvent()))
    expect(res.status).toBe(200)
    const written = mockReplyAdd.mock.calls[0][0] as { body: string }
    expect(written.body).toContain('Hi there')
    expect(written.body).toContain('Two notes.')
    expect(written.body).not.toContain('<p>')
  })
})
