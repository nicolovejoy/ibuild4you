import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextResponse } from 'next/server'
import { requireFeedbackAccess } from '../feedback-access'

const mockHasSystemRole = vi.fn()
const mockFindAppBySlug = vi.fn()
const mockRequireAppAccess = vi.fn()

vi.mock('@/lib/api/firebase-server-helpers', () => ({
  getAdminDb: () => ({}),
  hasSystemRole: (auth: unknown, role: string) => mockHasSystemRole(auth, role),
}))
vi.mock('@/lib/api/apps', () => ({
  findAppBySlug: (...args: unknown[]) => mockFindAppBySlug(...args),
}))
vi.mock('@/lib/api/app-access', () => ({
  requireAppAccess: (...args: unknown[]) => mockRequireAppAccess(...args),
}))

const auth = { uid: 'u1', email: 'a@x.com', systemRoles: [], error: null } as never

beforeEach(() => {
  vi.clearAllMocks()
  mockHasSystemRole.mockReturnValue(false)
})

describe('requireFeedbackAccess', () => {
  it('lets a system admin through without touching Garm or apps', async () => {
    mockHasSystemRole.mockReturnValue(true)
    expect(await requireFeedbackAccess(auth, 'anything')).toBeNull()
    expect(mockFindAppBySlug).not.toHaveBeenCalled()
    expect(mockRequireAppAccess).not.toHaveBeenCalled()
  })

  it('resolves a legacy project id to the canonical slug before asking Garm', async () => {
    mockFindAppBySlug.mockResolvedValue({ slug: 'bakerylouise', legacy_slugs: ['bakery-louise'] })
    mockRequireAppAccess.mockResolvedValue(null)
    expect(await requireFeedbackAccess(auth, 'bakery-louise')).toBeNull()
    expect(mockRequireAppAccess).toHaveBeenCalledWith(auth, 'bakerylouise', 'collaborator')
  })

  it('returns the 403 from requireAppAccess', async () => {
    mockFindAppBySlug.mockResolvedValue({ slug: 'byside' })
    mockRequireAppAccess.mockResolvedValue(NextResponse.json({ error: 'Forbidden' }, { status: 403 }))
    const res = await requireFeedbackAccess(auth, 'byside')
    expect(res?.status).toBe(403)
  })

  it('denies a project id that matches no app', async () => {
    mockFindAppBySlug.mockResolvedValue(null)
    const res = await requireFeedbackAccess(auth, 'ghost')
    expect(res?.status).toBe(403)
    expect(mockRequireAppAccess).not.toHaveBeenCalled()
  })
})
