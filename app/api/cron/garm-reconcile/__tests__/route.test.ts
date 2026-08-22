import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// =============================================================================
// Garm ↔ Firestore grant reconcile cron.
//
// The load-bearing case here is the `extra` bucket: an active Garm grant with
// no Firestore expectation must be REPORTED and never revoked. A Firestore read
// that fails or comes back empty would otherwise compute "revoke" for every
// user and lock out the whole userbase in one cron tick.
//
// Mocks must be declared before the route import.
// =============================================================================

type Doc = { id: string; data: () => Record<string, unknown> }

let mockMembers: Doc[] = []
let mockApproved: Doc[] = []
/** Most-recent-first prior run rows, as the repeat-missing lookup reads them. */
let mockPriorLog: Doc[] = []
const mockLogAdd = vi.fn<(doc: Record<string, unknown>) => Promise<{ id: string }>>(async () => ({
  id: 'log-1',
}))
let priorLogReadFails = false

const mockCollection = vi.fn((name: string) => {
  if (name === 'project_members') {
    return { get: async () => ({ docs: mockMembers, size: mockMembers.length }) }
  }
  if (name === 'approved_emails') {
    return { get: async () => ({ docs: mockApproved, size: mockApproved.length }) }
  }
  if (name === 'garm_reconcile_log') {
    return {
      add: mockLogAdd,
      orderBy: () => ({
        limit: () => ({
          get: async () => {
            if (priorLogReadFails) throw new Error('firestore unavailable')
            return { docs: mockPriorLog }
          },
        }),
      }),
    }
  }
  return { get: async () => ({ docs: [], size: 0 }) }
})

vi.mock('@/lib/api/firebase-server-helpers', () => ({
  getAdminDb: () => ({ collection: mockCollection }),
}))

// The real ADMIN_EMAILS holds live addresses; the candidate set unions them in
// (an admin can hold an owner grant while appearing in neither collection), so
// the suite substitutes a placeholder admin instead.
vi.mock('@/lib/constants', () => ({
  ADMIN_EMAILS: ['admin@example.com'],
  NOTIFICATION_EMAILS: ['admin@example.com'],
  isAdminEmail: (email: string | null) => email === 'admin@example.com',
}))

import { GET } from '../route'

// --- fixtures ---------------------------------------------------------------

function member(email: string, role: string, removedAt: string | null = null): Doc {
  return {
    id: `m-${email}-${role}`,
    data: () => ({ email, role, removed_at: removedAt }),
  }
}

function approved(email: string, revokedAt: string | null = null): Doc {
  return { id: email, data: () => ({ revoked_at: revokedAt }) }
}

/** A previous run's log row, as far as the repeat-missing lookup cares. */
function priorRun(missingCount: number): Doc {
  return { id: 'prev-run', data: () => ({ missing_count: missingCount }) }
}

type Grant = { email: string; role: string }

let garmGrants: Grant[] = []
let garmFetchFails = false
/** When set, the listing returns this body instead of a well-formed `{ grants }`. */
let garmListingBody: unknown = undefined
/** Emails whose upsert POST should fail, and how. */
let failPostFor: Record<string, 'status' | 'reject'> = {}

const fetchMock = vi.fn(async (input: unknown, init?: RequestInit) => {
  const url = String(input)
  if (init?.method === 'POST') {
    const email = JSON.parse(String(init.body)).email as string
    const failure = failPostFor[email]
    if (failure === 'reject') {
      // Transport-level failure whose message echoes the address back — the
      // shape that would leak PII into the log doc if it went in unfiltered.
      throw new Error(`connect ECONNREFUSED while granting ${email}`)
    }
    if (failure === 'status') return new Response('nope', { status: 500 })
    return new Response(JSON.stringify({ ok: true }), { status: 200 })
  }
  // Default (no method) is the GET of active grants.
  if (url.includes('/api/grants')) {
    if (garmFetchFails) return new Response('boom', { status: 500 })
    const body = garmListingBody === undefined ? { grants: garmGrants } : garmListingBody
    return new Response(JSON.stringify(body), { status: 200 })
  }
  throw new Error(`unexpected fetch: ${url}`)
})

function makeReq() {
  return new Request('http://localhost/api/cron/garm-reconcile', {
    headers: { Authorization: 'Bearer test-secret' },
  })
}

/** Bodies of every POST /api/grants the run issued. */
function postedGrants(): Array<{ email: string; role: string; project: string; actor: string }> {
  return fetchMock.mock.calls
    .filter(([, init]) => (init as RequestInit | undefined)?.method === 'POST')
    .map(([, init]) => JSON.parse(String((init as RequestInit).body)))
}

function lastLogDoc(): Record<string, unknown> {
  expect(mockLogAdd).toHaveBeenCalled()
  return mockLogAdd.mock.calls[mockLogAdd.mock.calls.length - 1][0]
}

