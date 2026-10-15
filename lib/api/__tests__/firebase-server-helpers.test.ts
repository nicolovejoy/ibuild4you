import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  requireRole,
  canChat,
  canReview,
  canConfigure,
  canManage,
  getAuthenticatedUser,
  getProjectRole,
  getViewerBriefRole,
  getUserDisplayName,
  hasSystemRole,
  isApprovedEmail,
} from '../firebase-server-helpers'
import { _resetAuthCache } from '../auth-cache'
import { isAdminEmail, ADMIN_EMAILS } from '@/lib/constants'
import { normalizeEmail } from '@/lib/email/normalize'
import type { SystemRole } from '@/lib/types'

// isApprovedEmail gates sign-in on garmCheck — mock it so these tests never
// make a network call.
vi.mock('@/lib/garm', () => ({
  garmCheck: vi.fn(),
  GARM_PROJECT: 'ibuild4you',
  // Identity by default — aliasing tests override per-case. Implementation set
  // at creation so vi.clearAllMocks() (which keeps implementations) can't
  // strand getAuthenticatedUser on an undefined resolver.
  resolveCanonicalEmail: vi.fn(async (email: string) => email),
}))
import { garmCheck, resolveCanonicalEmail } from '@/lib/garm'

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

  // #155: the app's only admin gate did zero normalization, relying entirely
  // on token emails always arriving lowercase+trimmed — an unenforced upstream
  // invariant. Mixed case / whitespace must still match.
  it('returns true for a mixed-case, whitespace-padded admin email', () => {
    expect(isAdminEmail(' NLovejoy@Me.com ')).toBe(true)
  })

  // Invariant guard: every ADMIN_EMAILS entry must already be normalized.
  // A mixed-case entry here would be permanently unmatchable once callers'
  // input is normalized before the .includes() check.
  it('every ADMIN_EMAILS entry is already normalized', () => {
    expect(ADMIN_EMAILS.every((e) => e === normalizeEmail(e))).toBe(true)
  })
})

