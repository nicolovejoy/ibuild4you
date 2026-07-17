import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextResponse } from 'next/server'
import { PATCH } from '../share/route'

// Per-collection mocks so we can assert each of the three coupled writes
// (approved_emails, project_members, projects) independently.
const memberUpdate = vi.fn()
const projectUpdate = vi.fn()
const approvedSet = vi.fn()
const projectGet = vi.fn()
const membersGet = vi.fn()

// project_members chainable query: .where().where().limit().get()
const membersLimit = vi.fn(() => ({ get: membersGet }))
const membersWhere = vi.fn(() => ({ where: membersWhere, limit: membersLimit }))

const mockCollection = vi.fn((name: string) => {
  if (name === 'projects') {
    return { doc: vi.fn(() => ({ get: projectGet, update: projectUpdate })) }
  }
  if (name === 'approved_emails') {
    return { doc: vi.fn(() => ({ set: approvedSet })) }
  }
  // project_members
  return { where: membersWhere }
})

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

vi.mock('@/lib/agent/welcome-message', () => ({
  generateWelcomeMessage: vi.fn(async () => 'Welcome!'),
}))

function patchReq(body: Record<string, unknown>) {
  return new Request('http://localhost/api/projects/share', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

describe('PATCH /api/projects/share — re-key requester email (#12)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetProjectRole.mockResolvedValue('builder')
    projectGet.mockResolvedValue({
      exists: true,
      data: () => ({ requester_email: 'typo@old.com' }),
    })
    membersGet.mockResolvedValue({
      empty: false,
      docs: [{ ref: { update: memberUpdate }, data: () => ({ email: 'typo@old.com' }) }],
    })
  })

  it('returns 400 when new_email is missing (passcode reset path retired — PR D)', async () => {
    const res = await PATCH(patchReq({ project_id: 'proj1' }))
    expect(res.status).toBe(400)
    expect(memberUpdate).not.toHaveBeenCalled()
  })

  it('returns 403 when caller is a maker', async () => {
    mockGetProjectRole.mockResolvedValue('maker')
    const res = await PATCH(patchReq({ project_id: 'proj1', new_email: 'fixed@new.com' }))
    expect(res.status).toBe(403)
  })

  it('returns 404 when the project does not exist', async () => {
    projectGet.mockResolvedValue({ exists: false })
    const res = await PATCH(patchReq({ project_id: 'proj1', new_email: 'fixed@new.com' }))
    expect(res.status).toBe(404)
  })

  it('approves the new email, re-keys the member, and updates the project', async () => {
    const res = await PATCH(patchReq({ project_id: 'proj1', new_email: 'Fixed@New.com' }))
    expect(res.status).toBe(200)
    const data = await res.json()

    // normalized + returned; no passcode anywhere (retired — PR D)
    expect(data.email).toBe('fixed@new.com')
    expect(data.passcode).toBeUndefined()

    // 1. approved_emails gets the new (normalized) address
    expect(approvedSet).toHaveBeenCalledWith(
      expect.objectContaining({ email: 'fixed@new.com' })
    )

    // 2. member row re-keyed to the new email, and no passcode written
    expect(memberUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ email: 'fixed@new.com' })
    )
    expect(memberUpdate.mock.calls[0][0].passcode).toBeUndefined()

    // 3. project.requester_email updated
    expect(projectUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ requester_email: 'fixed@new.com' })
    )
  })

  it('does not delete the old approved_emails entry', async () => {
    // The mock has no delete; assert we never attempt one by ensuring the
    // approved_emails doc was only written via .set (covered above) — there is
    // no .delete in the chain, so a delete call would throw. Sanity: succeeds.
    const res = await PATCH(patchReq({ project_id: 'proj1', new_email: 'fixed@new.com' }))
    expect(res.status).toBe(200)
  })

  it('falls back to the maker-role member when no row matches the old email', async () => {
    // First lookup (by old email) is empty; second (by role) returns the member.
    membersGet
      .mockResolvedValueOnce({ empty: true })
      .mockResolvedValueOnce({
        empty: false,
        docs: [{ ref: { update: memberUpdate }, data: () => ({}) }],
      })
    const res = await PATCH(patchReq({ project_id: 'proj1', new_email: 'fixed@new.com' }))
    expect(res.status).toBe(200)
    expect(memberUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ email: 'fixed@new.com' })
    )
  })
})