describe('GET /api/cron/garm-reconcile', () => {
  beforeEach(() => {
    mockMembers = []
    mockApproved = []
    garmGrants = []
    garmFetchFails = false
    garmListingBody = undefined
    failPostFor = {}
    mockPriorLog = []
    priorLogReadFails = false
    mockLogAdd.mockClear()
    mockCollection.mockClear()
    fetchMock.mockClear()
    vi.stubGlobal('fetch', fetchMock)
    process.env.CRON_SECRET = 'test-secret'
    process.env.GARM_URL = 'https://garm.example.com'
    process.env.GARM_ADMIN_KEY = 'test-admin-key'
    // The reconcile is gated on the same kill switch as the dual-write it
    // backstops; every case below except the kill-switch ones runs with it on.
    process.env.GARM_DUAL_WRITE = 'on'
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('rejects a request without the cron secret', async () => {
    const res = await GET(new Request('http://localhost/api/cron/garm-reconcile'))
    expect(res.status).toBe(401)
    expect(await res.json()).toEqual({ error: 'Unauthorized' })
    expect(fetchMock).not.toHaveBeenCalled()
    expect(mockLogAdd).not.toHaveBeenCalled()
  })

  it('rejects a request with the wrong bearer token', async () => {
    const res = await GET(
      new Request('http://localhost/api/cron/garm-reconcile', {
        headers: { Authorization: 'Bearer nope' },
      })
    )
    expect(res.status).toBe(401)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('writes no grants and logs all-zero counts when there is no drift', async () => {
    mockMembers = [member('maker@example.com', 'maker')]
    mockApproved = [approved('maker@example.com')]
    garmGrants = [
      { email: 'admin@example.com', role: 'owner' },
      { email: 'maker@example.com', role: 'viewer' },
    ]

    const res = await GET(makeReq())
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(postedGrants()).toEqual([])
    expect(body).toMatchObject({
      checked_count: 2,
      missing_count: 0,
      mismatch_count: 0,
      extra_count: 0,
      healed_count: 0,
      capped: false,
      error: null,
    })
    expect(lastLogDoc()).toMatchObject({
      checked_count: 2,
      missing_count: 0,
      mismatch_count: 0,
      extra_count: 0,
      healed_count: 0,
      capped: false,
      error: null,
    })
  })

  it('heals exactly one missing grant at the expected role', async () => {
    mockMembers = [member('maker@example.com', 'maker')]
    mockApproved = [approved('maker@example.com')]
    garmGrants = [{ email: 'admin@example.com', role: 'owner' }]

    const res = await GET(makeReq())
    const body = await res.json()

    expect(postedGrants()).toEqual([
      {
        email: 'maker@example.com',
        project: 'ibuild4you',
        role: 'viewer',
        actor: 'ibuild4you-reconcile',
      },
    ])
    expect(body).toMatchObject({ missing_count: 1, mismatch_count: 0, healed_count: 1 })
  })

  it('heals a role mismatch by upserting the corrected role', async () => {
    mockMembers = [member('builder@example.com', 'builder')]
    mockApproved = [approved('builder@example.com')]
    garmGrants = [
      { email: 'admin@example.com', role: 'owner' },
      { email: 'builder@example.com', role: 'viewer' },
    ]

    const res = await GET(makeReq())
    const body = await res.json()

    expect(postedGrants()).toEqual([
      {
        email: 'builder@example.com',
        project: 'ibuild4you',
        role: 'collaborator',
        actor: 'ibuild4you-reconcile',
      },
    ])
    expect(body).toMatchObject({ missing_count: 0, mismatch_count: 1, healed_count: 1 })
  })

  it('counts an extra grant but NEVER issues a DELETE', async () => {
    // Someone Garm still grants who has no Firestore standing at all.
    garmGrants = [
      { email: 'admin@example.com', role: 'owner' },
      { email: 'stale@example.com', role: 'viewer' },
    ]

    const res = await GET(makeReq())
    const body = await res.json()

    expect(body).toMatchObject({ extra_count: 1, healed_count: 0 })
    expect(postedGrants()).toEqual([])

    // THE safety assertion: additive-only healing. A DELETE here would mean a
    // failed/empty Firestore read could mass-revoke the entire userbase.
    for (const [, init] of fetchMock.mock.calls) {
      expect((init as RequestInit | undefined)?.method).not.toBe('DELETE')
    }
    expect(fetchMock).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ method: 'DELETE' })
    )
  })

  it('counts a revoked member with a lingering grant as extra, not as a revoke', async () => {
    mockMembers = [member('former@example.com', 'maker', '2026-08-01T00:00:00.000Z')]
    mockApproved = [approved('former@example.com', '2026-08-01T00:00:00.000Z')]
    garmGrants = [
      { email: 'admin@example.com', role: 'owner' },
      { email: 'former@example.com', role: 'viewer' },
    ]

    const res = await GET(makeReq())
    const body = await res.json()

    expect(body).toMatchObject({ extra_count: 1, healed_count: 0 })
    for (const [, init] of fetchMock.mock.calls) {
      expect((init as RequestInit | undefined)?.method).not.toBe('DELETE')
    }
  })

  it('writes nothing and records capped:true when drift exceeds RECONCILE_MAX_HEALS', async () => {
    mockMembers = Array.from({ length: 11 }, (_, i) => member(`m${i}@example.com`, 'maker'))
    mockApproved = mockMembers.map((_, i) => approved(`m${i}@example.com`))
    garmGrants = [{ email: 'admin@example.com', role: 'owner' }]

    const res = await GET(makeReq())
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(postedGrants()).toEqual([])
    expect(body).toMatchObject({ missing_count: 11, healed_count: 0, capped: true })
    expect(lastLogDoc()).toMatchObject({ healed_count: 0, capped: true })
  })

  it('records an error and does not 500 when the Garm grant fetch fails', async () => {
    garmFetchFails = true
    mockMembers = [member('maker@example.com', 'maker')]

    const res = await GET(makeReq())
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(postedGrants()).toEqual([])
    expect(body.error).toBeTruthy()
    expect(body).toMatchObject({ healed_count: 0, missing_count: 0 })
    expect(lastLogDoc().error).toBeTruthy()
  })

  // An unrecognized listing body must NOT degrade to "zero active grants":
  // that would report every expected grant as missing, trip the safety cap at
  // real roster size, and heal nobody — forever — while logging capped:true.
  // Garm's contract is `{ grants: [...] }`, verified against the service and
  // its handler, so anything else is a genuine fault and must be loud.
  it.each([
    ['a body with no grants key', { ok: true }],
    ['a bare array (the hedge we deliberately do not support)', [{ email: 'x@example.com' }]],
    ['a null body', null],
    ['a non-array grants value', { grants: 'nope' }],
  ])('records an error and writes nothing given %s', async (_label, body) => {
    garmListingBody = body
    mockMembers = [member('maker@example.com', 'maker')]
    mockApproved = [approved('maker@example.com')]

    const res = await GET(makeReq())
    const responseBody = await res.json()

    expect(res.status).toBe(200)
    expect(postedGrants()).toEqual([])
    expect(responseBody.error).toBeTruthy()
    expect(responseBody).toMatchObject({ healed_count: 0, missing_count: 0, capped: false })
    expect(lastLogDoc().error).toBeTruthy()
  })

  it('keeps healing after one upsert fails, and records the failure', async () => {
    mockMembers = [member('a@example.com', 'maker'), member('b@example.com', 'maker')]
    mockApproved = [approved('a@example.com'), approved('b@example.com')]
    garmGrants = [{ email: 'admin@example.com', role: 'owner' }]
    failPostFor = { 'a@example.com': 'status' }

    const res = await GET(makeReq())
    const body = await res.json()

    // Both heals attempted — one failure must not abort the batch, or a person
    // locked out behind a flaky one stays locked out.
    expect(postedGrants().map((g) => g.email)).toEqual(['a@example.com', 'b@example.com'])
    expect(body).toMatchObject({ missing_count: 2, healed_count: 1 })
    expect(body.error).toBeTruthy()

    // The failure path is the ONLY route by which free text reaches the log
    // doc, so this is where the counts-and-booleans-only rule actually gets
    // tested rather than passing trivially against a null error.
    expect(JSON.stringify(lastLogDoc())).not.toContain('@')
  })

  it('redacts an address out of a heal failure before it reaches the log', async () => {
    mockMembers = [member('a@example.com', 'maker'), member('b@example.com', 'maker')]
    mockApproved = [approved('a@example.com'), approved('b@example.com')]
    garmGrants = [{ email: 'admin@example.com', role: 'owner' }]
    // A transport error whose message quotes the address back at us.
    failPostFor = { 'a@example.com': 'reject' }

    const res = await GET(makeReq())
    const body = await res.json()

    expect(body).toMatchObject({ healed_count: 1 })
    expect(body.error).toBeTruthy()
    expect(String(body.error)).not.toContain('@')

    const serialized = JSON.stringify(lastLogDoc())
    expect(serialized).not.toContain('@')
    expect(serialized).not.toContain('example.com')
  })

  it('fails closed with an error when Garm config is absent', async () => {
    delete process.env.GARM_URL
    delete process.env.GARM_ADMIN_KEY
    mockMembers = [member('maker@example.com', 'maker')]

    const res = await GET(makeReq())
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(fetchMock).not.toHaveBeenCalled()
    expect(body.error).toBeTruthy()
    expect(body.healed_count).toBe(0)
  })

  // A paused dual-write means Firestore and Garm are diverging by operator
  // intent. Healing that divergence would defeat the pause — but going silent
  // would hide a forgotten flag, so the run still logs that it stood down.
  describe('GARM_DUAL_WRITE kill switch', () => {
    it.each([
      ['off', 'off'],
      ['ON (must be exactly "on")', 'ON'],
      ['true', 'true'],
      ['empty', ''],
    ])('stands down, touching nothing, when the switch is %s', async (_label, value) => {
      process.env.GARM_DUAL_WRITE = value
      mockMembers = [member('maker@example.com', 'maker')]
      mockApproved = [approved('maker@example.com')]
      garmGrants = []

      const res = await GET(makeReq())
      const body = await res.json()

      expect(res.status).toBe(200)
      // Not one Garm call of any kind — not even the read-only listing.
      expect(fetchMock).not.toHaveBeenCalled()
      expect(body).toMatchObject({
        skipped_dual_write_off: true,
        checked_count: 0,
        missing_count: 0,
        healed_count: 0,
        capped: false,
        error: null,
      })
      // Still visible: a paused reconciler logs every hour rather than the
      // safety net quietly ceasing to exist.
      expect(lastLogDoc()).toMatchObject({ skipped_dual_write_off: true, missing_count: 0 })
    })

    it('stands down when the switch is unset entirely', async () => {
      delete process.env.GARM_DUAL_WRITE
      mockMembers = [member('maker@example.com', 'maker')]

      const res = await GET(makeReq())

      expect(fetchMock).not.toHaveBeenCalled()
      expect((await res.json()).skipped_dual_write_off).toBe(true)
      expect(lastLogDoc()).toMatchObject({ skipped_dual_write_off: true })
    })

    it('records skipped_dual_write_off:false on a normal run', async () => {
      garmGrants = [{ email: 'admin@example.com', role: 'owner' }]

      const res = await GET(makeReq())

      expect((await res.json()).skipped_dual_write_off).toBe(false)
      expect(lastLogDoc()).toMatchObject({ skipped_dual_write_off: false })
    })
  })

  // No memory across runs means a heal that POSTs 200 but never lands would be
  // re-healed hourly forever, logging missing:1/healed:1 — identical to healthy
  // operation. This boolean is the difference.
  describe('repeat_missing', () => {
    // One member with no grant → missing_count 1 on every run.
    function oneMissing() {
      mockMembers = [member('maker@example.com', 'maker')]
      mockApproved = [approved('maker@example.com')]
      garmGrants = [{ email: 'admin@example.com', role: 'owner' }]
    }

    it('flags a shortfall unchanged from the previous run', async () => {
      oneMissing()
      mockPriorLog = [priorRun(1)]

      const res = await GET(makeReq())
      const body = await res.json()

      expect(body).toMatchObject({ missing_count: 1, healed_count: 1, repeat_missing: true })
      expect(lastLogDoc()).toMatchObject({ repeat_missing: true })
    })

    it('does not flag when the previous run had a different shortfall', async () => {
      oneMissing()
      mockPriorLog = [priorRun(2)]

      const body = await (await GET(makeReq())).json()

      expect(body).toMatchObject({ missing_count: 1, repeat_missing: false })
    })

    it('does not flag on the first ever run, when no prior row exists', async () => {
      oneMissing()
      mockPriorLog = []

      const body = await (await GET(makeReq())).json()

      expect(body).toMatchObject({ missing_count: 1, repeat_missing: false })
    })

    it('does not flag a healthy run, and does not read the prior row at all', async () => {
      garmGrants = [{ email: 'admin@example.com', role: 'owner' }]

      const body = await (await GET(makeReq())).json()

      expect(body).toMatchObject({ missing_count: 0, repeat_missing: false })
    })

    // The signal is diagnostic; losing it must never cost anyone their heal.
    it('still heals when the prior-row read fails', async () => {
      oneMissing()
      priorLogReadFails = true

      const body = await (await GET(makeReq())).json()

      expect(postedGrants().map((g) => g.email)).toEqual(['maker@example.com'])
      expect(body).toMatchObject({ healed_count: 1, repeat_missing: false, error: null })
    })
  })

  it('never puts an email address in the log document', async () => {
    mockMembers = [member('maker@example.com', 'maker')]
    mockApproved = [approved('maker@example.com')]
    garmGrants = [{ email: 'stale@example.com', role: 'viewer' }]

    await GET(makeReq())

    const serialized = JSON.stringify(lastLogDoc())
    expect(serialized).not.toContain('@')
    expect(serialized).not.toContain('example.com')
  })
})
