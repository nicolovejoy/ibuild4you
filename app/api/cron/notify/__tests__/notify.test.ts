import { describe, it, expect, vi, beforeEach } from 'vitest'
import { GET } from '../route'

// =============================================================================
// CRON NOTIFY TESTS
//
// The route writes notes for projects idle ≥10 min that no note covers yet. (Notification email moved out to /api/cron/notify-digest — #65.)
//
// The mock supports multiple where() calls per collection by keying results
// on the field name passed to .where(), so the two idle queries
// (last_maker_message_at and last_email_at) return separate lists and a
// project put in both lists exercises the route's merge. The mock does not
// apply the '<' cutoff itself: a doc in a list is returned as is, so the
// route's own idle check is what the tests exercise. The briefs lookup uses
// where(...).orderBy(...).limit(...).get() — modeled explicitly.
// =============================================================================

// Per-collection, per-where-field results
type DocLike = { id: string; data: () => Record<string, unknown>; ref?: { update: typeof mockDoc.update } }
const whereResults: Record<string, Record<string, DocLike[]>> = {}
const briefResults: Record<string, DocLike[]> = {} // keyed by project_id (where('project_id','==',X))
const memberResults: Record<string, DocLike[]> = {} // project_members keyed by project_id
// Every projects where() call, to check both idle queries run with the same cutoff.
const projectWheres: { field: string; op: string; value: unknown }[] = []

const mockDoc = {
  update: vi.fn(async () => {}),
}

