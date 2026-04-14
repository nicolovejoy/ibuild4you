import { describe, it, expect, vi, beforeEach } from 'vitest'
import { GET } from '../route'

const mockGetAuthenticatedUser = vi.fn()
const mockHasSystemRole = vi.fn()
const mockOrderBy = vi.fn()
const mockGet = vi.fn()

vi.mock('@/lib/api/firebase-server-helpers', () => ({
  getAuthenticatedUser: (req: Request) => mockGetAuthenticatedUser(req),
  hasSystemRole: (auth: unknown, role: string) => mockHasSystemRole(auth, role),
  getAdminDb: () => ({
    collection: () => ({
      orderBy: (...args: unknown[]) => {
        mockOrderBy(...args)
        return { get: mockGet }
      },
    }),
  }),
}))

beforeEach(() => {
  mockGetAuthenticatedUser.mockReset()
  mockHasSystemRole.mockReset()
  mockOrderBy.mockReset()
  mockGet.mockReset()
})

const req = () => new Request('http://localhost/api/admin/interest')

describe('GET /api/admin/interest', () => {
  it('returns 401 when unauthenticated', async () => {
    mockGetAuthenticatedUser.mockResolvedValue({
      error: new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 }),
    })
    const res = await GET(req())
    expect(res.status).toBe(401)
  })

  it('returns 403 when authenticated but not admin', async () => {
    mockGetAuthenticatedUser.mockResolvedValue({ uid: 'u1', email: 'x@y.com', systemRoles: [], error: null })
    mockHasSystemRole.mockReturnValue(false)
    const res = await GET(req())
    expect(res.status).toBe(403)
  })

  it('returns submissions newest-first for admins', async () => {
    mockGetAuthenticatedUser.mockResolvedValue({ uid: 'u1', email: 'admin@x.com', systemRoles: ['admin'], error: null })
    mockHasSystemRole.mockReturnValue(true)
    mockGet.mockResolvedValue({
      docs: [
        { id: 'a', data: () => ({ name: 'Alice', email: 'a@x.com', created_at: '2026-04-14T00:00:00Z' }) },
        { id: 'b', data: () => ({ name: 'Bob', email: 'b@x.com', created_at: '2026-04-13T00:00:00Z' }) },
      ],
    })
    const res = await GET(req())
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toHaveLength(2)
    expect(body[0]).toMatchObject({ id: 'a', name: 'Alice' })
    expect(mockOrderBy).toHaveBeenCalledWith('created_at', 'desc')
  })
})
