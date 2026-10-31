import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextResponse } from 'next/server'
import { GET, PUT } from '../route'

// =============================================================================
// BRIEF ROUTE TESTS
//
// GET /api/briefs?project_id=xxx
//   Returns the latest brief for a project, or null if none exists.
//
// PUT /api/briefs
//   Upserts a brief: validates the content shape, normalizes it,
//   then either updates an existing brief (incrementing version)
//   or creates a new one. Uses the upsertBrief helper from lib/api/briefs.
//
// New concept here: we mock a SEPARATE module (lib/api/briefs) that the
// route imports. The route validates, then delegates to upsertBrief.
// We mock upsertBrief to avoid needing a full Firestore chain.
// =============================================================================

// --- Firestore mock for GET ---
const mockGet = vi.fn()
const mockLimit = vi.fn(() => ({ get: mockGet }))
const mockOrderBy = vi.fn(() => ({ limit: mockLimit }))
const mockWhere = vi.fn(() => ({ orderBy: mockOrderBy }))
const mockCollection = vi.fn(() => ({ where: mockWhere }))

const mockGetProjectRole = vi.fn()

vi.mock('@/lib/api/firebase-server-helpers', () => ({
  getAuthenticatedUser: vi.fn(async () => ({
    uid: 'user-123',
    email: 'builder@ibuild4you.com',
    error: null,
  })),
  getAdminDb: vi.fn(() => ({
    collection: mockCollection,
  })),
  getProjectRole: (...args: unknown[]) => mockGetProjectRole(...args),
  requireRole: (role: string | null, minimum: string) => {
    const levels: Record<string, number> = { maker: 0, apprentice: 1, builder: 2, owner: 3 }
    if (!role || levels[role] < levels[minimum]) {
      return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
    }
    return null
  },
}))

// Mock the upsertBrief helper so PUT tests don't need full Firestore chain
const mockUpsertBrief = vi.fn()
vi.mock('@/lib/api/briefs', () => ({
  upsertBrief: (...args: unknown[]) => mockUpsertBrief(...args),
}))

// #229: the paste guard reads unfolded notes and folds the stamped ones.
const mockListUnfoldedNotes = vi.fn()
const mockFoldNotes = vi.fn()
vi.mock('@/lib/api/brief-notes', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api/brief-notes')>()
  return {
    ...actual,
    listUnfoldedNotes: (...args: unknown[]) => mockListUnfoldedNotes(...args),
    foldNotes: (...args: unknown[]) => mockFoldNotes(...args),
  }
})

// --- Helpers ---

const validContent = {
  problem: 'Need a cafe website',
  target_users: 'Local customers',
  features: ['Online ordering', 'Menu display'],
  constraints: 'Budget under $5k',
  additional_context: 'Small cafe in Shoreline',
}

describe('GET /api/briefs', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetProjectRole.mockResolvedValue('builder')
  })

  it('returns 400 when project_id is missing', async () => {
    const req = new Request('http://localhost/api/briefs')
    const res = await GET(req)
    expect(res.status).toBe(400)
  })

  it('returns 404 when user has no role on the project', async () => {
    mockGetProjectRole.mockResolvedValue(null)
    const req = new Request('http://localhost/api/briefs?project_id=proj1')
    const res = await GET(req)
    expect(res.status).toBe(404)
  })

  it('returns null when no brief exists', async () => {
    mockGet.mockResolvedValue({ empty: true })
    const req = new Request('http://localhost/api/briefs?project_id=proj1')
    const res = await GET(req)
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data).toBeNull()
  })

  it('returns the latest brief', async () => {
    mockGet.mockResolvedValue({
      empty: false,
      docs: [{
        id: 'brief-1',
        data: () => ({
          project_id: 'proj1',
          version: 3,
          content: validContent,
        }),
      }],
    })

    const req = new Request('http://localhost/api/briefs?project_id=proj1')
    const res = await GET(req)
    expect(res.status).toBe(200)

    const data = await res.json()
    expect(data.id).toBe('brief-1')
    expect(data.version).toBe(3)
    expect(data.content.problem).toBe('Need a cafe website')
  })

  it('allows makers to read briefs', async () => {
    mockGetProjectRole.mockResolvedValue('maker')
    mockGet.mockResolvedValue({ empty: true })

    const req = new Request('http://localhost/api/briefs?project_id=proj1')
    const res = await GET(req)
    // Makers should get 200, not 403
    expect(res.status).toBe(200)
  })
})

