import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mocks must be declared before the route import.

type ProjectDoc = {
  id: string
  data: () => Record<string, unknown>
  ref: { update: ReturnType<typeof vi.fn> }
}

let mockProjects: ProjectDoc[] = []
const mockReminderLogAdd = vi.fn<(doc: Record<string, unknown>) => Promise<{ id: string }>>(
  async () => ({ id: 'log-1' }),
)

const mockCollection = vi.fn((name: string) => {
  if (name === 'projects') {
    return {
      where: vi.fn((_field: string, _op: string, _value: unknown) => ({
        get: async () => ({ docs: mockProjects, size: mockProjects.length }),
      })),
    }
  }
  if (name === 'reminder_log') {
    return { add: mockReminderLogAdd }
  }
  return { where: vi.fn(() => ({ get: async () => ({ docs: [], size: 0 }) })) }
})

vi.mock('@/lib/api/firebase-server-helpers', () => ({
  getAdminDb: () => ({ collection: mockCollection }),
}))

const mockSendDigest = vi.fn(
  async (_batch: unknown) => ({ emailId: 'em_1', dryRun: false }),
)
vi.mock('@/lib/email/send-reminder', () => ({
  sendReminderDigest: (...args: unknown[]) =>
    mockSendDigest(...(args as Parameters<typeof mockSendDigest>)),
}))

import { GET } from '../route'

const day = (n: number) => new Date(Date.now() - n * 24 * 60 * 60 * 1000).toISOString()

function makeProject(overrides: Record<string, unknown>): ProjectDoc {
  return {
    id: (overrides.id as string) || 'p1',
    ref: { update: vi.fn(async () => {}) },
    data: () => ({
      title: 'Test Project',
      slug: 'test-project',
      requester_email: 'maker@example.com',
      auto_reminders_enabled: true,
      reminders_sent_count: 0,
      ...overrides,
    }),
  }
}

function makeReq() {
  return new Request('http://localhost/api/cron/maker-reminders', {
    headers: { Authorization: 'Bearer test-secret' },
  })
}

