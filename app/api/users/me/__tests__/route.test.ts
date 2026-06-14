import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextResponse } from 'next/server'

// =============================================================================
// USERS/ME ROUTE TESTS
//
// GET    /api/users/me — returns the caller's identity (no extra DB read).
// PATCH  /api/users/me — updates the caller's name, upserting the users doc and
//        syncing requester_first/last_name onto any projects they originated.
// =============================================================================

const mockInvalidateUser = vi.fn()
const mockUserGet = vi.fn()
const mockUserUpdate = vi.fn(async () => {})
const mockUserSet = vi.fn(async () => {})
const mockBatchUpdate = vi.fn()
const mockBatchCommit = vi.fn(async () => {})
let requesterProjects: { ref: object }[]

let authResult: Record<string, unknown>

const mockCollection = vi.fn((name: string) => {
  if (name === 'users') {
    return {
      doc: vi.fn(() => ({ get: mockUserGet, update: mockUserUpdate, set: mockUserSet })),
    }
  }
  // projects
  return {
    where: vi.fn(() => ({
      get: async () => ({ empty: requesterProjects.length === 0, docs: requesterProjects }),
    })),
  }
})

vi.mock('@/lib/api/firebase-server-helpers', () => ({
  getAuthenticatedUser: vi.fn(async () => authResult),
  getAdminDb: vi.fn(() => ({
    collection: mockCollection,
    batch: () => ({ update: mockBatchUpdate, commit: mockBatchCommit }),
  })),
}))

vi.mock('@/lib/api/auth-cache', () => ({
  invalidateUser: (...args: unknown[]) => mockInvalidateUser(...args),
}))

import { GET, PATCH } from '../route'

function patchReq(body: unknown) {
  return new Request('http://localhost/api/users/me', {
    method: 'PATCH',
    body: JSON.stringify(body),
  })
}

describe('GET /api/users/me', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    authResult = {
      uid: 'u1',
      email: 'u@ibuild4you.com',
      systemRoles: ['admin'],
      userData: { first_name: 'Sam', last_name: 'Lee' },
      cacheStatus: 'HIT',
      error: null,
    }
  })

  it('returns the auth error when unauthenticated', async () => {
    authResult = { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
    const res = await GET(new Request('http://localhost/api/users/me'))
    expect(res.status).toBe(401)
  })

  it('returns the identity from the auth result without a second DB read', async () => {
    const res = await GET(new Request('http://localhost/api/users/me'))
    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({
      uid: 'u1',
      email: 'u@ibuild4you.com',
      system_roles: ['admin'],
      first_name: 'Sam',
      last_name: 'Lee',
      account_label: null,
    })
    expect(mockUserGet).not.toHaveBeenCalled()
  })

  it('returns the account_label when set', async () => {
    authResult = {
      ...authResult,
      userData: { first_name: 'Sam', last_name: 'Lee', account_label: 'test account' },
    }
    const res = await GET(new Request('http://localhost/api/users/me'))
    await expect(res.json()).resolves.toMatchObject({ account_label: 'test account' })
  })
})

describe('PATCH /api/users/me', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    authResult = {
      uid: 'u1',
      email: 'u@ibuild4you.com',
      systemRoles: [],
      userData: {},
      error: null,
    }
    mockUserGet.mockResolvedValue({ exists: true })
    requesterProjects = []
  })

  it('returns 400 when no updatable field is provided', async () => {
    const res = await PATCH(patchReq({ last_name: 'Lee' }))
    expect(res.status).toBe(400)
    expect(mockUserUpdate).not.toHaveBeenCalled()
  })

  it('returns 400 when account_label is not a string', async () => {
    const res = await PATCH(patchReq({ account_label: 123 }))
    expect(res.status).toBe(400)
    expect(mockUserUpdate).not.toHaveBeenCalled()
  })

  it('updates account_label alone without requiring a name or syncing projects', async () => {
    requesterProjects = [{ ref: { id: 'p1' } }]
    const res = await PATCH(patchReq({ account_label: '  test account  ' }))
    expect(res.status).toBe(200)
    expect(mockUserUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ account_label: 'test account' })
    )
    // name-only fields untouched; no requester-name sync for a label-only edit
    expect(mockUserUpdate).toHaveBeenCalledWith(
      expect.not.objectContaining({ first_name: expect.anything() })
    )
    expect(mockBatchCommit).not.toHaveBeenCalled()
    expect(mockInvalidateUser).toHaveBeenCalledWith('u1')
  })

  it('clears account_label when passed an empty string', async () => {
    const res = await PATCH(patchReq({ account_label: '' }))
    expect(res.status).toBe(200)
    expect(mockUserUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ account_label: '' })
    )
  })

  it('updates an existing users doc and busts the auth cache', async () => {
    const res = await PATCH(patchReq({ first_name: '  Sam  ', last_name: ' Lee ' }))
    expect(res.status).toBe(200)
    expect(mockUserUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ first_name: 'Sam', last_name: 'Lee' })
    )
    expect(mockUserSet).not.toHaveBeenCalled()
    expect(mockInvalidateUser).toHaveBeenCalledWith('u1')
  })

  it('creates the users doc when it does not exist yet', async () => {
    mockUserGet.mockResolvedValue({ exists: false })
    const res = await PATCH(patchReq({ first_name: 'Sam' }))
    expect(res.status).toBe(200)
    expect(mockUserSet).toHaveBeenCalledWith(
      expect.objectContaining({ email: 'u@ibuild4you.com', first_name: 'Sam' })
    )
    expect(mockUserUpdate).not.toHaveBeenCalled()
  })

  it('syncs the name onto projects the user originated', async () => {
    requesterProjects = [{ ref: { id: 'p1' } }, { ref: { id: 'p2' } }]
    const res = await PATCH(patchReq({ first_name: 'Sam', last_name: 'Lee' }))
    expect(res.status).toBe(200)
    expect(mockBatchUpdate).toHaveBeenCalledTimes(2)
    expect(mockBatchCommit).toHaveBeenCalledOnce()
  })
})
