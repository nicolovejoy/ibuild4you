import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextResponse } from 'next/server'
import { GET } from '../route'

// =============================================================================
// Tests for GET /api/admin/feedback/[id]/replies: admins read straight away,
// everyone else is checked against the feedback row's app.
// =============================================================================

const mockGetAuthenticatedUser = vi.fn()
const mockHasSystemRole = vi.fn()
const mockRowGet = vi.fn()
const mockRepliesGet = vi.fn()

vi.mock('@/lib/api/firebase-server-helpers', () => ({
  getAuthenticatedUser: (req: Request) => mockGetAuthenticatedUser(req),
  hasSystemRole: (auth: unknown, role: string) => mockHasSystemRole(auth, role),
  getAdminDb: () => ({
    collection: () => ({
      doc: () => ({
        get: mockRowGet,
        collection: () => ({ orderBy: () => ({ get: mockRepliesGet }) }),
      }),
    }),
  }),
}))

const mockRequireFeedbackAccess = vi.fn()
vi.mock('@/lib/api/feedback-access', () => ({
  requireFeedbackAccess: (...args: unknown[]) => mockRequireFeedbackAccess(...args),
}))

const auth = { uid: 'u1', email: 'a@x.com', systemRoles: [], error: null }
const params = Promise.resolve({ id: 'fb_1' })
const req = () => new Request('http://localhost/api/admin/feedback/fb_1/replies')

beforeEach(() => {
  vi.clearAllMocks()
  mockGetAuthenticatedUser.mockResolvedValue(auth)
  mockHasSystemRole.mockReturnValue(true)
  mockRequireFeedbackAccess.mockResolvedValue(null)
  mockRowGet.mockResolvedValue({ exists: true, data: () => ({ project_id: 'byside' }) })
  mockRepliesGet.mockResolvedValue({ docs: [{ id: 'r1', data: () => ({ body: 'hi' }) }] })
})

describe('GET /api/admin/feedback/[id]/replies', () => {
  it('returns replies to an admin without loading the row', async () => {
    const res = await GET(req(), { params })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual([{ id: 'r1', body: 'hi' }])
    expect(mockRowGet).not.toHaveBeenCalled()
  })

  it('returns replies to a non-admin collaborator on the row\'s app', async () => {
    mockHasSystemRole.mockReturnValue(false)
    const res = await GET(req(), { params })
    expect(res.status).toBe(200)
    expect(mockRequireFeedbackAccess).toHaveBeenCalledWith(expect.anything(), 'byside')
  })

  it('returns 403 for a non-admin without access to the row\'s app', async () => {
    mockHasSystemRole.mockReturnValue(false)
    mockRequireFeedbackAccess.mockResolvedValue(NextResponse.json({ error: 'Forbidden' }, { status: 403 }))
    const res = await GET(req(), { params })
    expect(res.status).toBe(403)
    expect(mockRepliesGet).not.toHaveBeenCalled()
  })

  it('returns 404 for a missing row before any access check', async () => {
    mockHasSystemRole.mockReturnValue(false)
    mockRowGet.mockResolvedValue({ exists: false, data: () => undefined })
    const res = await GET(req(), { params })
    expect(res.status).toBe(404)
    expect(mockRequireFeedbackAccess).not.toHaveBeenCalled()
  })
})
