import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  requireRole,
  canChat,
  canReview,
  canConfigure,
  canManage,
  getAuthenticatedUser,
  getUserDisplayName,
  hasSystemRole,
  isApprovedEmail,
} from '../firebase-server-helpers'
import { _resetAuthCache } from '../auth-cache'
import { isAdminEmail } from '@/lib/constants'
import type { SystemRole } from '@/lib/types'

// Mock Firebase Admin SDK — we don't want real Firebase calls in unit tests
let mockUserDoc: { exists: boolean; data: () => Record<string, unknown> | undefined } = {
  exists: false,
  data: () => undefined,
}

vi.mock('@/lib/firebase/admin', () => ({
  getAdminAuth: vi.fn(() => ({
    verifyIdToken: vi.fn(),
  })),
  getAdminDb: vi.fn(() => ({
    collection: () => ({
      doc: () => ({
        get: () => Promise.resolve(mockUserDoc),
      }),
    }),
  })),
}))

import { getAdminAuth, getAdminDb } from '@/lib/firebase/admin'

// Helper: set up getAdminAuth mock with a verifyIdToken that resolves to given claims
function mockToken(claims: { uid: string; email: string; name?: string }) {
  const mockVerify = vi.fn().mockResolvedValue(claims)
  vi.mocked(getAdminAuth).mockReturnValue({ verifyIdToken: mockVerify } as never)
  return mockVerify
}

function authedRequest() {
  return new Request('http://localhost/api/test', {
    headers: { Authorization: 'Bearer valid-token' },
  })
}

describe('isAdminEmail', () => {
  it('returns true for known admin emails', () => {
    expect(isAdminEmail('nicholas.lovejoy@gmail.com')).toBe(true)
    expect(isAdminEmail('mlovejoy@scu.edu')).toBe(true)
  })

  it('returns false for non-admin emails', () => {
    expect(isAdminEmail('random@example.com')).toBe(false)
  })

  it('returns false for null', () => {
    expect(isAdminEmail(null)).toBe(false)
  })
})

describe('isApprovedEmail', () => {
  // Regression coverage for #152: the approved_emails doc lookup used to do a
  // bare `.toLowerCase()` with no trim, so " Sam@Example.com " (whitespace
  // from a copy-paste) would look up a doc that could never match a
  // normally-approved "sam@example.com" row — silently locking someone out.
  it('normalizes trim+case before the approved_emails doc lookup', async () => {
    const docSpy = vi.fn((id: string) => ({
      get: async () => ({ exists: id === 'sam@example.com' }),
    }))
    vi.mocked(getAdminDb).mockReturnValueOnce({
      collection: () => ({ doc: docSpy }),
    } as unknown as FirebaseFirestore.Firestore)

    const approved = await isApprovedEmail('  Sam@Example.com  ')

    expect(docSpy).toHaveBeenCalledWith('sam@example.com')
    expect(approved).toBe(true)
  })

  it('is not approved when the doc genuinely does not exist', async () => {
    vi.mocked(getAdminDb).mockReturnValueOnce({
      collection: () => ({ doc: () => ({ get: async () => ({ exists: false }) }) }),
    } as unknown as FirebaseFirestore.Firestore)

    expect(await isApprovedEmail('nobody@example.com')).toBe(false)
  })
})

describe('hasSystemRole', () => {
  const baseAuth = {
    uid: '1',
    email: 'a@b.com',
    displayName: null,
    userData: null,
    roleCache: new Map<string, never>(),
    cacheStatus: 'miss' as const,
    error: null,
  }

  it('returns true when role is in array', () => {
    expect(hasSystemRole({ ...baseAuth, systemRoles: ['admin' as const] }, 'admin')).toBe(true)
  })

  it('returns false when role is not in array', () => {
    expect(hasSystemRole({ ...baseAuth, systemRoles: [] as SystemRole[] }, 'admin')).toBe(false)
  })

  it('supports multiple roles', () => {
    const auth = { ...baseAuth, systemRoles: ['admin' as const, 'support' as const] }
    expect(hasSystemRole(auth, 'admin')).toBe(true)
    expect(hasSystemRole(auth, 'support')).toBe(true)
  })
})

