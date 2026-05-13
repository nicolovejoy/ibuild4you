import { describe, it, expect, vi, beforeEach } from 'vitest'
import { GET } from '../route'

// =============================================================================
// Tests for GET /api/admin/feedback (list with optional filters).
// Filters: ?projectId=...&status=...&type=...
// project_id + status compose via Firestore; type is applied in memory.
// =============================================================================

const mockGetAuthenticatedUser = vi.fn()
const mockHasSystemRole = vi.fn()

type WhereCall = { field: string; op: string; value: unknown }
let whereCalls: WhereCall[] = []
let orderByCall: { field: string; dir: string } | null = null
const mockGet = vi.fn()

function chain() {
  return {
    where(field: string, op: string, value: unknown) {
      whereCalls.push({ field, op, value })
      return chain()
    },
    orderBy(field: string, dir: string) {
      orderByCall = { field, dir }
      return chain()
    },
    get: mockGet,
  }
}

vi.mock('@/lib/api/firebase-server-helpers', () => ({
  getAuthenticatedUser: (req: Request) => mockGetAuthenticatedUser(req),
  hasSystemRole: (auth: unknown, role: string) => mockHasSystemRole(auth, role),
  getAdminDb: () => ({
    collection: () => chain(),
  }),
}))

const adminAuth = { uid: 'u1', email: 'admin@x.com', systemRoles: ['admin'], error: null }

beforeEach(() => {
  vi.clearAllMocks()
  whereCalls = []
  orderByCall = null
  mockGetAuthenticatedUser.mockResolvedValue(adminAuth)
  mockHasSystemRole.mockReturnValue(true)
})

function makeReq(qs = '') {
  return new Request(`http://localhost/api/admin/feedback${qs}`)
}

describe('GET /api/admin/feedback', () => {
  it('returns 401 when unauthenticated', async () => {
    mockGetAuthenticatedUser.mockResolvedValueOnce({
      error: new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 }),
    })
    const res = await GET(makeReq())
    expect(res.status).toBe(401)
  })

  it('returns 403 for non-admins', async () => {
    mockHasSystemRole.mockReturnValueOnce(false)
    const res = await GET(makeReq())
    expect(res.status).toBe(403)
  })

  it('returns all feedback ordered by created_at desc when no filters', async () => {
    mockGet.mockResolvedValueOnce({
      docs: [
        { id: 'f1', data: () => ({ project_id: 'p1', type: 'bug', status: 'new' }) },
        { id: 'f2', data: () => ({ project_id: 'p2', type: 'idea', status: 'new' }) },
      ],
    })
    const res = await GET(makeReq())
    expect(res.status).toBe(200)
    const rows = await res.json()
    expect(rows).toHaveLength(2)
    expect(whereCalls).toEqual([])
    expect(orderByCall).toEqual({ field: 'created_at', dir: 'desc' })
  })

  it('filters by projectId', async () => {
    mockGet.mockResolvedValueOnce({ docs: [] })
    await GET(makeReq('?projectId=bakery-louise'))
    expect(whereCalls).toContainEqual({ field: 'project_id', op: '==', value: 'bakery-louise' })
  })

  it('filters by status', async () => {
    mockGet.mockResolvedValueOnce({ docs: [] })
    await GET(makeReq('?status=in_progress'))
    expect(whereCalls).toContainEqual({ field: 'status', op: '==', value: 'in_progress' })
  })

  it('rejects invalid status', async () => {
    const res = await GET(makeReq('?status=banana'))
    expect(res.status).toBe(400)
  })

  it('filters by type in memory (no Firestore where clause)', async () => {
    mockGet.mockResolvedValueOnce({
      docs: [
        { id: 'f1', data: () => ({ type: 'bug', status: 'new' }) },
        { id: 'f2', data: () => ({ type: 'idea', status: 'new' }) },
        { id: 'f3', data: () => ({ type: 'bug', status: 'new' }) },
      ],
    })
    const res = await GET(makeReq('?type=bug'))
    const rows = await res.json()
    expect(rows).toHaveLength(2)
    expect(whereCalls.find((w) => w.field === 'type')).toBeUndefined()
  })

  it('composes projectId + status', async () => {
    mockGet.mockResolvedValueOnce({ docs: [] })
    await GET(makeReq('?projectId=bakery-louise&status=new'))
    expect(whereCalls).toContainEqual({ field: 'project_id', op: '==', value: 'bakery-louise' })
    expect(whereCalls).toContainEqual({ field: 'status', op: '==', value: 'new' })
  })
})