const mockCollection = vi.fn((name: string) => ({
  where: vi.fn((field: string, op: string, value: unknown) => {
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
    if (name === 'projects') projectWheres.push({ field, op, value })
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
  async () => ({ note_id: 'n1', covered: 3, through: '2026-04-01T00:00:00.000Z' }),
)
vi.mock('@/lib/api/note-writer', () => ({
  writeNoteForProject: (db: unknown, projectId: string) => mockRegenerate(db, projectId),
}))

beforeEach(() => {
  mockDoc.update.mockReset()
  mockSend.mockReset()
  mockRegenerate.mockReset().mockResolvedValue({ note_id: 'n1', covered: 3, through: '2026-04-01T00:00:00.000Z' })
  for (const k of Object.keys(whereResults)) delete whereResults[k]
  for (const k of Object.keys(briefResults)) delete briefResults[k]
  for (const k of Object.keys(memberResults)) delete memberResults[k]
  projectWheres.length = 0
  whereResults.projects = {}
  process.env.CRON_SECRET = 'test-secret'
  process.env.RESEND_API_KEY = 'test-key'
})

const req = (auth?: string) =>
  new Request('http://localhost/api/cron/notify', {
    headers: auth ? { Authorization: auth } : {},
  })

describe('GET /api/cron/notify — auth', () => {
  it('rejects requests without the cron secret', async () => {
    const res = await GET(req())
    expect(res.status).toBe(401)
  })

  it('accepts requests with the cron secret', async () => {
    const res = await GET(req('Bearer test-secret'))
    expect(res.status).toBe(200)
  })

  it('sends no notification email — that moved to /api/cron/notify-digest', async () => {
    whereResults.projects.notify_after = [
      {
        id: 'p1',
        data: () => ({ title: 'Cafe App', slug: 'cafe-app', notify_pending_since: '2026-04-14T17:00:00Z' }),
        ref: { update: mockDoc.update },
      },
    ]
    const res = await GET(req('Bearer test-secret'))
    expect(res.status).toBe(200)
    expect(mockSend).not.toHaveBeenCalled()
  })
})

describe('GET /api/cron/notify — idle brief regeneration', () => {
  it('calls writeNoteForProject for an idle project', async () => {
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
    expect(body.notes_written).toBe(1)
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
    expect(body.notes_written).toBe(0)
    expect(mockRegenerate).not.toHaveBeenCalled()
  })

  it('skips when notes_through_at >= last_maker_message_at', async () => {
    const lastMakerAt = new Date(Date.now() - 12 * 60 * 1000).toISOString()
    whereResults.projects.last_maker_message_at = [
      {
        id: 'p1',
        data: () => ({ last_maker_message_at: lastMakerAt, notes_through_at: lastMakerAt }),
        ref: { update: mockDoc.update },
      },
    ]
    // Brief is old, but a note already covers the last maker turn.
    briefResults.p1 = [{ id: 'brief-1', data: () => ({ updated_at: '2026-04-01T00:00:00.000Z' }) }]

    const body = await (await GET(req('Bearer test-secret'))).json()
    expect(body.notes_written).toBe(0)
    expect(mockRegenerate).not.toHaveBeenCalled()
  })

  it('writes a note when notes_through_at is older than the last maker turn', async () => {
    const lastMakerAt = new Date(Date.now() - 12 * 60 * 1000).toISOString()
    whereResults.projects.last_maker_message_at = [
      {
        id: 'p1',
        data: () => ({ last_maker_message_at: lastMakerAt, notes_through_at: '2026-04-01T00:00:00.000Z' }),
        ref: { update: mockDoc.update },
      },
    ]
    const body = await (await GET(req('Bearer test-secret'))).json()
    expect(body.notes_written).toBe(1)
  })

  it('writes a note when no brief exists yet', async () => {
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
    expect(body.notes_written).toBe(1)
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
      .mockResolvedValueOnce({ note_id: 'n2', covered: 1, through: '2026-04-01T00:00:00.000Z' })
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})

    const res = await GET(req('Bearer test-secret'))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.notes_written).toBe(1)
    expect(body.regen_errors).toEqual(['p1'])
    consoleError.mockRestore()
  })

  it('does nothing when no project is idle', async () => {
    // whereResults.projects.last_maker_message_at unset → no idle projects
    const res = await GET(req('Bearer test-secret'))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.notes_written).toBe(0)
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
    mockRegenerate.mockRejectedValueOnce(new Error('write_note_max_tokens'))
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})

    await GET(req('Bearer test-secret'))

    expect(mockDoc.update).toHaveBeenCalledWith(
      expect.objectContaining({
        brief_regen_failures: 1,
        brief_regen_last_error: 'write_note_max_tokens',
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
    expect(body.notes_written).toBe(0)
    expect(body.circuit_broken).toBe(1)
    expect(mockRegenerate).not.toHaveBeenCalled()
  })

  it('clears the circuit breaker once the maker has messaged after the failure streak', async () => {
    // A maker turn after the streak began, and itself idle (30m ago): a turn
    // under 10 min old is not idle yet, so the cron would not pick it up.
    const lastMakerAt = new Date(Date.now() - 30 * 60 * 1000).toISOString()
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
    expect(body.notes_written).toBe(1)
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
    mockRegenerate.mockRejectedValueOnce(new Error('write_note_max_tokens'))
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
    expect(body.notes_written).toBe(0)
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
    expect(body.notes_written).toBe(1)
    expect(body.archived_skipped).toBe(0)
    expect(mockRegenerate).toHaveBeenCalledWith(expect.anything(), 'p1')
  })
})

describe('GET /api/cron/notify — email activity (email-in)', () => {
  const minsAgo = (m: number) => new Date(Date.now() - m * 60 * 1000).toISOString()

  it('runs a second idle query on last_email_at with the same cutoff', async () => {
    await GET(req('Bearer test-secret'))
    const maker = projectWheres.find((w) => w.field === 'last_maker_message_at')
    const email = projectWheres.find((w) => w.field === 'last_email_at')
    expect(maker?.op).toBe('<')
    expect(email?.op).toBe('<')
    expect(email?.value).toBe(maker?.value)
  })

  it('writes a note for a project with an 11-minute-old email and no maker message', async () => {
    whereResults.projects.last_email_at = [
      { id: 'p1', data: () => ({ last_email_at: minsAgo(11) }), ref: { update: mockDoc.update } },
    ]
    const body = await (await GET(req('Bearer test-secret'))).json()
    expect(mockRegenerate).toHaveBeenCalledWith(expect.anything(), 'p1')
    expect(body.notes_written).toBe(1)
    expect(body.idle_checked).toBe(1)
  })

  it('does not write a note while the latest email is only 2 minutes old', async () => {
    // Defensive: the real query would not return this doc, but the route's own
    // check must hold too.
    whereResults.projects.last_email_at = [
      { id: 'p1', data: () => ({ last_email_at: minsAgo(2) }), ref: { update: mockDoc.update } },
    ]
    const body = await (await GET(req('Bearer test-secret'))).json()
    expect(mockRegenerate).not.toHaveBeenCalled()
    expect(body.notes_written).toBe(0)
  })

  it('does not write a note when the maker turn is old but an email arrived 2 minutes ago', async () => {
    // The maker query matches this project; the fresh email means the thread
    // is not idle yet.
    whereResults.projects.last_maker_message_at = [
      {
        id: 'p1',
        data: () => ({ last_maker_message_at: minsAgo(60), last_email_at: minsAgo(2) }),
        ref: { update: mockDoc.update },
      },
    ]
    const body = await (await GET(req('Bearer test-secret'))).json()
    expect(mockRegenerate).not.toHaveBeenCalled()
    expect(body.notes_written).toBe(0)
  })

  it('does not write a note when the email is old but a maker turn came 2 minutes ago', async () => {
    whereResults.projects.last_email_at = [
      {
        id: 'p1',
        data: () => ({ last_maker_message_at: minsAgo(2), last_email_at: minsAgo(60) }),
        ref: { update: mockDoc.update },
      },
    ]
    const body = await (await GET(req('Bearer test-secret'))).json()
    expect(mockRegenerate).not.toHaveBeenCalled()
    expect(body.notes_written).toBe(0)
  })

  it('skips when notes_through_at is at the email', async () => {
    const emailAt = minsAgo(11)
    whereResults.projects.last_email_at = [
      { id: 'p1', data: () => ({ last_email_at: emailAt, notes_through_at: emailAt }), ref: { update: mockDoc.update } },
    ]
    const body = await (await GET(req('Bearer test-secret'))).json()
    expect(mockRegenerate).not.toHaveBeenCalled()
    expect(body.notes_written).toBe(0)
  })

  it('skips when notes_through_at is past the email', async () => {
    whereResults.projects.last_email_at = [
      {
        id: 'p1',
        data: () => ({ last_email_at: minsAgo(11), notes_through_at: minsAgo(5) }),
        ref: { update: mockDoc.update },
      },
    ]
    const body = await (await GET(req('Bearer test-secret'))).json()
    expect(mockRegenerate).not.toHaveBeenCalled()
    expect(body.notes_written).toBe(0)
  })

  it('writes a note when an email is newer than notes_through_at, though the maker turn is covered', async () => {
    whereResults.projects.last_maker_message_at = [
      {
        id: 'p1',
        data: () => ({
          last_maker_message_at: minsAgo(60),
          notes_through_at: minsAgo(60),
          last_email_at: minsAgo(15),
        }),
        ref: { update: mockDoc.update },
      },
    ]
    const body = await (await GET(req('Bearer test-secret'))).json()
    expect(mockRegenerate).toHaveBeenCalledWith(expect.anything(), 'p1')
    expect(body.notes_written).toBe(1)
  })

  // F3: an address minted on a project with no brief sets notes_through_at to
  // the epoch. A brief created later must not make the email look covered.
  it('an epoch notes_through_at covers nothing, whatever the brief age', async () => {
    whereResults.projects.last_email_at = [
      {
        id: 'p1',
        data: () => ({ last_email_at: minsAgo(30), notes_through_at: '1970-01-01T00:00:00.000Z' }),
        ref: { update: mockDoc.update },
      },
    ]
    briefResults.p1 = [{ id: 'b1', data: () => ({ updated_at: minsAgo(20) }) }]
    const body = await (await GET(req('Bearer test-secret'))).json()
    expect(mockRegenerate).toHaveBeenCalledWith(expect.anything(), 'p1')
    expect(body.notes_written).toBe(1)
  })

  it('falls back to the brief age against the email when no note exists yet', async () => {
    whereResults.projects.last_email_at = [
      { id: 'p1', data: () => ({ last_email_at: minsAgo(30) }), ref: { update: mockDoc.update } },
    ]
    // The brief was updated after the email: already covered.
    briefResults.p1 = [{ id: 'b1', data: () => ({ updated_at: minsAgo(20) }) }]
    const body = await (await GET(req('Bearer test-secret'))).json()
    expect(mockRegenerate).not.toHaveBeenCalled()
    expect(body.notes_written).toBe(0)
  })

  it('retries a project three failures deep when an email is newer than the streak', async () => {
    whereResults.projects.last_email_at = [
      {
        id: 'p1',
        data: () => ({
          last_maker_message_at: minsAgo(120),
          last_email_at: minsAgo(15),
          brief_regen_failures: 3,
          brief_regen_failures_since: minsAgo(60),
        }),
        ref: { update: mockDoc.update },
      },
    ]
    const body = await (await GET(req('Bearer test-secret'))).json()
    expect(body.circuit_broken).toBe(0)
    expect(mockRegenerate).toHaveBeenCalledWith(expect.anything(), 'p1')
    expect(body.notes_written).toBe(1)
  })

  it('keeps the breaker tripped when the email is older than the streak', async () => {
    whereResults.projects.last_email_at = [
      {
        id: 'p1',
        data: () => ({
          last_email_at: minsAgo(90),
          brief_regen_failures: 3,
          brief_regen_failures_since: minsAgo(60),
        }),
        ref: { update: mockDoc.update },
      },
    ]
    const body = await (await GET(req('Bearer test-secret'))).json()
    expect(body.circuit_broken).toBe(1)
    expect(mockRegenerate).not.toHaveBeenCalled()
  })

  it('processes a project matched by both queries once, and counts it once', async () => {
    const data = { last_maker_message_at: minsAgo(30), last_email_at: minsAgo(20) }
    whereResults.projects.last_maker_message_at = [
      { id: 'p1', data: () => data, ref: { update: mockDoc.update } },
    ]
    whereResults.projects.last_email_at = [
      { id: 'p1', data: () => data, ref: { update: mockDoc.update } },
      { id: 'p2', data: () => ({ last_email_at: minsAgo(20) }), ref: { update: mockDoc.update } },
    ]
    const body = await (await GET(req('Bearer test-secret'))).json()
    expect(mockRegenerate).toHaveBeenCalledTimes(2)
    expect(mockRegenerate.mock.calls.map((c) => c[1]).sort()).toEqual(['p1', 'p2'])
    expect(body.notes_written).toBe(2)
    expect(body.idle_checked).toBe(2)
  })

  it('never writes last_maker_message_at from an email', async () => {
    whereResults.projects.last_email_at = [
      { id: 'p1', data: () => ({ last_email_at: minsAgo(11) }), ref: { update: mockDoc.update } },
    ]
    mockRegenerate.mockRejectedValueOnce(new Error('boom'))
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    await GET(req('Bearer test-secret'))
    for (const call of mockDoc.update.mock.calls as unknown as [Record<string, unknown>][]) {
      expect(call[0]).not.toHaveProperty('last_maker_message_at')
    }
    consoleError.mockRestore()
  })
})