describe('PUT /api/briefs', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetProjectRole.mockResolvedValue('builder')
    // PUT fetches the latest stored brief for provenance carry-forward (#121) —
    // default to "no brief yet"; tests override for carry-forward cases.
    mockGet.mockResolvedValue({ empty: true, docs: [] })
    mockUpsertBrief.mockResolvedValue({
      id: 'brief-1',
      project_id: 'proj1',
      version: 1,
      content: validContent,
    })
    mockListUnfoldedNotes.mockResolvedValue([])
    mockFoldNotes.mockResolvedValue(undefined)
  })

  function makePutRequest(body: Record<string, unknown>) {
    return new Request('http://localhost/api/briefs', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
  }

  // --- Validation ---

  it('returns 400 when project_id is missing', async () => {
    const res = await PUT(makePutRequest({ content: validContent }))
    expect(res.status).toBe(400)
  })

  it('returns 403 when caller is a maker', async () => {
    mockGetProjectRole.mockResolvedValue('maker')
    const res = await PUT(makePutRequest({ project_id: 'proj1', content: validContent }))
    expect(res.status).toBe(403)
  })

  it('returns 400 when content is missing', async () => {
    const res = await PUT(makePutRequest({ project_id: 'proj1' }))
    expect(res.status).toBe(400)
    const data = await res.json()
    expect(data.error).toContain('content must be an object')
  })

  it('returns 400 when content is empty (no fields with data)', async () => {
    const res = await PUT(makePutRequest({
      project_id: 'proj1',
      content: { problem: '', features: [] },
    }))
    expect(res.status).toBe(400)
    const data = await res.json()
    expect(data.error).toContain('empty')
  })

  // --- Successful upsert ---

  it('calls upsertBrief with normalized content', async () => {
    const res = await PUT(makePutRequest({
      project_id: 'proj1',
      content: validContent,
    }))

    expect(res.status).toBe(200)
    expect(mockUpsertBrief).toHaveBeenCalledTimes(1)

    // Check the content arg passed to upsertBrief
    const contentArg = mockUpsertBrief.mock.calls[0][2]
    expect(contentArg.problem).toBe('Need a cafe website')
    expect(contentArg.features).toEqual(['Online ordering', 'Menu display'])
  })

  // --- Source provenance (#194) ---

  it('upserts with source "paste" by default', async () => {
    const res = await PUT(makePutRequest({ project_id: 'proj1', content: validContent }))
    expect(res.status).toBe(200)
    expect(mockUpsertBrief).toHaveBeenCalledWith(
      expect.anything(),
      'proj1',
      expect.objectContaining({ problem: 'Need a cafe website' }),
      'paste'
    )
  })

  it('upserts with source "restore" when the body says so (#194)', async () => {
    await PUT(makePutRequest({ project_id: 'proj1', content: validContent, source: 'restore' }))
    expect(mockUpsertBrief).toHaveBeenCalledWith(expect.anything(), 'proj1', expect.anything(), 'restore')
  })

  it('ignores an unknown source value and falls back to "paste"', async () => {
    await PUT(makePutRequest({ project_id: 'proj1', content: validContent, source: 'regen' }))
    expect(mockUpsertBrief).toHaveBeenCalledWith(expect.anything(), 'proj1', expect.anything(), 'paste')
  })

  it('a restore keeps locked decisions locked (#71 + #194)', async () => {
    await PUT(
      makePutRequest({
        project_id: 'proj1',
        content: { ...validContent, decisions: [{ topic: 'Stack', decision: 'Next.js', locked: true }] },
        source: 'restore',
      })
    )
    const sent = mockUpsertBrief.mock.calls[0][2] as { decisions: { topic: string; locked?: boolean }[] }
    expect(sent.decisions[0]).toEqual(expect.objectContaining({ topic: 'Stack', locked: true }))
  })

  it('normalizes content — strips non-string features', async () => {
    await PUT(makePutRequest({
      project_id: 'proj1',
      content: {
        ...validContent,
        features: ['Valid', 42, null, 'Also valid'],
      },
    }))

    const contentArg = mockUpsertBrief.mock.calls[0][2]
    expect(contentArg.features).toEqual(['Valid', 'Also valid'])
  })

  it('normalizes open_risks and carries an owner forward from the stored brief (#229 Q3)', async () => {
    mockGet.mockResolvedValue({
      empty: false,
      docs: [{ data: () => ({ version: 3, content: { ...validContent, open_risks: [{ text: 'bad', owner: 'maker' }] } }) }],
    })
    await PUT(makePutRequest({
      project_id: 'proj1',
      content: {
        ...validContent,
        open_risks: [{ text: 'q', owner: 'maker' }, { text: 'bad', owner: 'Maker' }, 'plain'],
      },
    }))
    const contentArg = mockUpsertBrief.mock.calls[0][2]
    // 'bad' arrives with an invalid owner (collapses to a string), then takes
    // the stored brief's owner by text match.
    expect(contentArg.open_risks).toEqual([{ text: 'q', owner: 'maker' }, { text: 'bad', owner: 'maker' }, 'plain'])
  })

  it('saves shipped and queued normalized (#219)', async () => {
    await PUT(makePutRequest({
      project_id: 'proj1',
      content: {
        ...validContent,
        shipped: [{ date: '2026-10-17', items: [' A '] }, { date: 'bad', items: ['x'] }],
        queued: [' Next ', ''],
      },
    }))
    const contentArg = mockUpsertBrief.mock.calls[0][2]
    expect(contentArg.shipped).toEqual([{ date: '2026-10-17', items: ['A'] }])
    expect(contentArg.queued).toEqual(['Next'])
  })

  it('accepts a brief whose only content is queued (#219)', async () => {
    const res = await PUT(makePutRequest({ project_id: 'proj1', content: { queued: ['Next'] } }))
    expect(res.status).toBe(200)
  })

  it('400s on a non-list shipped (#219)', async () => {
    const res = await PUT(makePutRequest({ project_id: 'proj1', content: { ...validContent, shipped: 'x' } }))
    expect(res.status).toBe(400)
  })

  it('400s on a non-list queued (#219)', async () => {
    const res = await PUT(makePutRequest({ project_id: 'proj1', content: { ...validContent, queued: {} } }))
    expect(res.status).toBe(400)
  })

  it('normalizes content — filters invalid decisions', async () => {
    await PUT(makePutRequest({
      project_id: 'proj1',
      content: {
        ...validContent,
        decisions: [
          { topic: 'Tech stack', decision: 'Next.js' },
          { topic: 'Missing decision field' },         // no decision → filtered
          { decision: 'Missing topic field' },          // no topic → filtered
          { topic: 'Hosting', decision: 'Vercel' },
        ],
      },
    }))

    // New decisions on the paste path get out-of-band provenance stamps (#121).
    const contentArg = mockUpsertBrief.mock.calls[0][2]
    expect(contentArg.decisions).toEqual([
      { topic: 'Tech stack', decision: 'Next.js', decided_in_session: null, decided_at: expect.any(String) },
      { topic: 'Hosting', decision: 'Vercel', decided_in_session: null, decided_at: expect.any(String) },
    ])
  })

  it('preserves the locked flag on decisions (#71)', async () => {
    await PUT(makePutRequest({
      project_id: 'proj1',
      content: {
        ...validContent,
        decisions: [
          { topic: 'Stack', decision: 'Next.js, no Vue', locked: true },
          { topic: 'Hosting', decision: 'Vercel' },
        ],
      },
    }))

    const contentArg = mockUpsertBrief.mock.calls[0][2]
    expect(contentArg.decisions).toEqual([
      { topic: 'Stack', decision: 'Next.js, no Vue', locked: true, decided_in_session: null, decided_at: expect.any(String) },
      { topic: 'Hosting', decision: 'Vercel', decided_in_session: null, decided_at: expect.any(String) },
    ])
  })

  it('keeps contested on a locked decision and drops it elsewhere or when malformed (#197)', async () => {
    const contested = { proposed: 'Square', reason: 'switched POS' }
    await PUT(makePutRequest({
      project_id: 'proj1',
      content: {
        ...validContent,
        decisions: [
          { topic: 'Payment', decision: 'Stripe only', locked: true, contested },
          { topic: 'Auth', decision: 'Google', contested },
          { topic: 'DB', decision: 'Firestore', locked: true, contested: { proposed: 'x' } },
        ],
      },
    }))
    const decisions = mockUpsertBrief.mock.calls[0][2].decisions
    expect(decisions[0].contested).toEqual(contested)
    expect(decisions[1].contested).toBeUndefined()
    expect(decisions[2].contested).toBeUndefined()
  })

  it('keeps contest_dismissed on a locked decision and drops it elsewhere or when malformed (#197)', async () => {
    const dismissed = { proposed: 'Square', at: '2026-10-15T12:00:00.000Z' }
    await PUT(makePutRequest({
      project_id: 'proj1',
      content: {
        ...validContent,
        decisions: [
          { topic: 'Payment', decision: 'Stripe only', locked: true, contest_dismissed: dismissed },
          { topic: 'Auth', decision: 'Google', contest_dismissed: dismissed },
          { topic: 'DB', decision: 'Firestore', locked: true, contest_dismissed: { proposed: 'x' } },
        ],
      },
    }))
    const decisions = mockUpsertBrief.mock.calls[0][2].decisions
    expect(decisions[0].contest_dismissed).toEqual(dismissed)
    expect(decisions[1].contest_dismissed).toBeUndefined()
    expect(decisions[2].contest_dismissed).toBeUndefined()
  })

  it('an unchanged contested lock round-trips with its prior stamps (#197)', async () => {
    const contested = { proposed: 'Square', reason: 'switched POS' }
    mockGet.mockResolvedValue({
      empty: false,
      docs: [
        {
          id: 'brief-1',
          data: () => ({
            version: 3,
            content: {
              problem: 'p',
              decisions: [
                {
                  topic: 'Payment',
                  decision: 'Stripe only',
                  locked: true,
                  contested,
                  decided_in_session: 's2',
                  decided_at: '2026-07-05T00:00:00Z',
                },
              ],
            },
          }),
        },
      ],
    })
    await PUT(makePutRequest({
      project_id: 'proj1',
      content: {
        problem: 'p',
        decisions: [{ topic: 'Payment', decision: 'Stripe only', locked: true, contested }],
      },
    }))
    expect(mockUpsertBrief.mock.calls[0][2].decisions).toEqual([
      {
        topic: 'Payment',
        decision: 'Stripe only',
        locked: true,
        contested,
        decided_in_session: 's2',
        decided_at: '2026-07-05T00:00:00Z',
      },
    ])
  })

  // --- Decision provenance (#121) ---

  it('restores stamps the payload dropped, from the stored brief', async () => {
    mockGet.mockResolvedValue({
      empty: false,
      docs: [
        {
          id: 'brief-1',
          data: () => ({
            version: 3,
            content: {
              problem: 'p',
              decisions: [
                {
                  topic: 'Payment',
                  decision: 'Stripe',
                  decided_in_session: 's2',
                  decided_at: '2026-07-05T00:00:00Z',
                },
              ],
            },
          }),
        },
      ],
    })

    await PUT(makePutRequest({
      project_id: 'proj1',
      // Round-tripped through an outside agent that dropped the stamps.
      content: { problem: 'p', decisions: [{ topic: 'Payment', decision: 'Stripe' }] },
    }))

    const contentArg = mockUpsertBrief.mock.calls[0][2]
    expect(contentArg.decisions).toEqual([
      {
        topic: 'Payment',
        decision: 'Stripe',
        decided_in_session: 's2',
        decided_at: '2026-07-05T00:00:00Z',
      },
    ])
  })

  it('honors explicit provenance supplied in the payload', async () => {
    await PUT(makePutRequest({
      project_id: 'proj1',
      content: {
        problem: 'p',
        decisions: [
          {
            topic: 'Auth',
            decision: 'Google',
            decided_in_session: 's1',
            decided_at: '2026-07-01T00:00:00Z',
          },
        ],
      },
    }))

    const contentArg = mockUpsertBrief.mock.calls[0][2]
    expect(contentArg.decisions).toEqual([
      {
        topic: 'Auth',
        decision: 'Google',
        decided_in_session: 's1',
        decided_at: '2026-07-01T00:00:00Z',
      },
    ])
  })

  it('defaults missing string fields to empty strings', async () => {
    await PUT(makePutRequest({
      project_id: 'proj1',
      content: { problem: 'Just a problem' },
    }))

    const contentArg = mockUpsertBrief.mock.calls[0][2]
    expect(contentArg.target_users).toBe('')
    expect(contentArg.constraints).toBe('')
    expect(contentArg.additional_context).toBe('')
    expect(contentArg.features).toEqual([])
  })
})

