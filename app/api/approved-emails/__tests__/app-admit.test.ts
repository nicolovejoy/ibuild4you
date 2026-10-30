import { describe, it, expect, vi, beforeEach } from 'vitest'
import { GET } from '../route'
import { isApprovedEmail } from '@/lib/api/firebase-server-helpers'
import { hasAnyAppAccess } from '@/lib/api/app-access'
import { _resetAppAdmitCache } from '@/lib/api/app-admit'

const scheduleGarmDenialRecordMock = vi.fn()
vi.mock('@/lib/garm-denials', () => ({
  scheduleGarmDenialRecord: (...args: unknown[]) => scheduleGarmDenialRecordMock(...args),
}))
vi.mock('@/lib/garm-grants', () => ({ scheduleGarmGrantSync: vi.fn() }))
vi.mock('@/lib/api/app-access', () => ({ hasAnyAppAccess: vi.fn(async () => false) }))

const mockUserGet = vi.fn(async () => ({ exists: false, data: () => undefined }))
vi.mock('@/lib/api/firebase-server-helpers', () => ({
  getAuthenticatedUser: vi.fn(async () => ({
    uid: 'sam-uid',
    email: 'sam@example.com',
    displayName: null,
    error: null,
    systemRoles: [],
  })),
  getAdminDb: vi.fn(() => ({
    collection: () => ({ doc: () => ({ get: mockUserGet, set: vi.fn(), update: vi.fn() }) }),
  })),
  hasSystemRole: () => false,
  isApprovedEmail: vi.fn(async () => false),
}))

const call = async () => (await GET(new Request('http://x/api/approved-emails'))).json()

describe('GET /api/approved-emails — app owners and collaborators', () => {
  beforeEach(() => {
    _resetAppAdmitCache()
    scheduleGarmDenialRecordMock.mockClear()
    vi.mocked(hasAnyAppAccess).mockReset().mockResolvedValue(false)
    vi.mocked(isApprovedEmail).mockReset().mockResolvedValue(false)
  })

  it('skips the app check when already approved', async () => {
    vi.mocked(isApprovedEmail).mockResolvedValue(true)
    expect((await call()).approved).toBe(true)
    expect(hasAnyAppAccess).not.toHaveBeenCalled()
  })

  it('admits an app-only person without recording a denial', async () => {
    vi.mocked(hasAnyAppAccess).mockResolvedValue(true)
    expect((await call()).approved).toBe(true)
    expect(scheduleGarmDenialRecordMock).not.toHaveBeenCalled()
  })

  it('denies and records when neither passes', async () => {
    expect((await call()).approved).toBe(false)
    expect(scheduleGarmDenialRecordMock).toHaveBeenCalledWith('sam@example.com')
  })

  it('denies with status 200 when the app check rejects', async () => {
    vi.mocked(hasAnyAppAccess).mockRejectedValue(new Error('garm down'))
    const res = await GET(new Request('http://x/api/approved-emails'))
    expect(res.status).toBe(200)
    expect((await res.json()).approved).toBe(false)
  })

  it('caches a yes for 60 s but not a no', async () => {
    vi.mocked(hasAnyAppAccess).mockResolvedValue(true)
    await call()
    await call()
    expect(hasAnyAppAccess).toHaveBeenCalledTimes(1)

    _resetAppAdmitCache()
    vi.mocked(hasAnyAppAccess).mockReset().mockResolvedValue(false)
    await call()
    await call()
    expect(hasAnyAppAccess).toHaveBeenCalledTimes(2)
  })
})
