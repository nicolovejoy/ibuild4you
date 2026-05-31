import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextResponse } from 'next/server'

// =============================================================================
// PROJECT ROLE ROUTE TESTS
//
// GET /api/projects/role?project_id=xxx
//   Returns the caller's role on a project (or null). Thin wrapper over
//   getProjectRole; the test pins auth + the project_id requirement.
// =============================================================================

const mockGetProjectRole = vi.fn()
let authResult: Record<string, unknown>

vi.mock('@/lib/api/firebase-server-helpers', () => ({
  getAuthenticatedUser: vi.fn(async () => authResult),
  getAdminDb: vi.fn(() => ({})),
  getProjectRole: (...args: unknown[]) => mockGetProjectRole(...args),
}))

import { GET } from '../route'

describe('GET /api/projects/role', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    authResult = { uid: 'u1', email: 'u@ibuild4you.com', systemRoles: [], error: null }
    mockGetProjectRole.mockResolvedValue('builder')
  })

  it('returns the auth error when unauthenticated', async () => {
    authResult = { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
    const res = await GET(new Request('http://localhost/api/projects/role?project_id=p1'))
    expect(res.status).toBe(401)
  })

  it('returns 400 when project_id is missing', async () => {
    const res = await GET(new Request('http://localhost/api/projects/role'))
    expect(res.status).toBe(400)
  })

  it('returns the resolved role', async () => {
    const res = await GET(new Request('http://localhost/api/projects/role?project_id=p1'))
    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({ role: 'builder' })
  })

  it('returns null role for a non-member', async () => {
    mockGetProjectRole.mockResolvedValue(null)
    const res = await GET(new Request('http://localhost/api/projects/role?project_id=p1'))
    await expect(res.json()).resolves.toEqual({ role: null })
  })
})
