import { describe, it, expect, vi, beforeEach } from 'vitest'
import { GET } from '../route'

const mockWhereChain = {
  get: vi.fn(),
}

const mockDoc = {
  update: vi.fn(async () => {}),
}

const mockCollection = vi.fn(() => ({
  where: vi.fn(() => mockWhereChain),
  doc: vi.fn(() => mockDoc),
}))

const mockCountSnap = { size: 0 }
const mockMessagesGet = vi.fn(async () => mockCountSnap)

vi.mock('@/lib/api/firebase-server-helpers', () => ({
  getAdminDb: () => ({
    collection: mockCollection,
  }),
}))

const mockSend = vi.fn(async () => ({ data: { id: 'email-1' }, error: null }))

vi.mock('resend', () => ({
  Resend: class {
    emails = { send: mockSend }
  },
}))

beforeEach(() => {
  mockWhereChain.get.mockReset()
  mockDoc.update.mockReset()
  mockSend.mockReset()
  mockCountSnap.size = 0
  mockMessagesGet.mockResolvedValue(mockCountSnap)
  process.env.CRON_SECRET = 'test-secret'
  process.env.RESEND_API_KEY = 'test-key'
})

const req = (auth?: string) =>
  new Request('http://localhost/api/cron/notify', {
    headers: auth ? { Authorization: auth } : {},
  })

describe('GET /api/cron/notify', () => {
  it('rejects requests without the cron secret', async () => {
    mockWhereChain.get.mockResolvedValue({ docs: [] })
    const res = await GET(req())
    expect(res.status).toBe(401)
    expect(mockSend).not.toHaveBeenCalled()
  })

  it('accepts requests with the cron secret', async () => {
    mockWhereChain.get.mockResolvedValue({ docs: [] })
    const res = await GET(req('Bearer test-secret'))
    expect(res.status).toBe(200)
  })

  it('sends no email when no projects are ready', async () => {
    mockWhereChain.get.mockResolvedValue({ docs: [] })
    const res = await GET(req('Bearer test-secret'))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.sent).toBe(0)
    expect(mockSend).not.toHaveBeenCalled()
  })

  it('sends email and clears notify_after for ready projects', async () => {
    mockWhereChain.get.mockResolvedValue({
      docs: [
        {
          id: 'p1',
          data: () => ({
            title: 'Bakery App',
            slug: 'bakery-app',
            requester_first_name: 'Jamie',
            requester_email: 'jamie@example.com',
            notify_pending_since: '2026-04-14T17:00:00Z',
          }),
          ref: { update: mockDoc.update },
        },
      ],
      size: 1,
    })

    const res = await GET(req('Bearer test-secret'))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.sent).toBe(1)
    expect(mockSend).toHaveBeenCalledOnce()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const call = (mockSend.mock.calls as any[][])[0][0] as { subject: string; to: string[] }
    expect(call.subject).toContain('Bakery App')
    expect(call.subject).toContain('Jamie')
    expect(mockDoc.update).toHaveBeenCalledWith(
      expect.objectContaining({ notify_after: null, notify_pending_since: null })
    )
  })
})
