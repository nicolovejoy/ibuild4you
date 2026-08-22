import { describe, it, expect, vi, beforeEach } from 'vitest'
import { GET } from '../route'
import { isApprovedEmail } from '@/lib/api/firebase-server-helpers'

// =============================================================================
// Denial detector wiring check (lib/garm-denials.ts).
//
// GET /api/approved-emails is the only place a sign-in denial surfaces to the
// requester. A "no" here must schedule the recorder with the presented email;
// a "yes" must not touch it. Neither changes the existing response contract.
// =============================================================================

const scheduleGarmDenialRecordMock = vi.fn()
vi.mock('@/lib/garm-denials', () => ({
  scheduleGarmDenialRecord: (...args: unknown[]) => scheduleGarmDenialRecordMock(...args),
}))
vi.mock('@/lib/garm-grants', () => ({ scheduleGarmGrantSync: vi.fn() }))

const mockUserGet = vi.fn(async () => ({ exists: false, data: () => undefined }))
const mockUserSet = vi.fn(async () => {})
const mockUserUpdate = vi.fn(async () => {})
const mockCollection = vi.fn(() => ({
  doc: vi.fn(() => ({ get: mockUserGet, set: mockUserSet, update: mockUserUpdate })),
}))

vi.mock('@/lib/api/firebase-server-helpers', () => ({
  getAuthenticatedUser: vi.fn(async () => ({
    uid: 'sam-uid',
    email: 'sam@example.com',
    displayName: null,
    error: null,
    systemRoles: [],
  })),
  getAdminDb: vi.fn(() => ({ collection: mockCollection })),
  hasSystemRole: () => false,
  isApprovedEmail: vi.fn(async () => true),
}))

describe('GET /api/approved-emails — denial recorder', () => {
  beforeEach(() => {
    scheduleGarmDenialRecordMock.mockClear()
  })

  it('schedules the recorder with the presented email when not approved', async () => {
    vi.mocked(isApprovedEmail).mockResolvedValueOnce(false)
    const res = await GET(new Request('http://x/api/approved-emails'))
    expect(res.status).toBe(200) // existing contract: body says approved:false
    expect(scheduleGarmDenialRecordMock).toHaveBeenCalledWith('sam@example.com')
  })

  it('does not schedule the recorder when approved', async () => {
    vi.mocked(isApprovedEmail).mockResolvedValueOnce(true)
    await GET(new Request('http://x/api/approved-emails'))
    expect(scheduleGarmDenialRecordMock).not.toHaveBeenCalled()
  })
})
