import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextResponse } from 'next/server'
import { GET } from '../route'

// =============================================================================
// GET /api/briefs/versions?project_id=xxx (#194)
//   Archived versions of a project's brief, newest first. Builder+ only.
//   Two Firestore chains: the live brief lookup, then the versions subcollection.
// =============================================================================

const mockLiveGet = vi.fn()
const mockVersionsGet = vi.fn()
const liveDoc = {
  id: 'brief-1',
  data: () => ({ project_id: 'proj1', version: 4 }),
  ref: {
    collection: vi.fn(() => ({
      orderBy: vi.fn(() => ({ limit: vi.fn(() => ({ get: mockVersionsGet })) })),
    })),
  },
}

const mockGetProjectRole = vi.fn()

vi.mock('@/lib/api/firebase-server-helpers', () => ({
  getAuthenticatedUser: vi.fn(async () => ({
    uid: 'user-123',
    email: 'builder@ibuild4you.com',
    systemRoles: [],
    error: null,
  })),
  getAdminDb: vi.fn(() => ({
    collection: () => ({
      where: () => ({ orderBy: () => ({ limit: () => ({ get: mockLiveGet }) }) }),
    }),
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

describe('GET /api/briefs/versions (#194)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetProjectRole.mockResolvedValue('builder')
  })

  it('400 without project_id', async () => {
    const res = await GET(new Request('http://localhost/api/briefs/versions'))
    expect(res.status).toBe(400)
  })

  it('404 when the user has no role', async () => {
    mockGetProjectRole.mockResolvedValue(null)
    const res = await GET(new Request('http://localhost/api/briefs/versions?project_id=proj1'))
    expect(res.status).toBe(404)
  })

  it('403 for a maker — history is builder tooling', async () => {
    mockGetProjectRole.mockResolvedValue('maker')
    const res = await GET(new Request('http://localhost/api/briefs/versions?project_id=proj1'))
    expect(res.status).toBe(403)
  })

  it('returns an empty list when the project has no brief', async () => {
    mockLiveGet.mockResolvedValue({ empty: true, docs: [] })
    const res = await GET(new Request('http://localhost/api/briefs/versions?project_id=proj1'))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ versions: [] })
  })

  it('lists archived versions newest first with content, time and source', async () => {
    mockLiveGet.mockResolvedValue({ empty: false, docs: [liveDoc] })
    mockVersionsGet.mockResolvedValue({
      docs: [
        { id: '3', data: () => ({ version: 3, content: { problem: 'v3' }, updated_at: '2026-10-10T00:00:00.000Z', source: 'regen', archived_at: '2026-10-11T00:00:00.000Z' }) },
        { id: '2', data: () => ({ version: 2, content: { problem: 'v2' }, updated_at: '2026-10-01T00:00:00.000Z', source: null, archived_at: '2026-10-10T00:00:00.000Z' }) },
      ],
    })
    const res = await GET(new Request('http://localhost/api/briefs/versions?project_id=proj1'))
    const data = await res.json()
    expect(data.versions).toHaveLength(2)
    expect(data.versions[0]).toEqual(expect.objectContaining({ version: 3, source: 'regen', content: { problem: 'v3' } }))
    expect(data.versions[1].source).toBeNull()
    expect(liveDoc.ref.collection).toHaveBeenCalledWith('versions')
  })
})
