import { NextResponse } from 'next/server'
import { getAdminAuth, getAdminDb } from '@/lib/firebase/admin'
import { ADMIN_EMAILS, isAdminEmail } from '@/lib/constants'
import type { MemberRole, SystemRole } from '@/lib/types'
import { getCachedUser, setCachedUser } from './auth-cache'

export { ADMIN_EMAILS }

// User doc fields we cache alongside auth so callers don't re-read users/<uid>.
export type CachedUserData = {
  first_name: string | null
  last_name: string | null
}

// Firestore Admin error codes we care about for HTTP-status mapping.
// 8 = RESOURCE_EXHAUSTED (quota), 14 = UNAVAILABLE.
export function classifyFirestoreError(err: unknown): 503 | 500 {
  const code = (err as { code?: number } | null)?.code
  if (code === 8 || code === 14) return 503
  return 500
}

function firestoreErrorResponse(err: unknown, context: string): NextResponse {
  const status = classifyFirestoreError(err)
  const code = (err as { code?: number } | null)?.code
  if (status === 503) {
    console.error(`[quota] ${context} (firestore code=${code}):`, err)
    return NextResponse.json(
      { error: 'Service unavailable' },
      { status: 503, headers: { 'Retry-After': '60' } }
    )
  }
  console.error(`[firestore] ${context}:`, err)
  return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
}

// --- Permission ladder ---
// owner > builder > apprentice > maker
// Each level includes everything below it.

const ROLE_RANK: Record<MemberRole, number> = {
  maker: 0,
  apprentice: 1,
  builder: 2,
  owner: 3,
}

export function canChat(role: MemberRole | null): boolean {
  return role !== null // maker+
}

export function canReview(role: MemberRole | null): boolean {
  return role !== null && ROLE_RANK[role] >= ROLE_RANK['apprentice']
}

export function canConfigure(role: MemberRole | null): boolean {
  return role !== null && ROLE_RANK[role] >= ROLE_RANK['builder']
}

export function canManage(role: MemberRole | null): boolean {
  return role !== null && ROLE_RANK[role] >= ROLE_RANK['owner']
}

// Look up a user's role on a project via project_members collection.
// Admins get implicit owner on all projects.
// Returns null if no access.
//
// Pass `ctx.roleCache` (from getAuthenticatedUser) to memoize within a request
// — multiple handlers in the same request reuse the result, including the
// "no access" answer (cached as null).
export async function getProjectRole(
  db: FirebaseFirestore.Firestore,
  projectId: string,
  userId: string,
  email: string,
  systemRoles: SystemRole[] = [],
  ctx?: { roleCache: Map<string, MemberRole | null> }
): Promise<MemberRole | null> {
  // Instance admins get implicit owner on all projects
  if (systemRoles.includes('admin') || isAdminEmail(email)) return 'owner'

  if (ctx?.roleCache.has(projectId)) {
    return ctx.roleCache.get(projectId) ?? null
  }

  // Check explicit membership
  const memberSnap = await db
    .collection('project_members')
    .where('project_id', '==', projectId)
    .where('user_id', '==', userId)
    .limit(1)
    .get()

  if (!memberSnap.empty) {
    const role = memberSnap.docs[0].data().role as MemberRole
    ctx?.roleCache.set(projectId, role)
    return role
  }

  // Also check by email (for users who haven't claimed yet — user_id may differ)
  const emailSnap = await db
    .collection('project_members')
    .where('project_id', '==', projectId)
    .where('email', '==', email)
    .limit(1)
    .get()

  if (!emailSnap.empty) {
    const role = emailSnap.docs[0].data().role as MemberRole
    ctx?.roleCache.set(projectId, role)
    return role
  }

  // Legacy fallback: check requester_id / requester_email on the project doc
  const projectDoc = await db.collection('projects').doc(projectId).get()
  if (projectDoc.exists) {
    const data = projectDoc.data()!
    if (data.requester_id === userId || data.requester_email === email) {
      ctx?.roleCache.set(projectId, 'maker')
      return 'maker'
    }
  }

  ctx?.roleCache.set(projectId, null)
  return null
}