describe('requireRole', () => {
  it('returns null when role meets minimum', () => {
    expect(requireRole('owner', 'maker')).toBeNull()
    expect(requireRole('builder', 'builder')).toBeNull()
    expect(requireRole('maker', 'maker')).toBeNull()
  })

  it('returns 403 when role is below minimum', () => {
    const response = requireRole('maker', 'builder')
    expect(response).not.toBeNull()
    expect(response!.status).toBe(403)
  })

  it('returns 403 for null role', () => {
    const response = requireRole(null, 'maker')
    expect(response).not.toBeNull()
    expect(response!.status).toBe(403)
  })
})

describe('permission helpers', () => {
  it('canChat allows maker+', () => {
    expect(canChat('maker')).toBe(true)
    expect(canChat('apprentice')).toBe(true)
    expect(canChat('builder')).toBe(true)
    expect(canChat('owner')).toBe(true)
    expect(canChat(null)).toBe(false)
  })

  it('canReview allows apprentice+', () => {
    expect(canReview('maker')).toBe(false)
    expect(canReview('apprentice')).toBe(true)
    expect(canReview('builder')).toBe(true)
    expect(canReview('owner')).toBe(true)
    expect(canReview(null)).toBe(false)
  })

  it('canConfigure allows builder+', () => {
    expect(canConfigure('maker')).toBe(false)
    expect(canConfigure('apprentice')).toBe(false)
    expect(canConfigure('builder')).toBe(true)
    expect(canConfigure('owner')).toBe(true)
    expect(canConfigure(null)).toBe(false)
  })

  it('canManage allows owner only', () => {
    expect(canManage('maker')).toBe(false)
    expect(canManage('apprentice')).toBe(false)
    expect(canManage('builder')).toBe(false)
    expect(canManage('owner')).toBe(true)
    expect(canManage(null)).toBe(false)
  })
})

describe('getUserDisplayName', () => {
  // Fake db whose .doc('') throws, mirroring the real Firestore Admin SDK:
  // doc() rejects an empty/whitespace path with "documentPath must be a
  // non-empty string". A member who hasn't signed in yet has no user_id.
  function fakeDb(users: Record<string, { first_name?: string; last_name?: string }>) {
    return {
      collection: () => ({
        doc: (id: string) => {
          if (!id) {
            throw new Error(
              'Value for argument "documentPath" is not a valid resource path. Path must be a non-empty string.'
            )
          }
          const data = users[id]
          return {
            get: async () => ({ exists: !!data, data: () => data }),
          }
        },
      }),
    } as unknown as FirebaseFirestore.Firestore
  }

  it('returns the email prefix without touching Firestore when uid is empty', async () => {
    // Regression: an unsigned-in member (no user_id) used to throw on doc('')
    // and 500 the whole /members route.
    const name = await getUserDisplayName(fakeDb({}), '', 'matt@example.com')
    expect(name).toBe('matt')
  })

  it('returns "First L" when the users doc has first and last name', async () => {
    const db = fakeDb({ 'uid-1': { first_name: 'Sam', last_name: 'Lee' } })
    expect(await getUserDisplayName(db, 'uid-1', 'sam@example.com')).toBe('Sam L')
  })

  it('falls back to email prefix when the users doc is missing', async () => {
    const db = fakeDb({})
    expect(await getUserDisplayName(db, 'uid-missing', 'jo@example.com')).toBe('jo')
  })
})

