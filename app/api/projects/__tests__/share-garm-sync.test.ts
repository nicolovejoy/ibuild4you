import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextResponse } from 'next/server'
import { POST, PATCH } from '../share/route'

// =============================================================================
// Garm dual-write wiring check (follow-up to PR #158).
//
// POST /api/projects/share (invite) syncs the invited email; PATCH (rekey)
// syncs BOTH the new and the old email (the old one may still hold grants via
// another brief). Verified so far only by inspection.
// =============================================================================

const scheduleGarmGrantSyncMock = vi.fn()
vi.mock('@/lib/garm-grants', () => ({
  scheduleGarmGrantSync: (...args: unknown[]) => scheduleGarmGrantSyncMock(...args),
}))

const memberAdds: Record<string, unknown>[] = []
let projectDocData: Record<string, unknown> = {}
let existingMemberEmpty = true

const mockProjectDocGet = vi.fn(async () => ({ exists: true, data: () => projectDocData }))
const mockProjectDocUpdate = vi.fn(async () => {})

function membersWhereChain() {
  return {
    where: () => ({
      limit: () => ({
        get: async () => ({
          empty: existingMemberEmpty,
          docs: existingMemberEmpty
            ? []
            : [{ ref: { update: vi.fn(async () => {}) }, data: () => ({}) }],
        }),
      }),
    }),
  }
}

const mockCollection = vi.fn((name: string) => {
  if (name === 'approved_emails') {
    return { doc: () => ({ set: async () => {} }) }
  }
  if (name === 'project_members') {
    return {
      where: membersWhereChain,
      add: async (d: Record<string, unknown>) => { memberAdds.push(d); return { id: 'new-member' } },
    }
  }
  if (name === 'projects') {
    return { doc: () => ({ get: mockProjectDocGet, update: mockProjectDocUpdate }) }
  }
  if (name === 'sessions') {
    return { where: () => ({ where: () => ({ limit: () => ({ get: async () => ({ empty: true }) }) }) }) }
  }
  return { where: () => ({}), doc: () => ({}) }
})

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

vi.mock('@/lib/agent/welcome-message', () => ({
  generateWelcomeMessage: vi.fn(async () => 'Welcome!'),
}))

vi.mock('@/lib/auth/ensure-invite-account', () => ({
  ensureInviteResetLink: vi.fn(async (email: string) => `https://example.com/reset/${email}`),
}))

function makeReq(method: string, body: Record<string, unknown>) {
  return new Request('http://localhost/api/projects/share', {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

describe('POST/PATCH /api/projects/share → scheduleGarmGrantSync', () => {
  beforeEach(() => {
    scheduleGarmGrantSyncMock.mockClear()
    memberAdds.length = 0
    projectDocData = {}
    existingMemberEmpty = true
    mockGetProjectRole.mockResolvedValue('builder')
  })

  it('syncs the invited email on POST (invite)', async () => {
    projectDocData = { title: 'Cafe App' }
    const res = await POST(makeReq('POST', { project_id: 'p1', email: 'invitee@example.com', brief_role: 'originator' }))
    expect(res.status).toBe(200)
    expect(scheduleGarmGrantSyncMock).toHaveBeenCalledWith('invitee@example.com')
    expect(scheduleGarmGrantSyncMock).toHaveBeenCalledTimes(1)
  })

  it('syncs both the new AND old email on PATCH (rekey)', async () => {
    projectDocData = { title: 'Cafe App', requester_email: 'old@example.com' }
    const res = await PATCH(makeReq('PATCH', { project_id: 'p1', new_email: 'new@example.com' }))
    expect(res.status).toBe(200)
    const calledWith = scheduleGarmGrantSyncMock.mock.calls.map((c) => c[0])
    expect(calledWith).toEqual(expect.arrayContaining(['new@example.com', 'old@example.com']))
    expect(scheduleGarmGrantSyncMock).toHaveBeenCalledTimes(2)
  })
})
