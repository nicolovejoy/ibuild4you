import { describe, it, expect, vi, beforeEach } from 'vitest'

// =============================================================================
// PROJECT CLAIM ROUTE TESTS
//
// POST /api/projects/claim
//   Lets a signed-in user claim a project that was shared with them via a
//   project_members row. Admins short-circuit. The access guard (403 when
//   not shared) is the security-relevant path — projects.requester_* is
//   display-only and grants nothing (Garm PR E).
// =============================================================================

const mockHasSystemRole = vi.fn()
const mockProjectUpdate = vi.fn(async () => {})
const mockMemberAdd = vi.fn(async () => ({ id: 'm-new' }))
const mockMemberUpdate = vi.fn(async () => {})

let authResult: Record<string, unknown>
let projectDoc: { exists: boolean; data: () => Record<string, unknown> }
let memberDocs: { data: () => Record<string, unknown>; ref: { update: typeof mockMemberUpdate } }[]

const mockEmailWhere = vi.fn()

const mockCollection = vi.fn((name: string) => {
  if (name === 'projects') {
    return {
      doc: vi.fn(() => ({
        get: async () => projectDoc,
        update: mockProjectUpdate,
      })),
    }
  }
  // project_members — first where() is project_id, second is email.
  return {
    where: vi.fn(() => ({
      where: vi.fn((field2: string, _op2: string, value2: string) => {
        if (field2 === 'email') mockEmailWhere(value2)
        return {
          limit: vi.fn(() => ({
            get: async () => ({ empty: memberDocs.length === 0, docs: memberDocs }),
          })),
        }
      }),
    })),
    add: mockMemberAdd,
  }
})

vi.mock('@/lib/api/firebase-server-helpers', () => ({
  getAuthenticatedUser: vi.fn(async () => authResult),
  getAdminDb: vi.fn(() => ({ collection: mockCollection })),
  hasSystemRole: (...args: unknown[]) => mockHasSystemRole(...args),
}))

import { POST } from '../route'

function makeReq(body: unknown) {
  return new Request('http://localhost/api/projects/claim', {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

describe('POST /api/projects/claim', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    authResult = { uid: 'u1', email: 'u@ibuild4you.com', systemRoles: [], error: null }
    mockHasSystemRole.mockReturnValue(false)
    projectDoc = { exists: true, data: () => ({ requester_email: 'someone-else@x.com' }) }
    memberDocs = []
  })

  it('returns 400 when project_id is missing', async () => {
    const res = await POST(makeReq({}))
    expect(res.status).toBe(400)
  })

  it('returns 404 when the project does not exist', async () => {
    projectDoc = { exists: false, data: () => ({}) }
    const res = await POST(makeReq({ project_id: 'p1' }))
    expect(res.status).toBe(404)
  })

  it('short-circuits for an admin without touching membership', async () => {
    mockHasSystemRole.mockReturnValue(true)
    const res = await POST(makeReq({ project_id: 'p1' }))
    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({ claimed: true, project_id: 'p1' })
    expect(mockProjectUpdate).not.toHaveBeenCalled()
  })

  it('rejects with 403 when the project was not shared with the caller', async () => {
    const res = await POST(makeReq({ project_id: 'p1' }))
    expect(res.status).toBe(403)
    expect(mockProjectUpdate).not.toHaveBeenCalled()
  })

  it('claims via an existing membership and stamps user_id', async () => {
    memberDocs = [{ data: () => ({}), ref: { update: mockMemberUpdate } }]
    const res = await POST(makeReq({ project_id: 'p1' }))
    expect(res.status).toBe(200)
    expect(mockMemberUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ user_id: 'u1' })
    )
    expect(mockProjectUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ requester_id: 'u1' })
    )
  })

  // Garm PR E: requester_* on the project doc is display-only — a matching
  // requester_email/requester_id with no member row must NOT mint access.
  it('returns 403 for a requester_email-only match with no member row', async () => {
    projectDoc = { exists: true, data: () => ({ requester_email: 'u@ibuild4you.com' }) }
    const res = await POST(makeReq({ project_id: 'p1' }))
    expect(res.status).toBe(403)
    expect(mockMemberAdd).not.toHaveBeenCalled()
    expect(mockProjectUpdate).not.toHaveBeenCalled()
  })

  it('returns 403 for a requester_id-only match with no member row', async () => {
    projectDoc = { exists: true, data: () => ({ requester_id: 'u1' }) }
    const res = await POST(makeReq({ project_id: 'p1' }))
    expect(res.status).toBe(403)
    expect(mockMemberAdd).not.toHaveBeenCalled()
    expect(mockProjectUpdate).not.toHaveBeenCalled()
  })

  // #155: a mixed-case/whitespace-padded auth.email must still resolve
  // against project_members rows and requester_email stored normalized.
  it('normalizes a mixed-case auth.email before the membership where() query', async () => {
    authResult = { uid: 'u1', email: '  U@IBuild4You.com  ', systemRoles: [], error: null }
    memberDocs = [{ data: () => ({}), ref: { update: mockMemberUpdate } }]
    const res = await POST(makeReq({ project_id: 'p1' }))
    expect(res.status).toBe(200)
    expect(mockEmailWhere).toHaveBeenCalledWith('u@ibuild4you.com')
  })

  it('rejects an email-less token with no member row', async () => {
    authResult = { uid: 'u1', email: '', systemRoles: [], error: null }
    projectDoc = { exists: true, data: () => ({}) }
    const res = await POST(makeReq({ project_id: 'p1' }))
    expect(res.status).toBe(403)
    expect(mockMemberAdd).not.toHaveBeenCalled()
  })
})
