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

// --- Helpers ---

const validContent = {
  problem: 'Need a bakery website',
  target_users: 'Local customers',
  features: ['Online ordering', 'Menu display'],
  constraints: 'Budget under $5k',
  additional_context: 'Small bakery in Shoreline',
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
    expect(data.content.problem).toBe('Need a bakery website')
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
    mockUpsertBrief.mockResolvedValue({
      id: 'brief-1',
      project_id: 'proj1',
      version: 1,
      content: validContent,
    })
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
    expect(contentArg.problem).toBe('Need a bakery website')
    expect(contentArg.features).toEqual(['Online ordering', 'Menu display'])
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

    const contentArg = mockUpsertBrief.mock.calls[0][2]
    expect(contentArg.decisions).toEqual([
      { topic: 'Tech stack', decision: 'Next.js' },
      { topic: 'Hosting', decision: 'Vercel' },
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
