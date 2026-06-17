import { describe, it, expect, vi, beforeEach } from 'vitest'
import { GET } from '../route'

// =============================================================================
// CRON NOTIFY-DIGEST TESTS (#65)
//
// One daily cross-brief digest: query every project with pending maker
// activity (notify_pending_since set), send ONE email, clear the markers.
// =============================================================================

type DocLike = { id: string; data: () => Record<string, unknown>; ref: { id: string } }
let pendingDocs: DocLike[] = []

const mockBatchUpdate = vi.fn()
const mockBatchCommit = vi.fn(async () => {})

const mockCollection = vi.fn(() => ({
  where: vi.fn(() => ({
    get: async () => ({ docs: pendingDocs, empty: pendingDocs.length === 0, size: pendingDocs.length }),
  })),
}))

vi.mock('@/lib/api/firebase-server-helpers', () => ({
  getAdminDb: () => ({
    collection: mockCollection,
    batch: () => ({ update: mockBatchUpdate, commit: mockBatchCommit }),
  }),
}))

const mockSend = vi.fn(async () => ({ data: { id: 'email-1' }, error: null }))
vi.mock('resend', () => ({
  Resend: class {
    emails = { send: mockSend }
  },
}))

const doc = (id: string, data: Record<string, unknown>): DocLike => ({
  id,
  data: () => data,
  ref: { id },
})

beforeEach(() => {
  pendingDocs = []
  mockSend.mockReset().mockResolvedValue({ data: { id: 'email-1' }, error: null })
  mockBatchUpdate.mockReset()
  mockBatchCommit.mockReset().mockResolvedValue(undefined)
  process.env.CRON_SECRET = 'test-secret'
  process.env.RESEND_API_KEY = 'test-key'
})

const req = (auth?: string) =>
  new Request('http://localhost/api/cron/notify-digest', {
    headers: auth ? { Authorization: auth } : {},
  })

describe('GET /api/cron/notify-digest', () => {
  it('rejects requests without the cron secret', async () => {
    const res = await GET(req())
    expect(res.status).toBe(401)
    expect(mockSend).not.toHaveBeenCalled()
  })

  it('sends no email when nothing is pending', async () => {
    const res = await GET(req('Bearer test-secret'))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.sent).toBe(false)
    expect(mockSend).not.toHaveBeenCalled()
  })

  it('sends ONE digest for multiple pending briefs and clears their markers', async () => {
    pendingDocs = [
      doc('p1', {
        title: 'Cafe App',
        slug: 'cafe-app',
        requester_first_name: 'Sam',
        requester_email: 'sam@example.com',
        notify_pending_since: '2026-06-15T17:00:00Z',
      }),
      doc('p2', {
        title: 'Music App',
        slug: 'music-app',
        requester_first_name: 'Owen',
        notify_pending_since: '2026-06-15T18:00:00Z',
      }),
    ]

    const res = await GET(req('Bearer test-secret'))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.sent).toBe(true)
    expect(body.briefs).toBe(2)

    // Exactly one email, listing both briefs.
    expect(mockSend).toHaveBeenCalledOnce()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const call = (mockSend.mock.calls as any[][])[0][0] as { subject: string; text: string }
    expect(call.subject).toBe('2 briefs have new messages')
    expect(call.text).toContain('Cafe App')
    expect(call.text).toContain('Music App')

    // Both briefs' markers cleared after send.
    expect(mockBatchUpdate).toHaveBeenCalledTimes(2)
    expect(mockBatchUpdate).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ notify_after: null, notify_pending_since: null }),
    )
    expect(mockBatchCommit).toHaveBeenCalledOnce()
  })

  it('does not clear markers when the send fails (retries next run)', async () => {
    pendingDocs = [doc('p1', { title: 'Cafe App', slug: 'cafe-app', notify_pending_since: '2026-06-15T17:00:00Z' })]
    mockSend.mockRejectedValueOnce(new Error('resend down'))
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})

    const res = await GET(req('Bearer test-secret'))
    expect(res.status).toBe(500)
    expect(mockBatchCommit).not.toHaveBeenCalled()
    consoleError.mockRestore()
  })
})
