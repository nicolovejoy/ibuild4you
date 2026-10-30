import { NextResponse } from 'next/server'
import type { App } from '@/lib/types'
import { getAdminDb, hasSystemRole, type AuthSuccess } from '@/lib/api/firebase-server-helpers'
import {
  GarmLoopError,
  listGrantsForEmail,
  loopCheck,
  loopCheckResult,
  loopGarmBypassed,
  loopGarmConfigured,
} from '@/lib/garm-loop'

// =============================================================================
// Who may see or manage a Loop app. Garm decides: every grant is confirmed with
// a /gnipahellir check (`loopCheck`), never by comparing role strings. System
// admins keep full access regardless of Garm. Nothing is cached or stored here.
//
// A Garm outage is not a refusal: for non-admins the request-path helpers throw
// GarmLoopError (requireAppAccess turns it into a 503 garm_unavailable) so the
// UI can say Garm is down instead of showing "no apps". The sign-in gate
// (hasAnyAppAccess) is the exception: any error there is simply false.
// =============================================================================

/** 'admin' means a system admin; owner/collaborator come from Garm. */
export type AppAccess = 'admin' | 'owner' | 'collaborator' | null

// Garm unreachable, unconfigured or bypassed means nobody but admins gets in.
function garmUsable(): boolean {
  return loopGarmConfigured() && !loopGarmBypassed()
}

/**
 * `slug` must be the canonical app slug. Throws GarmLoopError when a check
 * errors (Garm down). Bypassed/unconfigured is config, not an outage: null.
 */
export async function appAccessFor(auth: AuthSuccess, slug: string): Promise<AppAccess> {
  if (hasSystemRole(auth, 'admin')) return 'admin'
  if (!garmUsable()) return null
  for (const role of ['owner', 'collaborator'] as const) {
    const result = await loopCheckResult(auth.email, slug, role)
    if (result === 'error') throw new GarmLoopError('garm check failed', null)
    if (result === 'allowed') return role
  }
  return null
}

/**
 * null when allowed, else a 403 (or a 503 garm_unavailable when Garm is down).
 * Owner satisfies a collaborator requirement.
 */
export async function requireAppAccess(
  auth: AuthSuccess,
  slug: string,
  min: 'owner' | 'collaborator'
): Promise<NextResponse | null> {
  let access: AppAccess
  try {
    access = await appAccessFor(auth, slug)
  } catch (err) {
    if (err instanceof GarmLoopError) {
      return NextResponse.json({ error: 'garm_unavailable' }, { status: 503 })
    }
    throw err
  }
  const allowed =
    access === 'admin' ||
    access === 'owner' ||
    (access === 'collaborator' && min === 'collaborator')
  return allowed ? null : NextResponse.json({ error: 'Forbidden' }, { status: 403 })
}

// Slugs of the apps this email holds an owner/collaborator grant on AND that
// have a Firestore row. Throws GarmLoopError if Garm can't be listed; a
// Firestore error propagates as itself.
async function candidateApps(email: string): Promise<App[]> {
  let grants: Awaited<ReturnType<typeof listGrantsForEmail>>
  try {
    grants = await listGrantsForEmail(email)
  } catch (err) {
    throw err instanceof GarmLoopError ? err : new GarmLoopError('garm list failed', null)
  }
  const slugs = [
    ...new Set(
      grants.filter((g) => g.role === 'owner' || g.role === 'collaborator').map((g) => g.project)
    ),
  ]
  const db = getAdminDb()
  const apps: App[] = []
  for (const slug of slugs) {
    const snap = await db.collection('apps').doc(slug).get()
    if (snap.exists) apps.push({ id: snap.id, ...(snap.data() as Omit<App, 'id'>) })
  }
  return apps
}

const byName = (a: { app: App }, b: { app: App }) =>
  (a.app.name ?? '').localeCompare(b.app.name ?? '')

export async function accessibleApps(
  auth: AuthSuccess
): Promise<Array<{ app: App; access: Exclude<AppAccess, null> }>> {
  if (hasSystemRole(auth, 'admin')) {
    const snap = await getAdminDb().collection('apps').get()
    return snap.docs
      .map((d) => ({
        app: { id: d.id, ...(d.data() as Omit<App, 'id'>) },
        access: 'admin' as const,
      }))
      .sort(byName)
  }
  if (!garmUsable()) return []

  // Throws GarmLoopError when Garm can't be listed or a check errors.
  const candidates = await candidateApps(auth.email)
  const out: Array<{ app: App; access: Exclude<AppAccess, null> }> = []
  for (const app of candidates) {
    const access = await appAccessFor(auth, app.id)
    if (access) out.push({ app, access })
  }
  return out.sort(byName)
}

/** For the sign-in gate, before there is an AuthSuccess. Never throws: any error is false. */
export async function hasAnyAppAccess(email: string): Promise<boolean> {
  if (!garmUsable()) return false
  let candidates: App[]
  try {
    candidates = await candidateApps(email)
  } catch {
    return false
  }
  for (const app of candidates) {
    if (await loopCheck(email, app.id, 'collaborator')) return true
  }
  return false
}
