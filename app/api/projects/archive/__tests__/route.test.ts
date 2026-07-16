import { describe, it, expect, vi, beforeEach } from 'vitest'

// =============================================================================
// PATCH /api/projects/archive TESTS (#155 normalization coverage)
//
// This route creates a project_members row when the caller has no membership
// yet (e.g. a legacy requester_* owner archiving for the first time). #155:
// defensively normalize auth.email so a mixed-case token email still finds
// an existing row and, if it creates a new one, stores it normalized.
// =============================================================================

const mockGetProjectRole = vi.fn(async (..._args: unknown[]) => 'owner')
const mockMemberAdd = vi.fn(async () => {})
const mockEmailWhere = vi.fn()

let byUidEmpty = true

const mockCollection = vi.fn(() => ({
  where: vi.fn(() => ({
    where: vi.fn((field2: string, _op2: string, value2: string) => {
      if (field2 === 'email') mockEmailWhere(value2)
      return {
        limit: vi.fn(() => ({
          get: async () => ({ empty: byUidEmpty, docs: [] }),
        })),
      }
    }),
  })),
  add: mockMemberAdd,
}))

let authResult: Record<string, unknown>

vi.mock('@/lib/api/firebase-server-helpers', () => ({
  getAuthenticatedUser: vi.fn(async () => authResult),
  getAdminDb: vi.fn(() => ({ collection: mockCollection })),
  getProjectRole: (...args: unknown[]) => mockGetProjectRole(...args),
}))

import { PATCH } from '../route'

function makeReq(body: unknown) {
  return new Request('http://localhost/api/projects/archive', {
    method: 'PATCH',
    body: JSON.stringify(body),
  })
}

describe('PATCH /api/projects/archive — email normalization (#155)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetProjectRole.mockResolvedValue('owner')
    byUidEmpty = true
    authResult = { uid: 'u1', email: '  Owner@X.COM  ', systemRoles: [], error: null }
  })

  it('normalizes auth.email before the email-fallback where() query and the new-member write', async () => {
    const res = await PATCH(makeReq({ project_id: 'p1', archived: true }))
    expect(res.status).toBe(200)
    expect(mockEmailWhere).toHaveBeenCalledWith('owner@x.com')
    expect(mockMemberAdd).toHaveBeenCalledWith(
      expect.objectContaining({ email: 'owner@x.com', added_by: 'owner@x.com' })
    )
  })
})