// Garm is the sign-in gate everywhere except one environment: a Vercel
// *preview* deployment with no Garm wiring (no GARM_URL/GARM_KEY), which falls
// back to the local approved_emails allowlist so the preview e2e fleet can
// sign in. Production can never take the fallback, whatever its env says.
// Replaces the GARM_GATING kill switch (PR H).
describe('isApprovedEmail — preview fallback (VERCEL_ENV=preview, no Garm wiring)', () => {
  const OLD_ENV = { ...process.env }

  beforeEach(() => {
    vi.mocked(garmCheck).mockReset()
    process.env.VERCEL_ENV = 'preview'
    delete process.env.GARM_URL
    delete process.env.GARM_KEY
  })

  afterEach(() => {
    process.env = { ...OLD_ENV }
  })

  // Regression coverage for #152: the approved_emails doc lookup used to do a
  // bare `.toLowerCase()` with no trim, so " Sam@Example.com " (whitespace
  // from a copy-paste) would look up a doc that could never match a
  // normally-approved "sam@example.com" row — silently locking someone out.
  it('normalizes trim+case before the approved_emails doc lookup', async () => {
    const docSpy = vi.fn((id: string) => ({
      get: async () => ({ exists: id === 'sam@example.com', data: () => ({}) }),
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

  // #163: off-boarding — a revoked row still exists (non-destructive flag)
  // but must not grant sign-in.
  it('is not approved when the doc exists but is revoked', async () => {
    vi.mocked(getAdminDb).mockReturnValueOnce({
      collection: () => ({
        doc: () => ({
          get: async () => ({ exists: true, data: () => ({ revoked_at: '2026-07-18T00:00:00.000Z' }) }),
        }),
      }),
    } as unknown as FirebaseFirestore.Firestore)

    expect(await isApprovedEmail('sam@example.com')).toBe(false)
  })

  it('is approved when the doc exists and revoked_at is absent', async () => {
    vi.mocked(getAdminDb).mockReturnValueOnce({
      collection: () => ({
        doc: () => ({
          get: async () => ({ exists: true, data: () => ({}) }),
        }),
      }),
    } as unknown as FirebaseFirestore.Firestore)

    expect(await isApprovedEmail('sam@example.com')).toBe(true)
  })

  it('never calls Garm on the fallback path', async () => {
    vi.mocked(getAdminDb).mockReturnValueOnce({
      collection: () => ({ doc: () => ({ get: async () => ({ exists: true, data: () => ({}) }) }) }),
    } as unknown as FirebaseFirestore.Firestore)

    await isApprovedEmail('sam@example.com')
    expect(garmCheck).not.toHaveBeenCalled()
  })
})

// PR G cutover (docs/garm-consumer-plan.md Phase 5): Garm IS the sign-in gate.
// Fail mode is closed per the ratified Q2 decision — there is no local-fallback
// branch outside preview, deliberately. garmCheck is mocked; its own
// fail-closed internals (timeout, non-200, missing env → allowed:false) are
// pinned in lib/__tests__/garm.test.ts.
describe('isApprovedEmail — Garm authoritative', () => {
  const OLD_ENV = { ...process.env }

  function mockLocalApprovedOnce(exists: boolean) {
    vi.mocked(getAdminDb).mockReturnValueOnce({
      collection: () => ({ doc: () => ({ get: async () => ({ exists, data: () => ({}) }) }) }),
    } as unknown as FirebaseFirestore.Firestore)
  }

  beforeEach(() => {
    // mockReset (not mockClear): some tests queue Once values the code path
    // never consumes (admin short-circuit) — a leftover Once would offset later
    // answers by one. vitest 3 mockReset restores the vi.fn factory
    // implementation, so getAdminDb's default stays intact for later describes.
    vi.mocked(garmCheck).mockReset()
    vi.mocked(getAdminDb).mockReset()
    process.env.VERCEL_ENV = 'production'
    process.env.GARM_URL = 'https://garm.example'
    process.env.GARM_KEY = 'garm_test'
  })

  afterEach(() => {
    process.env = { ...OLD_ENV }
  })

  it('asks Garm for viewer on the app project and approves on allowed:true', async () => {
    vi.mocked(garmCheck).mockResolvedValueOnce({ allowed: true, role: 'viewer' })
    expect(await isApprovedEmail('sam@example.com')).toBe(true)
    expect(garmCheck).toHaveBeenCalledWith('sam@example.com', 'ibuild4you', 'viewer')
  })

  it('denies on allowed:false even when a local approved_emails row exists', async () => {
    mockLocalApprovedOnce(true) // would approve locally — must not matter
    vi.mocked(garmCheck).mockResolvedValueOnce({ allowed: false, role: null })
    expect(await isApprovedEmail('sam@example.com')).toBe(false)
  })

  it('denies when Garm fails closed (unreachable/misconfigured → allowed:false)', async () => {
    // garmCheck never rejects — errors surface as its fail-closed result.
    vi.mocked(garmCheck).mockResolvedValueOnce({ allowed: false, role: null })
    expect(await isApprovedEmail('sam@example.com')).toBe(false)
  })

  it('admin break-glass approves without consulting Garm (systemRoles)', async () => {
    expect(await isApprovedEmail('sam@example.com', ['admin'])).toBe(true)
    expect(garmCheck).not.toHaveBeenCalled()
  })

  it('admin break-glass approves without consulting Garm (ADMIN_EMAILS)', async () => {
    expect(await isApprovedEmail('nicholas.lovejoy@gmail.com')).toBe(true)
    expect(garmCheck).not.toHaveBeenCalled()
  })

  it('never reads the local allowlist', async () => {
    vi.mocked(garmCheck).mockResolvedValueOnce({ allowed: true, role: 'viewer' })
    const dbSpy = vi.mocked(getAdminDb)
    dbSpy.mockClear()
    expect(await isApprovedEmail('sam@example.com')).toBe(true)
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(dbSpy).not.toHaveBeenCalled()
  })

  // The fallback is keyed on the deployment being a preview, not on Garm being
  // absent: a production deploy that lost its Garm env must fail closed, not
  // quietly reopen the old allowlist.
  it('production with no Garm wiring still gates on Garm (fails closed)', async () => {
    delete process.env.GARM_URL
    delete process.env.GARM_KEY
    mockLocalApprovedOnce(true)
    vi.mocked(garmCheck).mockResolvedValueOnce({ allowed: false, role: null })
    expect(await isApprovedEmail('sam@example.com')).toBe(false)
    expect(garmCheck).toHaveBeenCalled()
  })

  it('a preview that does have Garm wiring gates on Garm', async () => {
    process.env.VERCEL_ENV = 'preview'
    mockLocalApprovedOnce(true)
    vi.mocked(garmCheck).mockResolvedValueOnce({ allowed: false, role: null })
    expect(await isApprovedEmail('sam@example.com')).toBe(false)
  })

  it('outside Vercel (no VERCEL_ENV) gates on Garm', async () => {
    delete process.env.VERCEL_ENV
    delete process.env.GARM_URL
    delete process.env.GARM_KEY
    vi.mocked(garmCheck).mockResolvedValueOnce({ allowed: false, role: null })
    expect(await isApprovedEmail('sam@example.com')).toBe(false)
  })

  it('the retired GARM_GATING=off switch no longer opens the local path', async () => {
    process.env.GARM_GATING = 'off'
    mockLocalApprovedOnce(true)
    vi.mocked(garmCheck).mockResolvedValueOnce({ allowed: false, role: null })
    expect(await isApprovedEmail('sam@example.com')).toBe(false)
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

// #155: getProjectRole / getViewerBriefRole fall back to an email-based
// project_members lookup (for members who haven't claimed via user_id yet).
// Stored rows are normalized; the incoming `email` param — pre-#155 the raw
// token email — must be normalized too or the fallback never matches.
describe('getProjectRole / getViewerBriefRole — email fallback normalization', () => {
  // Fake db: no membership row by user_id, one row by (project_id, email),
  // stored fully normalized. Captures every `where('email', ...)` value so
  // tests can assert the query argument itself was normalized, not just the
  // final answer.
  function fakeDbWithEmailMember(opts: {
    storedEmail: string
    memberData: Record<string, unknown>
    requesterEmail?: string
    requesterId?: string
    emailWhereSpy: (value: string) => void
  }) {
    return {
      collection: (name: string) => {
        if (name === 'projects') {
          return {
            doc: () => ({
              get: async () => ({
                exists: true,
                data: () => ({
                  requester_email: opts.requesterEmail ?? null,
                  requester_id: opts.requesterId ?? null,
                }),
              }),
            }),
          }
        }
        // project_members — first where() is always project_id in the real
        // call sites; the second where() carries the field that matters here.
        return {
          where: () => ({
            where: (field2: string, _op2: string, value2: string) => {
              if (field2 === 'email') opts.emailWhereSpy(value2)
              const isMatch = field2 === 'email' && value2 === opts.storedEmail
              return {
                get: async () => ({
                  docs: isMatch ? [{ data: () => opts.memberData }] : [],
                }),
                limit: () => ({
                  get: async () => ({
                    empty: !isMatch,
                    docs: isMatch ? [{ data: () => opts.memberData }] : [],
                  }),
                }),
              }
            },
          }),
        }
      },
    } as unknown as FirebaseFirestore.Firestore
  }

  it('getProjectRole normalizes the email arg before the fallback where() query', async () => {
    const emailWhereSpy = vi.fn()
    const db = fakeDbWithEmailMember({
      storedEmail: 'sam@example.com',
      memberData: { role: 'builder' },
      emailWhereSpy,
    })

    const role = await getProjectRole(db, 'p1', 'uid-no-match', '  Sam@Example.COM  ', [])
    expect(role).toBe('builder')
    expect(emailWhereSpy).toHaveBeenCalledWith('sam@example.com')
  })

  // Garm PR E: projects.requester_* is display-only denormalization — a match
  // there with no project_members row must NOT grant access.
  it('getProjectRole returns null for a requester_email-only match with no member row', async () => {
    const db = fakeDbWithEmailMember({
      storedEmail: 'nobody-matches@example.com',
      memberData: {},
      requesterEmail: 'sam@example.com',
      emailWhereSpy: () => {},
    })

    const role = await getProjectRole(db, 'p1', 'uid-no-match', 'sam@example.com', [])
    expect(role).toBeNull()
  })

  it('getProjectRole returns null for a requester_id-only match with no member row', async () => {
    const db = fakeDbWithEmailMember({
      storedEmail: 'nobody-matches@example.com',
      memberData: {},
      requesterId: 'uid-1',
      emailWhereSpy: () => {},
    })

    const role = await getProjectRole(db, 'p1', 'uid-1', 'sam@example.com', [])
    expect(role).toBeNull()
  })

  it('getProjectRole denies an empty email with no member row', async () => {
    const db = fakeDbWithEmailMember({
      storedEmail: 'nobody-matches@example.com',
      memberData: {},
      emailWhereSpy: () => {},
    })

    const role = await getProjectRole(db, 'p1', 'uid-no-match', '', [])
    expect(role).toBeNull()
  })

  it('getViewerBriefRole normalizes the email arg before the fallback where() query', async () => {
    const emailWhereSpy = vi.fn()
    const db = fakeDbWithEmailMember({
      storedEmail: 'sam@example.com',
      memberData: { brief_role: 'contributor' },
      emailWhereSpy,
    })

    const briefRole = await getViewerBriefRole(db, 'p1', 'uid-no-match', '  Sam@Example.COM  ')
    expect(briefRole).toBe('contributor')
    expect(emailWhereSpy).toHaveBeenCalledWith('sam@example.com')
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

  // #155: normalize at the token boundary so every downstream auth.email
  // consumer (getProjectRole, isAdminEmail, project_members writes, etc.)
  // inherits a clean value without having to normalize individually.
  it('normalizes (trim+lowercase) the token email', async () => {
    mockToken({ uid: 'user-999', email: ' Nico@Example.COM ' })
    const result = await getAuthenticatedUser(authedRequest())

    expect(result.error).toBeNull()
    expect(result.email).toBe('nico@example.com')
  })

  // #169: alias → canonical substitution at the token boundary. The resolver
  // (Garm-backed) may map the token's email to a canonical principal; every
  // downstream auth.email consumer then sees one identity for both addresses.
  it('substitutes the canonical email when the resolver maps an alias', async () => {
    mockToken({ uid: 'alias-uid', email: 'alias@example.com' })
    vi.mocked(resolveCanonicalEmail).mockResolvedValueOnce('canon@example.com')

    const result = await getAuthenticatedUser(authedRequest())
    expect(result.error).toBeNull()
    expect(result.email).toBe('canon@example.com')
  })

  it('passes the resolver the already-normalized token email', async () => {
    mockToken({ uid: 'alias-uid', email: ' Alias@Example.COM ' })
    await getAuthenticatedUser(authedRequest())
    expect(resolveCanonicalEmail).toHaveBeenCalledWith('alias@example.com')
  })

  it('keeps the token email when the resolver is identity (no alias)', async () => {
    mockToken({ uid: 'user-123', email: 'plain@example.com' })
    const result = await getAuthenticatedUser(authedRequest())
    expect(result.error).toBeNull()
    expect(result.email).toBe('plain@example.com')
  })

  it('an email-less token stays "" — substitution never invents an identity (#161 edge)', async () => {
    mockToken({ uid: 'no-email-uid', email: undefined as unknown as string })
    const result = await getAuthenticatedUser(authedRequest())
    expect(result.error).toBeNull()
    expect(result.email).toBe('')
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
