import { describe, it, expect, vi, beforeEach } from 'vitest'
import { DELETE, POST } from '../route'

// =============================================================================
// #163 off-boarding: admin-only revoke on the sign-in allowlist.
//
// DELETE /api/approved-emails sets revoked_at/revoked_by (non-destructive,
// house convention — no hard deletes) and fires scheduleGarmGrantSync so the
// dual-write emits a clean Garm revoke. POST (re-approve) must clear a prior
// revoke flag so re-adding someone actually restores sign-in.
// =============================================================================

const scheduleGarmGrantSyncMock = vi.fn()
vi.mock('@/lib/garm-grants', () => ({
  scheduleGarmGrantSync: (...args: unknown[]) => scheduleGarmGrantSyncMock(...args),
}))

let mockDocData: Record<string, unknown> | undefined
let mockDocExists = false
const mockGet = vi.fn(async () => ({ exists: mockDocExists, data: () => mockDocData }))
const mockUpdate = vi.fn(async (patch: Record<string, unknown>) => patch)
const mockSet = vi.fn(async (payload: Record<string, unknown>) => payload)
const mockDoc = vi.fn(() => ({ get: mockGet, update: mockUpdate, set: mockSet }))
const mockCollection = vi.fn(() => ({ doc: mockDoc }))

let authSystemRoles: string[] = ['admin']

vi.mock('@/lib/api/firebase-server-helpers', () => ({
  getAuthenticatedUser: vi.fn(async () => ({
    uid: 'admin-uid',
    email: 'admin@example.com',
    error: null,
    systemRoles: authSystemRoles,
  })),
  getAdminDb: vi.fn(() => ({ collection: mockCollection })),
  hasSystemRole: (auth: { systemRoles: string[] }, role: string) => auth.systemRoles.includes(role),
  isApprovedEmail: vi.fn(async () => true),
}))

function makeDeleteReq(body: Record<string, unknown>) {
  return new Request('http://localhost/api/approved-emails', {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

function makePostReq(body: Record<string, unknown>) {
  return new Request('http://localhost/api/approved-emails', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

describe('DELETE /api/approved-emails', () => {
  beforeEach(() => {
    scheduleGarmGrantSyncMock.mockClear()
    mockGet.mockClear()
    mockUpdate.mockClear()
    mockSet.mockClear()
    mockDoc.mockClear()
    mockCollection.mockClear()
    authSystemRoles = ['admin']
    mockDocExists = false
    mockDocData = undefined
  })

  it('is admin-only (403 for a non-admin caller)', async () => {
    authSystemRoles = []
    mockDocExists = true
    mockDocData = {}

    const res = await DELETE(makeDeleteReq({ email: 'sam@example.com' }))

    expect(res.status).toBe(403)
    expect(mockUpdate).not.toHaveBeenCalled()
    expect(scheduleGarmGrantSyncMock).not.toHaveBeenCalled()
  })

  it('requires an email', async () => {
    const res = await DELETE(makeDeleteReq({}))
    expect(res.status).toBe(400)
  })

  it('404s when there is no approved_emails record for the address', async () => {
    mockDocExists = false

    const res = await DELETE(makeDeleteReq({ email: 'ghost@example.com' }))

    expect(res.status).toBe(404)
    expect(mockUpdate).not.toHaveBeenCalled()
  })

  it('revokes an active approved email and schedules a Garm sync', async () => {
    mockDocExists = true
    mockDocData = { email: 'sam@example.com' }

    const res = await DELETE(makeDeleteReq({ email: 'Sam@Example.com' }))
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json).toEqual({ email: 'sam@example.com', revoked: true })
    expect(mockDoc).toHaveBeenCalledWith('sam@example.com')
    expect(mockUpdate).toHaveBeenCalledTimes(1)
    const patch = mockUpdate.mock.calls[0][0]
    expect(patch.revoked_by).toBe('admin@example.com')
    expect(typeof patch.revoked_at).toBe('string')
    expect(scheduleGarmGrantSyncMock).toHaveBeenCalledWith('sam@example.com')
  })

  it('400s on a re-revoke of an already-revoked email (idempotent-friendly, not a silent no-op)', async () => {
    mockDocExists = true
    mockDocData = { revoked_at: '2026-07-17T00:00:00.000Z', revoked_by: 'admin@example.com' }

    const res = await DELETE(makeDeleteReq({ email: 'sam@example.com' }))

    expect(res.status).toBe(400)
    expect(mockUpdate).not.toHaveBeenCalled()
    expect(scheduleGarmGrantSyncMock).not.toHaveBeenCalled()
  })
})

describe('POST /api/approved-emails re-add clears a prior revoke', () => {
  beforeEach(() => {
    scheduleGarmGrantSyncMock.mockClear()
    mockSet.mockClear()
    mockDoc.mockClear()
    authSystemRoles = ['admin']
  })

  it('writes revoked_at/revoked_by as null on (re-)approve', async () => {
    const res = await POST(makePostReq({ email: 'sam@example.com' }))

    expect(res.status).toBe(201)
    expect(mockSet).toHaveBeenCalledTimes(1)
    const payload = mockSet.mock.calls[0][0]
    expect(payload.revoked_at).toBeNull()
    expect(payload.revoked_by).toBeNull()
    expect(scheduleGarmGrantSyncMock).toHaveBeenCalledWith('sam@example.com')
  })
})
