import { describe, it, expect, vi, beforeEach } from 'vitest'
import { GET } from '../route'

// Tests for GET /api/admin/reminders — admin-only list of recent reminder_log
// decisions, newest first, with project titles hydrated.

const mockGetAuthenticatedUser = vi.fn()
const mockHasSystemRole = vi.fn()

type WhereCall = { field: string; op: string; value: unknown }
let whereCalls: WhereCall[] = []
let orderByCall: { field: string; dir: string } | null = null
let limitCall: number | null = null
const mockGet = vi.fn()
const mockProjectDocGet = vi.fn()

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
    limit(n: number) {
      limitCall = n
      return chain()
    },
    get: mockGet,
  }
}

vi.mock('@/lib/api/firebase-server-helpers', () => ({
  getAuthenticatedUser: (req: Request) => mockGetAuthenticatedUser(req),
  hasSystemRole: (auth: unknown, role: string) => mockHasSystemRole(auth, role),
  getAdminDb: () => ({
    collection: (name: string) => {
      if (name === 'projects') {
        return { doc: () => ({ get: mockProjectDocGet }) }
      }
      return chain()
    },
  }),
}))

const adminAuth = { uid: 'u1', email: 'admin@x.com', systemRoles: ['admin'], error: null }

beforeEach(() => {
  vi.clearAllMocks()
  whereCalls = []
  orderByCall = null
  limitCall = null
  mockGetAuthenticatedUser.mockResolvedValue(adminAuth)
  mockHasSystemRole.mockReturnValue(true)
  mockProjectDocGet.mockResolvedValue({ data: () => ({ title: 'Loris Therapy' }) })
})

function makeReq(qs = '') {
  return new Request(`http://localhost/api/admin/reminders${qs}`)
}

describe('GET /api/admin/reminders', () => {
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

  it('lists decisions ordered by decided_at desc and hydrates titles', async () => {
    mockGet.mockResolvedValueOnce({
      size: 2,
      docs: [
        { id: 'l1', data: () => ({ project_id: 'p1', decision: 'would_send', reminder_number: 1 }) },
        { id: 'l2', data: () => ({ project_id: 'p1', decision: 'skipped', reason: 'cap_reached' }) },
      ],
    })
    const res = await GET(makeReq())
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(orderByCall).toEqual({ field: 'decided_at', dir: 'desc' })
    expect(body.rows).toHaveLength(2)
    expect(body.rows[0].project_title).toBe('Loris Therapy')
  })

  it('filters by projectId via Firestore', async () => {
    mockGet.mockResolvedValueOnce({ size: 0, docs: [] })
    await GET(makeReq('?projectId=p1'))
    expect(whereCalls).toContainEqual({ field: 'project_id', op: '==', value: 'p1' })
  })

  it('filters by decision in memory', async () => {
    mockGet.mockResolvedValueOnce({
      size: 3,
      docs: [
        { id: 'l1', data: () => ({ project_id: 'p1', decision: 'sent' }) },
        { id: 'l2', data: () => ({ project_id: 'p1', decision: 'skipped' }) },
        { id: 'l3', data: () => ({ project_id: 'p1', decision: 'sent' }) },
      ],
    })
    const res = await GET(makeReq('?decision=sent'))
    const body = await res.json()
    expect(body.rows).toHaveLength(2)
    expect(whereCalls.find((w) => w.field === 'decision')).toBeUndefined()
  })

  it('rejects an invalid decision', async () => {
    const res = await GET(makeReq('?decision=banana'))
    expect(res.status).toBe(400)
  })

  it('caps the limit at MAX_LIMIT', async () => {
    mockGet.mockResolvedValueOnce({ size: 0, docs: [] })
    await GET(makeReq('?limit=99999'))
    expect(limitCall).toBe(1000)
  })
})
