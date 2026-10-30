import { NextResponse } from 'next/server'
import { getAdminDb, hasSystemRole, type AuthSuccess } from '@/lib/api/firebase-server-helpers'
import { findAppBySlug } from '@/lib/api/apps'
import { requireAppAccess } from '@/lib/api/app-access'

/**
 * Gate for the admin feedback routes. `projectId` is a feedback row's
 * project_id, which may be a legacy slug, so resolve it to the app first and
 * ask Garm about the canonical slug. null when allowed, else a 403.
 * A project id that matches no app is denied for non-admins.
 */
export async function requireFeedbackAccess(
  auth: AuthSuccess,
  projectId: string
): Promise<NextResponse | null> {
  if (hasSystemRole(auth, 'admin')) return null
  const app = await findAppBySlug(getAdminDb(), projectId)
  if (!app) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  return requireAppAccess(auth, app.slug, 'collaborator')
}
