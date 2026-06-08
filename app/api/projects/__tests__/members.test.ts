import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextResponse } from 'next/server'
import { GET } from '../[id]/members/route'

// Chainable Firestore mock: collection('x').where(...).get() → configurable docs
const mockGet = vi.fn()
const mockWhere = vi.fn(() => ({ get: mockGet }))
const mockCollection = vi.fn(() => ({ where: mockWhere }))

const mockGetProjectRole = vi.fn()
const mockGetUserDisplayName = vi.fn()

vi.mock('@/lib/api/firebase-server-helpers', () => ({
  getAuthenticatedUser: vi.fn(async () => ({
    uid: 'builder-uid',
    email: 'builder@example.com',
    error: null,
    systemRoles: [],
  })),
  getAdminDb: vi.fn(() => ({ collection: mockCollection })),
  getProjectRole: (...args: unknown[]) => mockGetProjectRole(...args),
  getUserDisplayName: (...args: unknown[]) => mockGetUserDisplayName(...args),
  requireRole: (role: string | null, minimum: string) => {
    const levels: Record<string, number> = { maker: 0, apprentice: 1, builder: 2, owner: 3 }
    if (!role || levels[role] < levels[minimum]) {
      return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
    }
    return null
  },
}))

function makeReq() {
  return new Request('http://localhost/api/projects/proj1/members')
}
const ctx = { params: Promise.resolve({ id: 'proj1' }) }

describe('GET /api/projects/[id]/members', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetProjectRole.mockResolvedValue('builder')
    mockGetUserDisplayName.mockImplementation(async (_db: unknown, _uid: string, email: string) =>
      email.split('@')[0]
    )
  })

  it('returns 403 when caller is below builder', async () => {
    mockGetProjectRole.mockResolvedValue('maker')
    const res = await GET(makeReq(), ctx)
    expect(res.status).toBe(403)
  })

  it('lists members with email, role, and brief_role', async () => {
    mockGet.mockResolvedValue({
      docs: [
        { id: 'm1', data: () => ({ email: 'mara@x.com', user_id: 'u1', role: 'maker', brief_role: 'originator', created_at: '2026-01-01T00:00:00Z' }) },
        { id: 'm2', data: () => ({ email: 'tom@x.com', user_id: 'u2', role: 'maker', brief_role: 'contributor', created_at: '2026-01-02T00:00:00Z' }) },
      ],
    })

    const res = await GET(makeReq(), ctx)
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.members).toHaveLength(2)
    const tom = data.members.find((m: { email: string }) => m.email === 'tom@x.com')
    expect(tom.brief_role).toBe('contributor')
    expect(tom.display_name).toBe('tom')
  })

  it('orders console operators before chat participants', async () => {
    mockGet.mockResolvedValue({
      docs: [
        { id: 'm1', data: () => ({ email: 'mara@x.com', role: 'maker', brief_role: 'originator', created_at: '2026-01-01T00:00:00Z' }) },
        { id: 'm2', data: () => ({ email: 'owner@x.com', role: 'owner', brief_role: null, created_at: '2026-01-03T00:00:00Z' }) },
      ],
    })

    const res = await GET(makeReq(), ctx)
    const data = await res.json()
    expect(data.members[0].email).toBe('owner@x.com') // owner first despite later created_at
    expect(data.members[1].email).toBe('mara@x.com')
  })
})
