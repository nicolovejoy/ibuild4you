import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextResponse } from 'next/server'
import { PATCH } from '../[id]/members/[memberId]/route'

// Firestore mock: collection('project_members') supports both
//   .where('project_id','==',id).get()  → roster
//   .doc(memberId).update(patch)        → apply
const mockGet = vi.fn()
const mockUpdate = vi.fn(async () => undefined)
const mockDoc = vi.fn(() => ({ update: mockUpdate }))
const mockWhere = vi.fn(() => ({ get: mockGet }))
const mockCollection = vi.fn(() => ({ where: mockWhere, doc: mockDoc }))
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

function makeReq(body: unknown) {
  return new Request('http://localhost/api/projects/proj1/members/m2', {
    method: 'PATCH',
    body: JSON.stringify(body),
  })
}
const ctx = { params: Promise.resolve({ id: 'proj1', memberId: 'm2' }) }

function seedRoster() {
  mockGet.mockResolvedValue({
    docs: [
      { id: 'm1', data: () => ({ email: 'owner@x.com', role: 'owner' }) },
      { id: 'm2', data: () => ({ email: 'mara@x.com', role: 'maker' }) },
    ],
  })
}

describe('PATCH /api/projects/[id]/members/[memberId]', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetProjectRole.mockResolvedValue('builder')
    seedRoster()
  })

  it('returns 403 when caller is below builder', async () => {
    mockGetProjectRole.mockResolvedValue('maker')
    const res = await PATCH(makeReq({ role: 'builder' }), ctx)
    expect(res.status).toBe(403)
    expect(mockUpdate).not.toHaveBeenCalled()
  })

  it('updates the member access tier for a valid change', async () => {
    const res = await PATCH(makeReq({ role: 'builder' }), ctx)
    expect(res.status).toBe(200)
    expect(mockDoc).toHaveBeenCalledWith('m2')
    expect(mockUpdate).toHaveBeenCalledWith(expect.objectContaining({ role: 'builder' }))
  })

  it('rejects an invalid role with 400 and no write', async () => {
    const res = await PATCH(makeReq({ role: 'wizard' }), ctx)
    expect(res.status).toBe(400)
    expect(mockUpdate).not.toHaveBeenCalled()
  })

  it('refuses to demote the last owner (400, no write)', async () => {
    const ownerCtx = { params: Promise.resolve({ id: 'proj1', memberId: 'm1' }) }
    const req = new Request('http://localhost/api/projects/proj1/members/m1', {
      method: 'PATCH',
      body: JSON.stringify({ role: 'maker' }),
    })
    const res = await PATCH(req, ownerCtx)
    expect(res.status).toBe(400)
    expect(mockUpdate).not.toHaveBeenCalled()
  })
})