// Require a minimum role on a project. Returns a 403 response if insufficient, or null if OK.
export function requireRole(
  role: MemberRole | null,
  minimum: MemberRole
): NextResponse | null {
  if (role === null || ROLE_RANK[role] < ROLE_RANK[minimum]) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  return null
}

export type AuthSuccess = {
  uid: string
  email: string
  displayName: string | null
  systemRoles: SystemRole[]
  userData: CachedUserData | null
  // Per-request memoization of project_members lookups. Threaded into
  // getProjectRole so multiple handlers in the same request reuse the result.
  roleCache: Map<string, MemberRole | null>
  cacheStatus: 'hit' | 'miss'
  error: null
}

export type AuthFailure = {
  uid: null
  email: null
  error: NextResponse
}

// Check if an authenticated user has a specific system role.
export function hasSystemRole(auth: AuthSuccess, role: SystemRole): boolean {
  return auth.systemRoles.includes(role)
}

export async function getAuthenticatedUser(request: Request): Promise<AuthSuccess | AuthFailure> {
  const authHeader = request.headers.get('Authorization')
  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null

  if (!token) {
    return {
      uid: null,
      email: null,
      error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }),
    }
  }

  // Step 1: token verification. Errors here are auth failures → 401.
  let decoded
  try {
    decoded = await getAdminAuth().verifyIdToken(token)
  } catch (err) {
    console.error('[auth] verifyIdToken failed:', err)
    return {
      uid: null,
      email: null,
      error: NextResponse.json({ error: 'Invalid token' }, { status: 401 }),
    }
  }

  const uid = decoded.uid
  const email = decoded.email ?? ''

  // Step 2: load user doc (with cache). Firestore errors here are infra failures,
  // NOT auth failures — return 503 so the client doesn't kick the user to the
  // not-approved gate on a quota blip.
  const cached = getCachedUser(uid)
  let systemRoles: SystemRole[]
  let userData: CachedUserData | null
  let cacheStatus: 'hit' | 'miss'

  if (cached) {
    systemRoles = cached.systemRoles
    userData = cached.userData
    cacheStatus = 'hit'
  } else {
    cacheStatus = 'miss'
    try {
      const db = getAdminDb()
      const userDoc = await db.collection('users').doc(uid).get()
      const raw = userDoc.data()
      if (Array.isArray(raw?.system_roles)) {
        systemRoles = raw.system_roles as SystemRole[]
      } else if (isAdminEmail(email)) {
        systemRoles = ['admin']
      } else {
        systemRoles = []
      }
      userData = raw
        ? {
            first_name: (raw.first_name as string | undefined) ?? null,
            last_name: (raw.last_name as string | undefined) ?? null,
          }
        : null
      setCachedUser(uid, { systemRoles, userData })
    } catch (err) {
      return {
        uid: null,
        email: null,
        error: firestoreErrorResponse(err, 'getAuthenticatedUser user-doc read'),
      }
    }
  }

  return {
    uid,
    email,
    displayName: (decoded.name as string) || null,
    systemRoles,
    userData,
    roleCache: new Map(),
    cacheStatus,
    error: null,
  }
}

// Look up a user's display name from the users collection.
// Returns "First L" format, or email prefix as fallback.
export async function getUserDisplayName(
  db: FirebaseFirestore.Firestore,
  uid: string,
  email: string
): Promise<string> {
  const userDoc = await db.collection('users').doc(uid).get()
  if (userDoc.exists) {
    const data = userDoc.data()!
    const firstName = data.first_name as string | undefined
    const lastName = data.last_name as string | undefined
    if (firstName) {
      return lastName ? `${firstName} ${lastName.charAt(0)}` : firstName
    }
  }
  // Fallback: email prefix
  return email.split('@')[0]
}

export async function isApprovedEmail(email: string, systemRoles: SystemRole[] = []): Promise<boolean> {
  if (systemRoles.includes('admin') || isAdminEmail(email)) return true

  const db = getAdminDb()
  const doc = await db.collection('approved_emails').doc(email.toLowerCase()).get()
  return doc.exists
}

export { getAdminDb }
