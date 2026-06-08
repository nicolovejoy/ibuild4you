import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextResponse } from 'next/server'
import { PATCH } from '../role/route'

const mockUpdate = vi.fn()
const mockGet = vi.fn()
const mockLimit = vi.fn(() => ({ get: mockGet }))
const mockWhere = vi.fn(() => ({ where: mockWhere, limit: mockLimit }))
const mockCollection = vi.fn(() => ({ where: mockWhere }))

const mockGetProjectRole = vi.fn()

vi.mock('@/lib/api/firebase-server-helpers', () => ({
  getAuthenticatedUser: vi.fn(async () => ({
    uid: 'builder-uid',
    email: 'builder@example.com',
    error: null,
    systemRoles: [],
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

function makeReq(body: Record<string, unknown>) {
  return new Request('http://localhost/api/projects/role', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

describe('PATCH /api/projects/role', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetProjectRole.mockResolvedValue('builder')
    mockGet.mockResolvedValue({
      empty: false,
      docs: [{ ref: { update: mockUpdate }, data: () => ({ email: 'tom@x.com' }) }],
    })
  })

  it('returns 400 when project_id or email is missing', async () => {
    expect((await PATCH(makeReq({ email: 'tom@x.com', brief_role: 'contributor' }))).status).toBe(400)
    expect((await PATCH(makeReq({ project_id: 'p1', brief_role: 'contributor' }))).status).toBe(400)
  })

  it('returns 400 for an invalid brief_role', async () => {
    const res = await PATCH(makeReq({ project_id: 'p1', email: 'tom@x.com', brief_role: 'boss' }))
    expect(res.status).toBe(400)
  })

  it('returns 403 when caller is below builder', async () => {
    mockGetProjectRole.mockResolvedValue('maker')
    const res = await PATCH(makeReq({ project_id: 'p1', email: 'tom@x.com', brief_role: 'contributor' }))
    expect(res.status).toBe(403)
  })

  it('returns 404 when the member does not exist', async () => {
    mockGet.mockResolvedValue({ empty: true, docs: [] })
    const res = await PATCH(makeReq({ project_id: 'p1', email: 'nobody@x.com', brief_role: 'contributor' }))
    expect(res.status).toBe(404)
  })

  it('writes a valid brief_role to the member doc', async () => {
    const res = await PATCH(makeReq({ project_id: 'p1', email: 'tom@x.com', brief_role: 'contributor' }))
    expect(res.status).toBe(200)
    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ brief_role: 'contributor', updated_at: expect.any(String) })
    )
  })

  it('accepts null to clear the brief_role', async () => {
    const res = await PATCH(makeReq({ project_id: 'p1', email: 'owner@x.com', brief_role: null }))
    expect(res.status).toBe(200)
    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ brief_role: null })
    )
  })
})
