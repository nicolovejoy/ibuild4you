import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextResponse } from 'next/server'
import { POST } from '../share/route'

// =============================================================================
// POST /api/projects/share — invite a person to a brief (builder+).
//
// Focus: multi-person invites must NOT clobber the project's `requester_email`.
// The first share sets requester_email/shared_at; inviting a *second* distinct
// person creates a new project_members row but leaves the originator's identity
// on the project doc untouched.
// =============================================================================

// Captured writes.
const memberAdds: Record<string, unknown>[] = []
const projectUpdates: Record<string, unknown>[] = []
const approvedSets: Record<string, unknown>[] = []

let lastCollection = ''
// Per-test project doc data (controls whether requester_email is already set).
let projectDocData: Record<string, unknown> = {}
// Whether an existing member with the invited email already exists.
let existingMemberEmpty = true

const mockProjectDocGet = vi.fn(async () => ({ exists: true, data: () => projectDocData }))
const mockProjectDocUpdate = vi.fn(async (data: Record<string, unknown>) => {
  projectUpdates.push(data)
})

function membersWhereChain() {
  // .where().where().limit().get()
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
  lastCollection = name
  if (name === 'approved_emails') {
    return { doc: () => ({ set: async (d: Record<string, unknown>) => { approvedSets.push(d) } }) }
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
    // No active session → welcome-message block is skipped.
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

function makeReq(body: Record<string, unknown>) {
  return new Request('http://localhost/api/projects/share', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

describe('POST /api/projects/share', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    memberAdds.length = 0
    projectUpdates.length = 0
    approvedSets.length = 0
    projectDocData = {}
    existingMemberEmpty = true
    lastCollection = ''
    mockGetProjectRole.mockResolvedValue('builder')
  })

  it('first share sets requester_email and shared_at on the project', async () => {
    projectDocData = { title: 'Cafe App' } // no requester yet
    const res = await POST(makeReq({ project_id: 'p1', email: 'first@example.com', brief_role: 'originator' }))
    expect(res.status).toBe(200)
    expect(memberAdds).toHaveLength(1)
    expect(projectUpdates).toHaveLength(1)
    expect(projectUpdates[0].requester_email).toBe('first@example.com')
    expect(projectUpdates[0].shared_at).toBeDefined()
  })

  it('inviting a SECOND distinct person does NOT overwrite requester_email', async () => {
    projectDocData = { title: 'Cafe App', requester_email: 'first@example.com', shared_at: 'earlier' }
    const res = await POST(makeReq({ project_id: 'p1', email: 'second@example.com', brief_role: 'contributor' }))
    expect(res.status).toBe(200)
    // New member row created for the second person.
    expect(memberAdds).toHaveLength(1)
    expect(memberAdds[0].email).toBe('second@example.com')
    expect(memberAdds[0].brief_role).toBe('contributor')
    // Approved for sign-in.
    expect(approvedSets).toHaveLength(1)
    // Project doc requester identity is untouched.
    const update = projectUpdates[0] || {}
    expect(update.requester_email).toBeUndefined()
    expect(update.shared_at).toBeUndefined()
    // Returns the new person's passcode.
    const data = await res.json()
    expect(data.email).toBe('second@example.com')
    expect(data.passcode).toBeTruthy()
  })

  it('re-sharing the original requester keeps requester_email and may update name', async () => {
    projectDocData = { title: 'Cafe App', requester_email: 'first@example.com', shared_at: 'earlier' }
    existingMemberEmpty = false // member already exists → passcode regenerated
    const res = await POST(
      makeReq({ project_id: 'p1', email: 'first@example.com', first_name: 'First', brief_role: 'originator' })
    )
    expect(res.status).toBe(200)
    const update = projectUpdates[0] || {}
    // Same requester — name update allowed, email not clobbered with a different value.
    expect(update.requester_first_name).toBe('First')
  })
})