// =============================================================================
// #229 PASTE GUARD
//
// A prep carries `_prep_stamp { brief_version, note_ids }`; the Brief tab sends
// it back as `prep_stamp`. The route folds the listed notes, or answers 409
// when the prep is stale (a note it did not list, or a newer live brief).
// =============================================================================

describe('PUT /api/briefs — paste guard (#229)', () => {
  const note = (id: string, over: Record<string, unknown> = {}) => ({
    id,
    session_id: `sess-${id}`,
    created_at: `2026-10-2${id.length}T18:00:00.000Z`,
    folded_at: null,
    text: '',
    decisions: [],
    risks_added: [],
    risks_resolved: [],
    lock_reversals: [],
    ...over,
  })

  // The live brief: id brief-1 at the given version.
  function liveBrief(version: number, content: Record<string, unknown> = { problem: 'p' }) {
    mockGet.mockResolvedValue({
      empty: false,
      docs: [{ id: 'brief-1', data: () => ({ version, content }) }],
    })
  }

  function put(body: Record<string, unknown>) {
    return PUT(
      new Request('http://localhost/api/briefs', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ project_id: 'proj1', content: validContent, ...body }),
      })
    )
  }

  beforeEach(() => {
    vi.clearAllMocks()
    mockGetProjectRole.mockResolvedValue('builder')
    mockUpsertBrief.mockResolvedValue({ id: 'brief-1', project_id: 'proj1', version: 4, content: validContent })
    mockListUnfoldedNotes.mockResolvedValue([])
    mockFoldNotes.mockResolvedValue(undefined)
  })

  it('no stamp saves and folds nothing', async () => {
    liveBrief(3)
    mockListUnfoldedNotes.mockResolvedValue([note('aaa')])
    const res = await put({})
    expect(res.status).toBe(200)
    expect(mockUpsertBrief).toHaveBeenCalledTimes(1)
    expect(mockFoldNotes).not.toHaveBeenCalled()
    const data = await res.json()
    expect(data.folded).toEqual([])
    expect(data.size_warning).toBeNull()
  })

  it('stamp listing every unfolded note at the live version saves and folds them', async () => {
    liveBrief(3)
    mockListUnfoldedNotes.mockResolvedValue([note('aaa'), note('bbbb')])
    const res = await put({ prep_stamp: { brief_version: 3, note_ids: ['aaa', 'bbbb'] } })
    expect(res.status).toBe(200)
    expect(mockListUnfoldedNotes).toHaveBeenCalledWith(expect.anything(), 'brief-1')
    expect(mockFoldNotes).toHaveBeenCalledWith(expect.anything(), 'brief-1', ['aaa', 'bbbb'], expect.any(String))
    expect((await res.json()).folded).toEqual(['aaa', 'bbbb'])
  })

  it('409 when an unfolded note is not in the stamp', async () => {
    liveBrief(3)
    mockListUnfoldedNotes.mockResolvedValue([note('aaa'), note('bbbb')])
    const res = await put({ prep_stamp: { brief_version: 3, note_ids: ['aaa'] } })
    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({
      error: 'stale_prep',
      unlisted_notes: [{ id: 'bbbb', created_at: '2026-10-24T18:00:00.000Z' }],
      live_version: 3,
      prep_version: 3,
    })
    expect(mockUpsertBrief).not.toHaveBeenCalled()
    expect(mockFoldNotes).not.toHaveBeenCalled()
  })

  it('409 when the live version is newer than the stamp', async () => {
    liveBrief(5)
    mockListUnfoldedNotes.mockResolvedValue([note('aaa')])
    const res = await put({ prep_stamp: { brief_version: 3, note_ids: ['aaa'] } })
    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({ error: 'stale_prep', unlisted_notes: [], live_version: 5, prep_version: 3 })
    expect(mockUpsertBrief).not.toHaveBeenCalled()
  })

  it('a stamp against no brief yet compares with live version 0', async () => {
    mockGet.mockResolvedValue({ empty: true, docs: [] })
    const ok = await put({ prep_stamp: { brief_version: 0, note_ids: [] } })
    expect(ok.status).toBe(200)
    expect(mockListUnfoldedNotes).not.toHaveBeenCalled()
  })

  it('force saves, folds only listed notes, leaves the unlisted one unfolded', async () => {
    liveBrief(5)
    mockListUnfoldedNotes.mockResolvedValue([note('aaa'), note('bbbb')])
    const res = await put({ prep_stamp: { brief_version: 3, note_ids: ['aaa'] }, force: true })
    expect(res.status).toBe(200)
    expect(mockUpsertBrief).toHaveBeenCalledTimes(1)
    expect(mockFoldNotes).toHaveBeenCalledWith(expect.anything(), 'brief-1', ['aaa'], expect.any(String))
    expect((await res.json()).folded).toEqual(['aaa'])
  })

  it('a stamped id that is not an unfolded note is not reported as folded', async () => {
    liveBrief(3)
    mockListUnfoldedNotes.mockResolvedValue([note('aaa')])
    const res = await put({ prep_stamp: { brief_version: 3, note_ids: ['aaa', 'gone'] } })
    expect(res.status).toBe(200)
    expect(mockFoldNotes).toHaveBeenCalledWith(expect.anything(), 'brief-1', ['aaa'], expect.any(String))
  })

  it('a new topic with no provenance takes its origin from the note that introduced it', async () => {
    liveBrief(3)
    mockListUnfoldedNotes.mockResolvedValue([
      note('aaa', { session_id: 's7', created_at: '2026-10-20T18:00:00.000Z', decisions: [{ topic: 'Payment', decision: 'Stripe' }] }),
      note('bbbb', { session_id: 's8', created_at: '2026-10-22T18:00:00.000Z', decisions: [{ topic: ' payment ', decision: 'Square' }] }),
    ])
    await put({
      content: { problem: 'p', decisions: [{ topic: 'Payment', decision: 'Square' }, { topic: 'Hosting', decision: 'Vercel' }] },
      prep_stamp: { brief_version: 3, note_ids: ['aaa', 'bbbb'] },
    })
    const decisions = mockUpsertBrief.mock.calls[0][2].decisions
    // Later note wins.
    expect(decisions[0]).toEqual({
      topic: 'Payment',
      decision: 'Square',
      decided_in_session: 's8',
      decided_at: '2026-10-22T18:00:00.000Z',
    })
    // Not in any note: out-of-band stamp as before.
    expect(decisions[1]).toEqual(expect.objectContaining({ topic: 'Hosting', decided_in_session: null }))
    expect(decisions[1].decided_at).not.toBe('2026-10-22T18:00:00.000Z')
  })

  it('an unlisted note gives no origin even on a forced paste', async () => {
    liveBrief(3)
    mockListUnfoldedNotes.mockResolvedValue([
      note('aaa', { session_id: 's7', created_at: '2026-10-20T18:00:00.000Z', decisions: [{ topic: 'Payment', decision: 'Stripe' }] }),
    ])
    await put({
      content: { problem: 'p', decisions: [{ topic: 'Payment', decision: 'Stripe' }] },
      prep_stamp: { brief_version: 3, note_ids: [] },
      force: true,
    })
    expect(mockUpsertBrief.mock.calls[0][2].decisions[0].decided_in_session).toBeNull()
  })

  it("an ownerless risk gets its owner from a folded note's risks_added", async () => {
    liveBrief(3)
    mockListUnfoldedNotes.mockResolvedValue([
      note('aaa', { risks_added: [{ text: 'Who prints the menus?', owner: 'maker' }, 'Unowned one'] }),
    ])
    await put({
      content: { problem: 'p', open_risks: ['who prints the menus?', 'Unowned one'] },
      prep_stamp: { brief_version: 3, note_ids: ['aaa'] },
    })
    expect(mockUpsertBrief.mock.calls[0][2].open_risks).toEqual([
      { text: 'who prints the menus?', owner: 'maker' },
      'Unowned one',
    ])
  })

  it('restore ignores any stamp', async () => {
    liveBrief(5)
    mockListUnfoldedNotes.mockResolvedValue([note('aaa'), note('bbbb')])
    const res = await put({ source: 'restore', prep_stamp: { brief_version: 1, note_ids: ['aaa'] } })
    expect(res.status).toBe(200)
    expect(mockUpsertBrief).toHaveBeenCalledWith(expect.anything(), 'proj1', expect.anything(), 'restore')
    expect(mockFoldNotes).not.toHaveBeenCalled()
    expect((await res.json()).folded).toEqual([])
  })

  it('400 on a malformed stamp', async () => {
    liveBrief(3)
    const res = await put({ prep_stamp: { brief_version: 'three', note_ids: [] } })
    expect(res.status).toBe(400)
    expect(mockUpsertBrief).not.toHaveBeenCalled()
  })

  it('a fold failure still answers 200 with folded: []', async () => {
    liveBrief(3)
    mockListUnfoldedNotes.mockResolvedValue([note('aaa')])
    mockFoldNotes.mockRejectedValue(new Error('firestore down'))
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const res = await put({ prep_stamp: { brief_version: 3, note_ids: ['aaa'] } })
    expect(res.status).toBe(200)
    expect((await res.json()).folded).toEqual([])
    errSpy.mockRestore()
  })

  // --- Locks on a stamped paste (#71/#197 kept guarantee, #229) ---
  // The comms agent rewrites the brief; a stamped paste can't drop a lock,
  // reword one, or clear its contest. The live brief is the authority.
  const lockedPrev = {
    topic: 'Payment',
    decision: 'Stripe only',
    locked: true,
    decided_in_session: 's1',
    decided_at: '2026-10-01T18:00:00.000Z',
  }
  const contest = { proposed: 'Square', reason: 'Maker confirmed in conv 4' }

  it('a stamped paste that drops a lock gets it back verbatim', async () => {
    liveBrief(3, { problem: 'p', decisions: [lockedPrev, { topic: 'Hosting', decision: 'Vercel' }] })
    await put({
      content: { problem: 'p', decisions: [{ topic: 'Hosting', decision: 'Vercel' }] },
      prep_stamp: { brief_version: 3, note_ids: [] },
    })
    const decisions = mockUpsertBrief.mock.calls[0][2].decisions
    expect(decisions).toContainEqual(lockedPrev)
    expect(decisions).toContainEqual(expect.objectContaining({ topic: 'Hosting', decision: 'Vercel' }))
  })

  it('a stamped paste that drops contested on a lock keeps the contest', async () => {
    const dismissed = { proposed: 'PayPal', at: '2026-10-10T18:00:00.000Z' }
    liveBrief(3, { problem: 'p', decisions: [{ ...lockedPrev, contested: contest, contest_dismissed: dismissed }] })
    await put({
      content: { problem: 'p', decisions: [{ topic: 'Payment', decision: 'Stripe only', locked: true }] },
      prep_stamp: { brief_version: 3, note_ids: [] },
    })
    const [d] = mockUpsertBrief.mock.calls[0][2].decisions
    expect(d.contested).toEqual(contest)
    expect(d.contest_dismissed).toEqual(dismissed)
  })

  it('a stamped paste cannot replace a contest with its own', async () => {
    liveBrief(3, { problem: 'p', decisions: [{ ...lockedPrev, contested: contest }] })
    await put({
      content: {
        problem: 'p',
        decisions: [{ topic: 'Payment', decision: 'Stripe only', locked: true, contested: { proposed: 'Cash', reason: 'x' } }],
      },
      prep_stamp: { brief_version: 3, note_ids: [] },
    })
    expect(mockUpsertBrief.mock.calls[0][2].decisions[0].contested).toEqual(contest)
  })

  it('a stamped paste that rewords a locked decision keeps the stored text', async () => {
    liveBrief(3, { problem: 'p', decisions: [lockedPrev] })
    await put({
      content: { problem: 'p', decisions: [{ topic: ' payment ', decision: 'Stripe and Square' }] },
      prep_stamp: { brief_version: 3, note_ids: [] },
    })
    const decisions = mockUpsertBrief.mock.calls[0][2].decisions
    expect(decisions).toEqual([lockedPrev])
  })

  it('an unstamped save that unlocks a decision is honoured', async () => {
    liveBrief(3, { problem: 'p', decisions: [lockedPrev] })
    await put({ content: { problem: 'p', decisions: [{ topic: 'Payment', decision: 'Stripe only' }] } })
    const [d] = mockUpsertBrief.mock.calls[0][2].decisions
    expect(d.locked).toBeUndefined()
    expect(d.decision).toBe('Stripe only')
  })

  it('a stamped paste revising a topic a folded note revised takes that note as the revision', async () => {
    liveBrief(3, {
      problem: 'p',
      decisions: [{ topic: 'Hosting', decision: 'Netlify', decided_in_session: 's1', decided_at: '2026-10-01T18:00:00.000Z' }],
    })
    mockListUnfoldedNotes.mockResolvedValue([
      note('aaa', { session_id: 's9', created_at: '2026-10-25T18:00:00.000Z', decisions: [{ topic: 'hosting', decision: 'Vercel' }] }),
    ])
    await put({
      content: { problem: 'p', decisions: [{ topic: 'Hosting', decision: 'Vercel' }] },
      prep_stamp: { brief_version: 3, note_ids: ['aaa'] },
    })
    expect(mockUpsertBrief.mock.calls[0][2].decisions[0]).toEqual({
      topic: 'Hosting',
      decision: 'Vercel',
      decided_in_session: 's1',
      decided_at: '2026-10-01T18:00:00.000Z',
      revised_in_session: 's9',
      revised_at: '2026-10-25T18:00:00.000Z',
    })
  })

  it('returns a size warning when the saved brief is over budget', async () => {
    liveBrief(3)
    const res = await put({ content: { problem: 'x'.repeat(21000) } })
    expect((await res.json()).size_warning).toMatch(/over the 20,000/)
  })
})
