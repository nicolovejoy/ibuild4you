import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextResponse } from 'next/server'
import { GET } from '../[id]/members/[memberId]/passcode/route'

// Chainable Firestore mock: collection('project_members').doc(id).get()/.update()
const mockUpdate = vi.fn()
const mockDocGet = vi.fn()
const mockDoc = vi.fn(() => ({ get: mockDocGet, update: mockUpdate }))
const mockCollection = vi.fn(() => ({ doc: mockDoc }))

vi.mock('@/lib/firebase/admin', () => ({
  getAdminDb: vi.fn(() => ({ collection: mockCollection })),
  getAdminAuth: vi.fn(),
}))

const mockGetProjectRole = vi.fn()
vi.mock('@/lib/api/firebase-server-helpers', () => ({
  getAuthenticatedUser: vi.fn(async () => ({
    uid: 'builder-uid',
    email: 'builder@example.com',
    error: null,
  })),
  getAdminDb: vi.fn(() => ({ collection: mockCollection })),
  getProjectRole: (...args: unknown[]) => mockGetProjectRole(...args),
  requireRole: (role: string | null, minimum: string) => {
    const levels: Record<string, number> = { maker: 0, apprentice: 1, builder: 2, owner: 3 }
    if (!role || levels[role] < levels[minimum]) {
      return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
    }
    return null
  },
}))

const call = (id: string, memberId: string) =>
  GET(new Request(`http://localhost/api/projects/${id}/members/${memberId}/passcode`), {
    params: Promise.resolve({ id, memberId }),
  })

describe('GET /api/projects/[id]/members/[memberId]/passcode', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetProjectRole.mockResolvedValue('builder')
  })

  it('returns 403 when caller is below builder', async () => {
    mockGetProjectRole.mockResolvedValue('maker')
    const res = await call('proj1', 'mem1')
    expect(res.status).toBe(403)
  })

  it('returns 404 when the member doc does not exist', async () => {
    mockDocGet.mockResolvedValue({ exists: false, data: () => undefined })
    const res = await call('proj1', 'mem1')
    expect(res.status).toBe(404)
  })

  it('returns 404 when the member belongs to a different project', async () => {
    mockDocGet.mockResolvedValue({
      exists: true,
      data: () => ({ project_id: 'OTHER', email: 'x@example.com', passcode: 'AAA111' }),
    })
    const res = await call('proj1', 'mem1')
    expect(res.status).toBe(404)
    // Must not leak the other brief's passcode.
    expect(await res.json()).not.toHaveProperty('passcode')
  })

  it('reveals the existing passcode for a member on this project', async () => {
    mockDocGet.mockResolvedValue({
      exists: true,
      data: () => ({ project_id: 'proj1', email: 'contrib@example.com', passcode: 'XYZ789' }),
    })
    const res = await call('proj1', 'mem1')
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.passcode).toBe('XYZ789')
    expect(data.email).toBe('contrib@example.com')
    expect(mockUpdate).not.toHaveBeenCalled()
  })

  it('mints and persists a passcode when the member has none', async () => {
    mockDocGet.mockResolvedValue({
      exists: true,
      data: () => ({ project_id: 'proj1', email: 'contrib@example.com' }),
    })
    const res = await call('proj1', 'mem1')
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.passcode).toMatch(/^[A-Z0-9_-]{6}$/)
    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ passcode: data.passcode })
    )
  })
})