describe('getAuthenticatedUser', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    _resetAuthCache()
    mockUserDoc = { exists: false, data: () => undefined }
  })

  it('returns 401 when no Authorization header is present', async () => {
    const request = new Request('http://localhost/api/test')
    const result = await getAuthenticatedUser(request)
    expect(result.error).not.toBeNull()
    expect(result.error!.status).toBe(401)
    expect(result.uid).toBeNull()
  })

  it('returns 401 when Authorization header has no Bearer prefix', async () => {
    const request = new Request('http://localhost/api/test', {
      headers: { Authorization: 'Basic abc123' },
    })
    const result = await getAuthenticatedUser(request)
    expect(result.error).not.toBeNull()
    expect(result.error!.status).toBe(401)
  })

  it('returns 401 for an invalid token', async () => {
    const mockVerify = vi.fn().mockRejectedValue(new Error('Invalid token'))
    vi.mocked(getAdminAuth).mockReturnValue({ verifyIdToken: mockVerify } as never)

    const request = new Request('http://localhost/api/test', {
      headers: { Authorization: 'Bearer bad-token' },
    })
    const result = await getAuthenticatedUser(request)
    expect(result.error).not.toBeNull()
    expect(result.error!.status).toBe(401)
    expect(result.uid).toBeNull()
  })

  it('returns uid, email, and empty systemRoles for a regular user', async () => {
    const mockVerify = mockToken({ uid: 'user-123', email: 'test@example.com' })
    const result = await getAuthenticatedUser(authedRequest())

    expect(result.error).toBeNull()
    expect(result.uid).toBe('user-123')
    expect(result.email).toBe('test@example.com')
    if (!result.error) {
      expect(result.systemRoles).toEqual([])
    }
    expect(mockVerify).toHaveBeenCalledWith('valid-token')
  })

  it('reads system_roles from the users doc when present', async () => {
    mockToken({ uid: 'user-456', email: 'someone@example.com' })
    mockUserDoc = {
      exists: true,
      data: () => ({ email: 'someone@example.com', system_roles: ['admin', 'support'] }),
    }

    const result = await getAuthenticatedUser(authedRequest())
    expect(result.error).toBeNull()
    if (!result.error) {
      expect(result.systemRoles).toEqual(['admin', 'support'])
    }
  })

  it('falls back to ADMIN_EMAILS when users doc has no system_roles', async () => {
    mockToken({ uid: 'admin-uid', email: 'nicholas.lovejoy@gmail.com' })
    // Doc exists but without system_roles field
    mockUserDoc = {
      exists: true,
      data: () => ({ email: 'nicholas.lovejoy@gmail.com' }),
    }

    const result = await getAuthenticatedUser(authedRequest())
    expect(result.error).toBeNull()
    if (!result.error) {
      expect(result.systemRoles).toEqual(['admin'])
    }
  })

  it('falls back to ADMIN_EMAILS when users doc does not exist', async () => {
    mockToken({ uid: 'admin-uid', email: 'mlovejoy@scu.edu' })
    // No users doc at all

    const result = await getAuthenticatedUser(authedRequest())
    expect(result.error).toBeNull()
    if (!result.error) {
      expect(result.systemRoles).toEqual(['admin'])
    }
  })

  it('returns empty systemRoles for non-admin with no users doc', async () => {
    mockToken({ uid: 'user-789', email: 'nobody@example.com' })

    const result = await getAuthenticatedUser(authedRequest())
    expect(result.error).toBeNull()
    if (!result.error) {
      expect(result.systemRoles).toEqual([])
    }
  })

  it('ignores system_roles from doc once backfilled, not ADMIN_EMAILS', async () => {
    // User is in ADMIN_EMAILS but doc has system_roles set — doc wins
    mockToken({ uid: 'admin-uid', email: 'nicholas.lovejoy@gmail.com' })
    mockUserDoc = {
      exists: true,
      data: () => ({ email: 'nicholas.lovejoy@gmail.com', system_roles: ['support'] }),
    }

    const result = await getAuthenticatedUser(authedRequest())
    expect(result.error).toBeNull()
    if (!result.error) {
      // Doc has ['support'], not ['admin'] — doc takes precedence
      expect(result.systemRoles).toEqual(['support'])
    }
  })
})
