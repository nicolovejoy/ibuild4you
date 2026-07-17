import { describe, it, expect, vi, beforeEach } from 'vitest'
import { POST } from '../route'

// =============================================================================
// Garm dual-write wiring check (follow-up to PR #158).
//
// POST /api/approved-emails (admin-only allowlist add) syncs the newly-
// approved email. Verified so far only by inspection.
// =============================================================================

const scheduleGarmGrantSyncMock = vi.fn()
vi.mock('@/lib/garm-grants', () => ({
  scheduleGarmGrantSync: (...args: unknown[]) => scheduleGarmGrantSyncMock(...args),
}))

const mockSet = vi.fn(async () => {})
const mockCollection = vi.fn(() => ({ doc: vi.fn(() => ({ set: mockSet })) }))

vi.mock('@/lib/api/firebase-server-helpers', () => ({
  getAuthenticatedUser: vi.fn(async () => ({
    uid: 'admin-uid',
    email: 'admin@example.com',
    error: null,
    systemRoles: ['admin'],
  })),
  getAdminDb: vi.fn(() => ({ collection: mockCollection })),
  hasSystemRole: () => true,
  isApprovedEmail: vi.fn(async () => true),
}))

function makeReq(body: Record<string, unknown>) {
  return new Request('http://localhost/api/approved-emails', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

describe('POST /api/approved-emails → scheduleGarmGrantSync', () => {
  beforeEach(() => {
    scheduleGarmGrantSyncMock.mockClear()
  })

  it('syncs the newly-approved (normalized) email', async () => {
    const res = await POST(makeReq({ email: 'New@Example.com' }))
    expect(res.status).toBe(201)
    expect(scheduleGarmGrantSyncMock).toHaveBeenCalledWith('new@example.com')
    expect(scheduleGarmGrantSyncMock).toHaveBeenCalledTimes(1)
  })
})
