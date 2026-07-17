import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextResponse } from 'next/server'
import { PATCH, DELETE } from '../route'

// =============================================================================
// Garm dual-write wiring check (follow-up to PR #158).
//
// The member lifecycle route (role-tier PATCH, restore PATCH, DELETE/remove)
// syncs the target member's email on every successful write via the shared
// `apply()` helper, but NOT when the planner rejects the change (e.g. last
// owner). Verified so far only by inspection.
// =============================================================================

const scheduleGarmGrantSyncMock = vi.fn()
vi.mock('@/lib/garm-grants', () => ({
  scheduleGarmGrantSync: (...args: unknown[]) => scheduleGarmGrantSyncMock(...args),
}))

const mockUpdate = vi.fn(async () => {})
let rosterDocs: Array<{ id: string; email: string; role: string; removed_at: string | null }> = []

const mockCollection = vi.fn(() => ({
  where: vi.fn(() => ({
    get: vi.fn(async () => ({
      docs: rosterDocs.map((m) => ({
        id: m.id,
        data: () => ({ email: m.email, role: m.role, removed_at: m.removed_at }),
      })),
    })),
  })),
  doc: vi.fn(() => ({ update: mockUpdate })),
}))

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

function makeReq(method: string, body?: Record<string, unknown>) {
  return new Request('http://localhost/api/projects/p1/members/m2', {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  })
}

const params = Promise.resolve({ id: 'p1', memberId: 'm2' })

describe('PATCH/DELETE /api/projects/[id]/members/[memberId] → scheduleGarmGrantSync', () => {
  beforeEach(() => {
    scheduleGarmGrantSyncMock.mockClear()
    mockGetProjectRole.mockResolvedValue('builder')
    rosterDocs = [
      { id: 'm1', email: 'owner@example.com', role: 'owner', removed_at: null },
      { id: 'm2', email: 'target@example.com', role: 'maker', removed_at: null },
    ]
  })

  it('syncs the target member email on a role-tier PATCH', async () => {
    const res = await PATCH(makeReq('PATCH', { role: 'builder' }), { params })
    expect(res.status).toBe(200)
    expect(scheduleGarmGrantSyncMock).toHaveBeenCalledWith('target@example.com')
    expect(scheduleGarmGrantSyncMock).toHaveBeenCalledTimes(1)
  })

  it('syncs the target member email on a restore PATCH', async () => {
    rosterDocs[1].removed_at = '2026-01-01T00:00:00.000Z'
    const res = await PATCH(makeReq('PATCH', { removed: false }), { params })
    expect(res.status).toBe(200)
    expect(scheduleGarmGrantSyncMock).toHaveBeenCalledWith('target@example.com')
  })

  it('syncs the target member email on DELETE (remove)', async () => {
    const res = await DELETE(makeReq('DELETE'), { params })
    expect(res.status).toBe(200)
    expect(scheduleGarmGrantSyncMock).toHaveBeenCalledWith('target@example.com')
  })

  it('does NOT sync when the plan errors (e.g. demoting the last owner)', async () => {
    rosterDocs = [{ id: 'm2', email: 'target@example.com', role: 'owner', removed_at: null }]
    const res = await PATCH(makeReq('PATCH', { role: 'builder' }), { params })
    expect(res.status).toBe(400)
    expect(scheduleGarmGrantSyncMock).not.toHaveBeenCalled()
  })
})
