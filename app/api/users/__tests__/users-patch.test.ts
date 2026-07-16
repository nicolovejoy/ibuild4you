import { describe, it, expect, vi, beforeEach } from 'vitest'

// =============================================================================
// PATCH /api/users TESTS (#155)
//
// The email-lookup branch (no real Firebase UID yet) queries Firestore Auth
// by a raw request-body email and syncs project_members by an unnormalized
// `targetEmail` — an admin pasting " Maker@X.COM " must still resolve to the
// same person as the stored, normalized project_members rows.
// =============================================================================

const mockHasSystemRole = vi.fn((..._args: unknown[]) => true)
const mockGetUserByEmail = vi.fn()
const mockMemberUpdate = vi.fn(async () => {})

let memberDocs: { ref: { update: typeof mockMemberUpdate } }[] = []
let userDocExists = false
let userDocData: Record<string, unknown> = {}
const mockUserSet = vi.fn(async () => {})
const mockUserUpdate = vi.fn(async () => {})
const mockEmailWhere = vi.fn()

const mockCollection = vi.fn((name: string) => {
  if (name === 'users') {
    return {
      doc: vi.fn(() => ({
        get: async () => ({ exists: userDocExists, data: () => userDocData }),
        set: mockUserSet,
        update: mockUserUpdate,
      })),
    }
  }
  // project_members
  return {
    where: vi.fn((field: string, _op: string, value: string) => {
      if (field === 'email') mockEmailWhere(value)
      return {
        get: async () => ({ docs: memberDocs }),
      }
    }),
  }
})

vi.mock('@/lib/api/firebase-server-helpers', () => ({
  getAuthenticatedUser: vi.fn(async () => ({
    uid: 'admin-1',
    email: 'admin@ibuild4you.com',
    error: null,
  })),
  getAdminDb: vi.fn(() => ({ collection: mockCollection })),
  hasSystemRole: (...args: unknown[]) => mockHasSystemRole(...args),
}))

vi.mock('@/lib/firebase/admin', () => ({
  getAdminAuth: vi.fn(() => ({
    getUserByEmail: mockGetUserByEmail,
  })),
}))

import { PATCH } from '../route'

function makeReq(body: unknown) {
  return new Request('http://localhost/api/users', {
    method: 'PATCH',
    body: JSON.stringify(body),
  })
}

describe('PATCH /api/users — email normalization (#155)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockHasSystemRole.mockReturnValue(true)
    memberDocs = []
    userDocExists = false
    userDocData = {}
  })

  it('normalizes a mixed-case/whitespace email before the Firebase Auth lookup', async () => {
    mockGetUserByEmail.mockResolvedValue({ uid: 'uid-resolved' })
    await PATCH(makeReq({ email: '  Maker@X.COM  ', first_name: 'Maker' }))

    expect(mockGetUserByEmail).toHaveBeenCalledWith('maker@x.com')
  })

  it('normalizes the email before the project_members sync where() query', async () => {
    mockGetUserByEmail.mockResolvedValue({ uid: 'uid-resolved' })
    memberDocs = [{ ref: { update: mockMemberUpdate } }]

    await PATCH(makeReq({ email: '  Maker@X.COM  ', first_name: 'Maker' }))

    expect(mockEmailWhere).toHaveBeenCalledWith('maker@x.com')
    expect(mockMemberUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ user_id: 'uid-resolved' })
    )
  })

  it('stores the normalized email on a newly created users doc', async () => {
    mockGetUserByEmail.mockRejectedValue(new Error('no auth user'))
    userDocExists = false

    await PATCH(makeReq({ email: '  Maker@X.COM  ', first_name: 'Maker' }))

    expect(mockUserSet).toHaveBeenCalledWith(
      expect.objectContaining({ email: 'maker@x.com' })
    )
  })

  it('returns 400 when the normalized email is empty (whitespace-only input)', async () => {
    const res = await PATCH(makeReq({ email: '   ', first_name: 'X' }))
    expect(res.status).toBe(400)
  })
})
