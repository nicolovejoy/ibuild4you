import { describe, it, expect, vi, beforeEach } from 'vitest'
import { GET } from '../route'

// =============================================================================
// CRON NOTIFY TESTS
//
// The route does two things on each tick:
//   1. Send digest emails for projects whose notify_after has passed
//   2. Auto-regenerate briefs for projects idle ≥10 min with stale briefs
//
// The mock supports multiple where() calls per collection by keying results
// on the field name passed to .where(). The briefs lookup uses
// where(...).orderBy(...).limit(...).get() — modeled explicitly.
// =============================================================================

// Per-collection, per-where-field results
type DocLike = { id: string; data: () => Record<string, unknown>; ref?: { update: typeof mockDoc.update } }
const whereResults: Record<string, Record<string, DocLike[]>> = {}
const briefResults: Record<string, DocLike[]> = {} // keyed by project_id (where('project_id','==',X))
const memberResults: Record<string, DocLike[]> = {} // project_members keyed by project_id

const mockDoc = {
  update: vi.fn(async () => {}),
}

const mockCollection = vi.fn((name: string) => ({
  where: vi.fn((field: string, _op: string, value: unknown) => {
    // briefs lookup: where('project_id','==',X).orderBy(...).limit(...).get()
    if (name === 'briefs' && field === 'project_id') {
      const docs = briefResults[String(value)] || []
      return {
        orderBy: () => ({
          limit: () => ({
            get: async () => ({ docs, empty: docs.length === 0, size: docs.length }),
          }),
        }),
      }
    }
    // project_members lookup: where('project_id','==',X).get()
    if (name === 'project_members' && field === 'project_id') {
      const docs = memberResults[String(value)] || []
      return { get: async () => ({ docs, empty: docs.length === 0, size: docs.length }) }
    }
    // projects lookup: where(field, '<', cutoff).get()
    const docs = whereResults[name]?.[field] || []
    return { get: async () => ({ docs, size: docs.length }) }
  }),
  doc: vi.fn(() => mockDoc),
}))

vi.mock('@/lib/api/firebase-server-helpers', () => ({
  getAdminDb: () => ({ collection: mockCollection }),
}))

const mockSend = vi.fn(async () => ({ data: { id: 'email-1' }, error: null }))
vi.mock('resend', () => ({
  Resend: class {
    emails = { send: mockSend }
  },
}))

const mockRegenerate = vi.fn<(db: unknown, projectId: string) => Promise<unknown>>(
  async () => ({ id: 'brief-1', version: 2 }),
)
vi.mock('@/lib/api/briefs', () => ({
  regenerateBriefForProject: (db: unknown, projectId: string) => mockRegenerate(db, projectId),
}))

beforeEach(() => {
  mockDoc.update.mockReset()
  mockSend.mockReset()
  mockRegenerate.mockReset().mockResolvedValue({ id: 'brief-1', version: 2 })
  for (const k of Object.keys(whereResults)) delete whereResults[k]
  for (const k of Object.keys(briefResults)) delete briefResults[k]
  for (const k of Object.keys(memberResults)) delete memberResults[k]
  whereResults.projects = {}
  process.env.CRON_SECRET = 'test-secret'
  process.env.RESEND_API_KEY = 'test-key'
})

const req = (auth?: string) =>
  new Request('http://localhost/api/cron/notify', {
    headers: auth ? { Authorization: auth } : {},
  })

describe('GET /api/cron/notify — auth + notification digests', () => {
  it('rejects requests without the cron secret', async () => {
    const res = await GET(req())
    expect(res.status).toBe(401)
    expect(mockSend).not.toHaveBeenCalled()
  })

  it('accepts requests with the cron secret', async () => {
    const res = await GET(req('Bearer test-secret'))
    expect(res.status).toBe(200)
  })

  it('sends no email when no projects are ready', async () => {
    const res = await GET(req('Bearer test-secret'))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.sent).toBe(0)
    expect(mockSend).not.toHaveBeenCalled()
  })

  it('sends email and clears notify_after for ready projects', async () => {
    whereResults.projects.notify_after = [
      {
        id: 'p1',
        data: () => ({
          title: 'Cafe App',
          slug: 'cafe-app',
          requester_first_name: 'Sam',
          requester_email: 'sam@example.com',
          notify_pending_since: '2026-04-14T17:00:00Z',
        }),
        ref: { update: mockDoc.update },
      },
    ]

    const res = await GET(req('Bearer test-secret'))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.sent).toBe(1)
    expect(mockSend).toHaveBeenCalledOnce()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const call = (mockSend.mock.calls as any[][])[0][0] as { subject: string; to: string[] }
    expect(call.subject).toContain('Cafe App')
    expect(call.subject).toContain('Sam')
    expect(mockDoc.update).toHaveBeenCalledWith(
      expect.objectContaining({ notify_after: null, notify_pending_since: null }),
    )
  })
})

