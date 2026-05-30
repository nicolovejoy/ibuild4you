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

const mockSendReminder = vi.fn(async () => ({ emailId: 'em_1', dryRun: false }))
vi.mock('@/lib/email/send-reminder', () => ({
  sendReminderEmail: (...args: unknown[]) =>
    mockSendReminder(...(args as Parameters<typeof mockSendReminder>)),
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
    mockSendReminder.mockClear()
    mockSendReminder.mockResolvedValue({ emailId: 'em_1', dryRun: false })
    mockReminderLogAdd.mockClear()
    mockCollection.mockClear()
    process.env.CRON_SECRET = 'test-secret'
  })

  it('rejects requests without the cron secret', async () => {
    const req = new Request('http://localhost/api/cron/maker-reminders')
    const res = await GET(req)
    expect(res.status).toBe(401)
    expect(mockSendReminder).not.toHaveBeenCalled()
  })

  it('sends reminder #1 when a project is past the 2-day cadence', async () => {
    const proj = makeProject({ latest_session_created_at: day(3) })
    mockProjects = [proj]

    const res = await GET(makeReq())
    const body = await res.json()

    expect(mockSendReminder).toHaveBeenCalledOnce()
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

    expect(mockSendReminder).not.toHaveBeenCalled()
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

    expect(mockSendReminder).not.toHaveBeenCalled()
    expect(body.outcomes[0].reason).toBe('maker_already_responded')
  })

  it('continues to the next project when one project fails to send', async () => {
    const failing = makeProject({ id: 'p_fail', latest_session_created_at: day(3) })
    const ok = makeProject({ id: 'p_ok', latest_session_created_at: day(3) })
    mockProjects = [failing, ok]

    mockSendReminder
      .mockRejectedValueOnce(new Error('Resend exploded'))
      .mockResolvedValueOnce({ emailId: 'em_ok', dryRun: false })

    const res = await GET(makeReq())
    const body = await res.json()

    expect(body.errors).toBe(1)
    expect(body.sent).toBe(1)
    // the failing project should NOT have its count incremented
    expect(failing.ref.update).not.toHaveBeenCalled()
    expect(ok.ref.update).toHaveBeenCalled()
  })

  it('records a would_send in dry-run WITHOUT advancing the cadence counters', async () => {
    const proj = makeProject({ latest_session_created_at: day(3) })
    mockProjects = [proj]
    mockSendReminder.mockResolvedValueOnce({ emailId: 'dry-run', dryRun: true })

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
