import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextResponse } from 'next/server'

// =============================================================================
// BRIEF GENERATE ROUTE TESTS
//
// POST /api/briefs/generate
//   Auth → require project_id → require builder role → regenerate brief.
//   This is the highest-risk mutation route (it was the vector for the May 21
//   cost incident: a JSON.parse loop on truncated output). The circuit-breaker
//   counters live in cron/notify; this route clears them on a successful regen.
//
// We mock regenerateBriefForProject so the tests exercise the route's control
// flow (auth, validation, role gate, error mapping) without calling Anthropic.
// =============================================================================

const mockRegenerate = vi.fn()
const mockGetProjectRole = vi.fn()
const mockUpdate = vi.fn(async () => {})

const mockCollection = vi.fn(() => ({
  doc: vi.fn(() => ({ update: mockUpdate })),
}))

let authResult: Record<string, unknown>

vi.mock('@/lib/api/firebase-server-helpers', () => ({
  getAuthenticatedUser: vi.fn(async () => authResult),
  getAdminDb: vi.fn(() => ({ collection: mockCollection })),
  getProjectRole: (...args: unknown[]) => mockGetProjectRole(...args),
  requireRole: (role: string | null, minimum: string) => {
    const levels: Record<string, number> = { maker: 0, apprentice: 1, builder: 2, owner: 3 }
    if (!role || levels[role] < levels[minimum]) {
      return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
    }
    return null
  },
}))

vi.mock('@/lib/api/briefs', () => ({
  regenerateBriefForProject: (...args: unknown[]) => mockRegenerate(...args),
}))

import { POST } from '../route'

function makeReq(body: unknown) {
  return new Request('http://localhost/api/briefs/generate', {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

describe('POST /api/briefs/generate', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    authResult = { uid: 'u1', email: 'b@ibuild4you.com', systemRoles: [], error: null }
    mockGetProjectRole.mockResolvedValue('builder')
    mockRegenerate.mockResolvedValue({ brief: { problem: 'x' }, version: 2 })
  })

  it('returns the auth error when unauthenticated', async () => {
    authResult = { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
    const res = await POST(makeReq({ project_id: 'p1' }))
    expect(res.status).toBe(401)
    expect(mockRegenerate).not.toHaveBeenCalled()
  })

  it('returns 400 when project_id is missing', async () => {
    const res = await POST(makeReq({}))
    expect(res.status).toBe(400)
  })

  it('returns 403 when the caller is below builder role', async () => {
    mockGetProjectRole.mockResolvedValue('maker')
    const res = await POST(makeReq({ project_id: 'p1' }))
    expect(res.status).toBe(403)
    expect(mockRegenerate).not.toHaveBeenCalled()
  })

  it('regenerates and clears the failure counters on success', async () => {
    const res = await POST(makeReq({ project_id: 'p1' }))
    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toMatchObject({ version: 2 })
    expect(mockRegenerate).toHaveBeenCalledWith(expect.anything(), 'p1')
    // circuit-breaker reset
    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ brief_regen_failures: 0 })
    )
  })

  it('maps the no-messages error to 400', async () => {
    mockRegenerate.mockRejectedValue(new Error('regenerate_brief_no_messages'))
    const res = await POST(makeReq({ project_id: 'p1' }))
    expect(res.status).toBe(400)
    // failure counters NOT cleared on error
    expect(mockUpdate).not.toHaveBeenCalled()
  })

  it('maps an unexpected error to 500', async () => {
    mockRegenerate.mockRejectedValue(new Error('anthropic exploded'))
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const res = await POST(makeReq({ project_id: 'p1' }))
    expect(res.status).toBe(500)
    errSpy.mockRestore()
  })
})