describe('GET /api/cron/maker-reminders', () => {
  beforeEach(() => {
    mockProjects = []
    mockSendDigest.mockClear()
    mockSendDigest.mockResolvedValue({ emailId: 'em_1', dryRun: false })
    mockReminderLogAdd.mockClear()
    mockCollection.mockClear()
    process.env.CRON_SECRET = 'test-secret'
  })

  it('rejects requests without the cron secret', async () => {
    const req = new Request('http://localhost/api/cron/maker-reminders')
    const res = await GET(req)
    expect(res.status).toBe(401)
    expect(mockSendDigest).not.toHaveBeenCalled()
  })

  it('sends reminder #1 when a project is past the 2-day cadence', async () => {
    const proj = makeProject({ latest_session_created_at: day(3) })
    mockProjects = [proj]

    const res = await GET(makeReq())
    const body = await res.json()

    expect(mockSendDigest).toHaveBeenCalledOnce()
    expect(body.sent).toBe(1)
    expect(body.skipped).toBe(0)

    // count was incremented + last_reminder_sent_at set
    const update = proj.ref.update.mock.calls[0][0]
    expect(update.reminders_sent_count).toBe(1)
    expect(typeof update.last_reminder_sent_at).toBe('string')

    expect(mockReminderLogAdd).toHaveBeenCalledOnce()
    const logged = mockReminderLogAdd.mock.calls[0][0]
    expect(logged.decision).toBe('sent')
    expect(typeof logged.decided_at).toBe('string')
  })

  it('logs a skipped decision row (every decision is recorded)', async () => {
    mockProjects = [
      makeProject({
        reminders_sent_count: 3,
        last_reminder_sent_at: day(30),
        latest_session_created_at: day(40),
      }),
    ]

    await GET(makeReq())

    expect(mockReminderLogAdd).toHaveBeenCalledOnce()
    const logged = mockReminderLogAdd.mock.calls[0][0]
    expect(logged.decision).toBe('skipped')
    expect(logged.reason).toBe('cap_reached')
  })

  it('skips when the cap of 3 reminders has been reached', async () => {
    mockProjects = [
      makeProject({
        reminders_sent_count: 3,
        last_reminder_sent_at: day(30),
        latest_session_created_at: day(40),
      }),
    ]

    const res = await GET(makeReq())
    const body = await res.json()

    expect(mockSendDigest).not.toHaveBeenCalled()
    expect(body.sent).toBe(0)
    expect(body.skipped).toBe(1)
    expect(body.outcomes[0].reason).toBe('cap_reached')
  })

  it('skips when the maker has messaged in the current session', async () => {
    mockProjects = [
      makeProject({
        latest_session_created_at: day(5),
        last_maker_message_at: day(1),
      }),
    ]

    const res = await GET(makeReq())
    const body = await res.json()

    expect(mockSendDigest).not.toHaveBeenCalled()
    expect(body.outcomes[0].reason).toBe('maker_already_responded')
  })

  it('continues to the next maker when one batch fails to send', async () => {
    // Distinct emails → two batches, so one failing send doesn't block the other.
    const failing = makeProject({
      id: 'p_fail',
      requester_email: 'fail@example.com',
      latest_session_created_at: day(3),
    })
    const ok = makeProject({
      id: 'p_ok',
      requester_email: 'ok@example.com',
      latest_session_created_at: day(3),
    })
    mockProjects = [failing, ok]

    // Batches are ordered by email: fail@ before ok@.
    mockSendDigest
      .mockRejectedValueOnce(new Error('Resend exploded'))
      .mockResolvedValueOnce({ emailId: 'em_ok', dryRun: false })

    const res = await GET(makeReq())
    const body = await res.json()

    expect(body.errors).toBe(1)
    expect(body.sent).toBe(1)
    // the failing batch's project should NOT have its count incremented
    expect(failing.ref.update).not.toHaveBeenCalled()
    expect(ok.ref.update).toHaveBeenCalled()
  })

  it('sends ONE email for two briefs sharing a maker email, advancing both', async () => {
    const a = makeProject({ id: 'p_a', title: 'Brief A', latest_session_created_at: day(3) })
    const b = makeProject({ id: 'p_b', title: 'Brief B', latest_session_created_at: day(3) })
    mockProjects = [a, b]

    const res = await GET(makeReq())
    const body = await res.json()

    // Both briefs share maker@example.com → exactly one send call.
    expect(mockSendDigest).toHaveBeenCalledOnce()
    const batch = mockSendDigest.mock.calls[0][0] as { email: string; items: unknown[] }
    expect(batch.email).toBe('maker@example.com')
    expect(batch.items).toHaveLength(2)

    // But each project advances its own counter + logs its own row.
    expect(a.ref.update).toHaveBeenCalledOnce()
    expect(b.ref.update).toHaveBeenCalledOnce()
    expect(body.sent).toBe(2)
    expect(body.emails).toBe(1)
    expect(mockReminderLogAdd).toHaveBeenCalledTimes(2)
    // Both log rows carry the SAME email_id (the batch marker).
    const ids = mockReminderLogAdd.mock.calls.map((c) => c[0].email_id)
    expect(ids).toEqual(['em_1', 'em_1'])
  })

  it('records a would_send in dry-run WITHOUT advancing the cadence counters', async () => {
    const proj = makeProject({ latest_session_created_at: day(3) })
    mockProjects = [proj]
    mockSendDigest.mockResolvedValueOnce({ emailId: 'dry-run', dryRun: true })

    const res = await GET(makeReq())
    const body = await res.json()

    expect(mockReminderLogAdd).toHaveBeenCalledOnce()
    const logged = mockReminderLogAdd.mock.calls[0][0]
    expect(logged.decision).toBe('would_send')
    expect(logged.dry_run).toBe(true)
    expect(logged.email_id).toBe('dry-run')

    // Dry-run must not consume the real maker's reminder budget.
    expect(proj.ref.update).not.toHaveBeenCalled()
    expect(body.would_send).toBe(1)
    expect(body.sent).toBe(0)
  })
})
