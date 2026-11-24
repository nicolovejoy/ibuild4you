import { describe, it, expect, vi, beforeEach } from 'vitest'

// =============================================================================
// PATCH /api/projects/archive TESTS
//
// The archive flag is per viewer: it lives on the caller's own membership row.
//   - #155: auth.email is normalized before the email lookup and before a new
//     row is written (an instance admin with no row yet gets one).
//   - #295: the flag goes on the caller's ACTIVE row, never on a removed one.
// =============================================================================

const mockGetProjectRole = vi.fn(async (..._args: unknown[]) => 'owner')
const mockMemberAdd = vi.fn(async (_data: Record<string, unknown>) => {})
const mockEmailWhere = vi.fn()

type Row = { data: Record<string, unknown>; update: ReturnType<typeof vi.fn> }
// Rows the caller matches by uid, and by email.
let rowsByUid: Row[] = []
let rowsByEmail: Row[] = []

const row = (data: Record<string, unknown>): Row => ({ data, update: vi.fn(async () => {}) })
const toDocs = (rows: Row[]) => rows.map((r) => ({ data: () => r.data, ref: { update: r.update } }))

const mockCollection = vi.fn(() => ({
  where: vi.fn(() => ({
    where: vi.fn((field2: string, _op2: string, value2: string) => {
      if (field2 === 'email') mockEmailWhere(value2)
      const rows = field2 === 'email' ? rowsByEmail : rowsByUid
      return { get: async () => ({ empty: rows.length === 0, docs: toDocs(rows) }) }
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

const REMOVED = '2026-11-01T00:00:00.000Z'

describe('PATCH /api/projects/archive', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetProjectRole.mockResolvedValue('owner')
    rowsByUid = []
    rowsByEmail = []
    authResult = { uid: 'u1', email: '  Owner@X.COM  ', systemRoles: [], error: null }
  })

  it('normalizes auth.email before the email-fallback where() query and the new-member write (#155)', async () => {
    const res = await PATCH(makeReq({ project_id: 'p1', archived: true }))
    expect(res.status).toBe(200)
    expect(mockEmailWhere).toHaveBeenCalledWith('owner@x.com')
    expect(mockMemberAdd).toHaveBeenCalledWith(
      expect.objectContaining({ email: 'owner@x.com', added_by: 'owner@x.com' })
    )
  })

  it("writes the flag on the caller's active row", async () => {
    const mine = row({ role: 'builder' })
    rowsByUid = [mine]
    const res = await PATCH(makeReq({ project_id: 'p1', archived: true }))
    expect(res.status).toBe(200)
    expect(mine.update).toHaveBeenCalledWith(expect.objectContaining({ archived_at: expect.any(String) }))
    expect(mockMemberAdd).not.toHaveBeenCalled()
  })

  // #295: a removed row matching the uid used to take the flag, while the list
  // read the active row found by email, so the brief never showed as archived.
  it('skips a removed row matched by uid and writes on the active row matched by email (#295)', async () => {
    const removed = row({ role: 'maker', removed_at: REMOVED })
    const active = row({ role: 'builder', removed_at: null })
    rowsByUid = [removed]
    rowsByEmail = [active]
    const res = await PATCH(makeReq({ project_id: 'p1', archived: true }))
    expect(res.status).toBe(200)
    expect(removed.update).not.toHaveBeenCalled()
    expect(active.update).toHaveBeenCalledWith(expect.objectContaining({ archived_at: expect.any(String) }))
    expect(mockMemberAdd).not.toHaveBeenCalled()
  })

  it('answers 409 and writes nothing when the only row is a removed one (#295)', async () => {
    const removed = row({ role: 'builder', removed_at: REMOVED })
    rowsByEmail = [removed]
    const res = await PATCH(makeReq({ project_id: 'p1', archived: true }))
    expect(res.status).toBe(409)
    expect(removed.update).not.toHaveBeenCalled()
    expect(mockMemberAdd).not.toHaveBeenCalled()
  })
})
