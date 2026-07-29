import { NextResponse } from 'next/server'
import { getAdminAuth, getAdminDb } from '@/lib/firebase/admin'
import { ADMIN_EMAILS, isAdminEmail } from '@/lib/constants'
import type { BriefRole, MemberRole, SystemRole } from '@/lib/types'
import { getCachedUser, setCachedUser } from './auth-cache'
import { isActiveMember } from '@/lib/members/lifecycle'
import { normalizeEmail } from '@/lib/email/normalize'
import { garmCheck, GARM_PROJECT } from '@/lib/garm'
import {
  scheduleGarmShadowCheck,
  shadowCheckApprovedEmail,
  shadowCheckLocalAllowlist,
} from '@/lib/garm-shadow'

export { ADMIN_EMAILS }

// User doc fields we cache alongside auth so callers don't re-read users/<uid>.
export type CachedUserData = {
  first_name: string | null
  last_name: string | null
  account_label: string | null
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
  // Normalize defensively (#155) — most callers pass auth.email, already
  // normalized at the token boundary, but this is the app's access-control
  // core so it shouldn't depend on every caller getting that right.
  email = normalizeEmail(email)

  // Instance admins get implicit owner on all projects
  if (systemRoles.includes('admin') || isAdminEmail(email)) return 'owner'

  if (ctx?.roleCache.has(projectId)) {
    return ctx.roleCache.get(projectId) ?? null
  }

  // Check explicit membership. A removed member (removed_at set, #106) has no
  // access, so pick the active row rather than limit(1) — a stale removed row
  // must not grant a role.
  const memberSnap = await db
    .collection('project_members')
    .where('project_id', '==', projectId)
    .where('user_id', '==', userId)
    .get()

  const activeByUid = memberSnap.docs.find((d) => isActiveMember(d.data()))
  if (activeByUid) {
    const role = activeByUid.data().role as MemberRole
    ctx?.roleCache.set(projectId, role)
    return role
  }

  // Also check by email (for users who haven't claimed yet — user_id may differ)
  const emailSnap = await db
    .collection('project_members')
    .where('project_id', '==', projectId)
    .where('email', '==', email)
    .get()

  const activeByEmail = emailSnap.docs.find((d) => isActiveMember(d.data()))
  if (activeByEmail) {
    const role = activeByEmail.data().role as MemberRole
    ctx?.roleCache.set(projectId, role)
    return role
  }

  // No fallback beyond project_members (Garm PR E): projects.requester_id /
  // requester_email are display-only denormalization, never an access grant.
  ctx?.roleCache.set(projectId, null)
  return null
}

// The viewer's stored brief_role on a project (what they're *doing*, vs their
// access tier from getProjectRole). Looked up by user_id, then email (for
// unclaimed members). Returns null for admins/owners and anyone with no row —
// callers fall back to the access-tier default via viewerBriefRole().
export async function getViewerBriefRole(
  db: FirebaseFirestore.Firestore,
  projectId: string,
  userId: string,
  email: string
): Promise<BriefRole | null> {
  email = normalizeEmail(email) // #155 — same defensive normalize as getProjectRole
  const byUid = await db
    .collection('project_members')
    .where('project_id', '==', projectId)
    .where('user_id', '==', userId)
    .limit(1)
    .get()
  if (!byUid.empty) return (byUid.docs[0].data().brief_role as BriefRole | null) ?? null

  const byEmail = await db
    .collection('project_members')
    .where('project_id', '==', projectId)
    .where('email', '==', email)
    .limit(1)
    .get()
  if (!byEmail.empty) return (byEmail.docs[0].data().brief_role as BriefRole | null) ?? null

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
  // Normalize at the token boundary (#155) — every downstream auth.email
  // consumer (isAdminEmail, getProjectRole, project_members writes, ...)
  // inherits a clean value from here without re-normalizing individually.
  const email = normalizeEmail(decoded.email)

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
            account_label: (raw.account_label as string | undefined) ?? null,
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
  // A member who hasn't signed in yet has no user_id. Firestore's .doc('')
  // throws ("documentPath must be a non-empty string"), which would 500 the
  // /members route — skip the lookup and fall back to the email prefix.
  if (!uid) return email.split('@')[0]

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

// Garm cutover (docs/garm-consumer-plan.md Phase 5, PR G): Garm is the
// authoritative sign-in gate. Fail mode is CLOSED — Nico's ratified Q2 call
// (2026-07-29, handoff channel): Garm unreachable + cold cache → deny. There
// is deliberately NO local-fallback branch; a consumer-side fallback authority
// would quietly become a second authz system and defeat the centralization.
// The outage escape hatch is the GARM_GATING=off kill switch below — a human
// flipping an env var, never silent code.
export async function isApprovedEmail(email: string, systemRoles: SystemRole[] = []): Promise<boolean> {
  // Admins never depend on Garm — break-glass so a Garm outage can't lock the
  // operator out of the app that manages the recovery. ADMIN_EMAILS stays the
  // constant it always was; migrating admins onto a Garm '*' owner grant is
  // possible later but this short-circuit should survive that too.
  if (systemRoles.includes('admin') || isAdminEmail(email)) return true

  // Kill switch (one release, then PR H removes it): exactly 'off' restores
  // the pre-cutover local allowlist path, with the Phase-4 shadow comparison
  // against Garm. Any other value (including unset) means Garm decides.
  // Preview runs with GARM_GATING=off — its env has no GARM_URL/GARM_KEY, so
  // the Garm path there would deny every non-admin and dark the e2e fleet.
  if (process.env.GARM_GATING === 'off') {
    const localAnswer = await computeLocalApprovedAnswer(email)
    scheduleGarmShadowCheck(() => shadowCheckApprovedEmail(email, localAnswer))
    return localAnswer
  }

  const { allowed } = await garmCheck(email, GARM_PROJECT, 'viewer')

  // Reverse shadow for the kill-switch window: keep logging disagreements with
  // the (now non-authoritative) local allowlist so a bad cutover is visible in
  // the logs, not just in locked-out friends. Off the hot path via after();
  // gated on GARM_SHADOW like before; PR H deletes it with the allowlist.
  scheduleGarmShadowCheck(() =>
    shadowCheckLocalAllowlist(allowed, () => computeLocalApprovedAnswer(email))
  )

  return allowed
}

async function computeLocalApprovedAnswer(email: string): Promise<boolean> {
  const db = getAdminDb()
  const doc = await db.collection('approved_emails').doc(normalizeEmail(email)).get()
  if (!doc.exists) return false
  // Off-boarding (#163): a revoked row must not grant sign-in even though
  // the doc still exists (non-destructive flag, not a delete).
  return !doc.data()?.revoked_at
}

export { getAdminDb }
