import { NextResponse } from 'next/server'
import type { App } from '@/lib/types'
import { getAdminDb, hasSystemRole, type AuthSuccess } from '@/lib/api/firebase-server-helpers'
import {
  listGrantsForEmail,
  loopCheck,
  loopGarmBypassed,
  loopGarmConfigured,
} from '@/lib/garm-loop'

// =============================================================================
// Who may see or manage a Loop app. Garm decides: every grant is confirmed with
// a /gnipahellir check (`loopCheck`), never by comparing role strings. System
// admins keep full access regardless of Garm. Nothing is cached or stored here.
// =============================================================================

/** 'admin' means a system admin; owner/collaborator come from Garm. */
export type AppAccess = 'admin' | 'owner' | 'collaborator' | null

// Garm unreachable, unconfigured or bypassed means nobody but admins gets in.
function garmUsable(): boolean {
  return loopGarmConfigured() && !loopGarmBypassed()
}

/** `slug` must be the canonical app slug. */
export async function appAccessFor(auth: AuthSuccess, slug: string): Promise<AppAccess> {
  if (hasSystemRole(auth, 'admin')) return 'admin'
  if (!garmUsable()) return null
  if (await loopCheck(auth.email, slug, 'owner')) return 'owner'
  if (await loopCheck(auth.email, slug, 'collaborator')) return 'collaborator'
  return null
}

/** null when allowed, else a 403. Owner satisfies a collaborator requirement. */
export async function requireAppAccess(
  auth: AuthSuccess,
  slug: string,
  min: 'owner' | 'collaborator'
): Promise<NextResponse | null> {
  const access = await appAccessFor(auth, slug)
  const allowed =
    access === 'admin' ||
    access === 'owner' ||
    (access === 'collaborator' && min === 'collaborator')
  return allowed ? null : NextResponse.json({ error: 'Forbidden' }, { status: 403 })
}

// Slugs of the apps this email holds an owner/collaborator grant on AND that
// have a Firestore row. Throws if Garm can't be listed.
async function candidateApps(email: string): Promise<App[]> {
  const grants = await listGrantsForEmail(email)
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

  let candidates: App[]
  try {
    candidates = await candidateApps(auth.email)
  } catch {
    return []
  }
  const out: Array<{ app: App; access: Exclude<AppAccess, null> }> = []
  for (const app of candidates) {
    const access = await appAccessFor(auth, app.id)
    if (access) out.push({ app, access })
  }
  return out.sort(byName)
}

/** For the sign-in gate, before there is an AuthSuccess. */
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