describe('GET /api/cron/notify — idle brief regeneration', () => {
  it('regenerates the brief for an idle project with a stale brief', async () => {
    // Maker last sent something 12 min ago — idle
    const lastMakerAt = new Date(Date.now() - 12 * 60 * 1000).toISOString()
    whereResults.projects.last_maker_message_at = [
      {
        id: 'p1',
        data: () => ({ last_maker_message_at: lastMakerAt }),
        ref: { update: mockDoc.update },
      },
    ]
    // Brief is older than the last maker turn — stale
    briefResults.p1 = [
      {
        id: 'brief-1',
        data: () => ({ updated_at: '2026-04-01T00:00:00.000Z' }),
      },
    ]

    const res = await GET(req('Bearer test-secret'))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.regenerated).toBe(1)
    expect(mockRegenerate).toHaveBeenCalledWith(expect.anything(), 'p1')
  })

  it('skips regeneration when the brief is already fresher than the last maker turn', async () => {
    const lastMakerAt = new Date(Date.now() - 12 * 60 * 1000).toISOString()
    whereResults.projects.last_maker_message_at = [
      {
        id: 'p1',
        data: () => ({ last_maker_message_at: lastMakerAt }),
        ref: { update: mockDoc.update },
      },
    ]
    // Brief was updated more recently than the last maker turn
    briefResults.p1 = [
      {
        id: 'brief-1',
        data: () => ({ updated_at: new Date().toISOString() }),
      },
    ]

    const res = await GET(req('Bearer test-secret'))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.regenerated).toBe(0)
    expect(mockRegenerate).not.toHaveBeenCalled()
  })

  it('regenerates when no brief exists yet', async () => {
    const lastMakerAt = new Date(Date.now() - 12 * 60 * 1000).toISOString()
    whereResults.projects.last_maker_message_at = [
      {
        id: 'p1',
        data: () => ({ last_maker_message_at: lastMakerAt }),
        ref: { update: mockDoc.update },
      },
    ]
    // briefResults.p1 unset → empty briefs collection for this project

    const res = await GET(req('Bearer test-secret'))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.regenerated).toBe(1)
    expect(mockRegenerate).toHaveBeenCalledWith(expect.anything(), 'p1')
  })

  it('reports regen errors without breaking the cron loop', async () => {
    const lastMakerAt = new Date(Date.now() - 12 * 60 * 1000).toISOString()
    whereResults.projects.last_maker_message_at = [
      {
        id: 'p1',
        data: () => ({ last_maker_message_at: lastMakerAt }),
        ref: { update: mockDoc.update },
      },
      {
        id: 'p2',
        data: () => ({ last_maker_message_at: lastMakerAt }),
        ref: { update: mockDoc.update },
      },
    ]
    mockRegenerate
      .mockRejectedValueOnce(new Error('claude unhappy'))
      .mockResolvedValueOnce({ id: 'brief-2', version: 1 })
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})

    const res = await GET(req('Bearer test-secret'))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.regenerated).toBe(1)
    expect(body.regen_errors).toEqual(['p1'])
    consoleError.mockRestore()
  })

  it('does nothing when no project is idle', async () => {
    // whereResults.projects.last_maker_message_at unset → no idle projects
    const res = await GET(req('Bearer test-secret'))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.regenerated).toBe(0)
    expect(mockRegenerate).not.toHaveBeenCalled()
  })

  it('increments the failure counter when regen throws', async () => {
    const lastMakerAt = new Date(Date.now() - 12 * 60 * 1000).toISOString()
    whereResults.projects.last_maker_message_at = [
      {
        id: 'p1',
        data: () => ({ last_maker_message_at: lastMakerAt }),
        ref: { update: mockDoc.update },
      },
    ]
    mockRegenerate.mockRejectedValueOnce(new Error('regenerate_brief_max_tokens'))
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})

    await GET(req('Bearer test-secret'))

    expect(mockDoc.update).toHaveBeenCalledWith(
      expect.objectContaining({
        brief_regen_failures: 1,
        brief_regen_last_error: 'regenerate_brief_max_tokens',
      }),
    )
    consoleError.mockRestore()
  })

  it('trips the circuit breaker after the failure cap and stops calling regen', async () => {
    // Maker last messaged 60 min ago; failure streak started 20 min ago → no new maker
    // turn since the streak, breaker stays tripped.
    const lastMakerAt = new Date(Date.now() - 60 * 60 * 1000).toISOString()
    const failuresSince = new Date(Date.now() - 20 * 60 * 1000).toISOString()
    whereResults.projects.last_maker_message_at = [
      {
        id: 'p1',
        data: () => ({
          last_maker_message_at: lastMakerAt,
          brief_regen_failures: 3,
          brief_regen_failures_since: failuresSince,
        }),
        ref: { update: mockDoc.update },
      },
    ]

    const res = await GET(req('Bearer test-secret'))
    const body = await res.json()
    expect(body.regenerated).toBe(0)
    expect(body.circuit_broken).toBe(1)
    expect(mockRegenerate).not.toHaveBeenCalled()
  })

  it('clears the circuit breaker once the maker has messaged after the failure streak', async () => {
    const lastMakerAt = new Date().toISOString() // fresh maker turn
    const failuresSince = new Date(Date.now() - 60 * 60 * 1000).toISOString() // 1hr ago
    whereResults.projects.last_maker_message_at = [
      {
        id: 'p1',
        data: () => ({
          last_maker_message_at: lastMakerAt,
          brief_regen_failures: 3,
          brief_regen_failures_since: failuresSince,
        }),
        ref: { update: mockDoc.update },
      },
    ]

    const res = await GET(req('Bearer test-secret'))
    const body = await res.json()
    expect(body.regenerated).toBe(1)
    expect(mockRegenerate).toHaveBeenCalledWith(expect.anything(), 'p1')
    // On success any stale failure counter is cleared.
    expect(mockDoc.update).toHaveBeenCalledWith(
      expect.objectContaining({ brief_regen_failures: 0 }),
    )
  })

  // Regression for the 2026-06-15 cost runaway: when a maker messages after a
  // (capped) failure streak, the cron resets the streak and retries. If that
  // retry fails again, the new failure must start a FRESH streak (count=1, since
  // anchored to now) — NOT bump the old count to 4 with the stale timestamp,
  // which made the breaker re-clear every tick and bill forever.
  it('restarts the failure streak on a post-maker-message retry (does not reuse the stale count/timestamp)', async () => {
    const lastMakerAt = new Date(Date.now() - 30 * 60 * 1000).toISOString() // 30m ago
    const staleSince = new Date(Date.now() - 60 * 60 * 1000).toISOString() // streak began 60m ago (before the maker msg)
    whereResults.projects.last_maker_message_at = [
      {
        id: 'p1',
        data: () => ({
          last_maker_message_at: lastMakerAt,
          brief_regen_failures: 3, // already at cap
          brief_regen_failures_since: staleSince,
        }),
        ref: { update: mockDoc.update },
      },
    ]
    // Stale brief so regen is attempted; it fails again.
    briefResults.p1 = [{ id: 'b1', data: () => ({ updated_at: '2026-04-01T00:00:00.000Z' }) }]
    mockRegenerate.mockRejectedValueOnce(new Error('regenerate_brief_max_tokens'))
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})

    await GET(req('Bearer test-secret'))

    // The persisted failure write must show a FRESH streak: count = 1, not 4.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const failureWrite = (mockDoc.update.mock.calls as any[][])
      .map((c) => c[0] as Record<string, unknown>)
      .find((u) => 'brief_regen_failures' in u && typeof u.brief_regen_failures === 'number' && (u.brief_regen_failures as number) > 0)
    expect(failureWrite?.brief_regen_failures).toBe(1)
    // And failuresSince anchored to ~now, not the 60m-old stale value.
    expect(failureWrite?.brief_regen_failures_since).not.toBe(staleSince)
    expect(Date.parse(failureWrite?.brief_regen_failures_since as string)).toBeGreaterThan(Date.parse(staleSince))
    consoleError.mockRestore()
  })

  it('skips regeneration when every member has archived the brief', async () => {
    const lastMakerAt = new Date(Date.now() - 12 * 60 * 1000).toISOString()
    whereResults.projects.last_maker_message_at = [
      {
        id: 'p1',
        data: () => ({ last_maker_message_at: lastMakerAt }),
        ref: { update: mockDoc.update },
      },
    ]
    briefResults.p1 = [{ id: 'b1', data: () => ({ updated_at: '2026-04-01T00:00:00.000Z' }) }]
    memberResults.p1 = [
      { id: 'm1', data: () => ({ archived_at: '2026-06-14T00:00:00Z' }) },
      { id: 'm2', data: () => ({ archived_at: '2026-06-14T00:00:00Z' }) },
    ]

    const res = await GET(req('Bearer test-secret'))
    const body = await res.json()
    expect(body.regenerated).toBe(0)
    expect(body.archived_skipped).toBe(1)
    expect(mockRegenerate).not.toHaveBeenCalled()
  })

  it('still regenerates when only SOME members archived (shared brief still in use)', async () => {
    const lastMakerAt = new Date(Date.now() - 12 * 60 * 1000).toISOString()
    whereResults.projects.last_maker_message_at = [
      {
        id: 'p1',
        data: () => ({ last_maker_message_at: lastMakerAt }),
        ref: { update: mockDoc.update },
      },
    ]
    briefResults.p1 = [{ id: 'b1', data: () => ({ updated_at: '2026-04-01T00:00:00.000Z' }) }]
    memberResults.p1 = [
      { id: 'm1', data: () => ({ archived_at: '2026-06-14T00:00:00Z' }) },
      { id: 'm2', data: () => ({ archived_at: null }) }, // still active
    ]

    const res = await GET(req('Bearer test-secret'))
    const body = await res.json()
    expect(body.regenerated).toBe(1)
    expect(body.archived_skipped).toBe(0)
    expect(mockRegenerate).toHaveBeenCalledWith(expect.anything(), 'p1')
  })
})
