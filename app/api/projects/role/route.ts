import { NextResponse } from 'next/server'
import {
  getAuthenticatedUser,
  getAdminDb,
  getProjectRole,
  requireRole,
} from '@/lib/api/firebase-server-helpers'
import { isBriefRole } from '@/lib/roles/brief-role'

// GET /api/projects/role?project_id=xxx — get the current user's role on a project
export async function GET(request: Request) {
  const auth = await getAuthenticatedUser(request)
  if (auth.error) return auth.error

  const { searchParams } = new URL(request.url)
  const projectId = searchParams.get('project_id')

  if (!projectId) {
    return NextResponse.json({ error: 'project_id is required' }, { status: 400 })
  }

  const db = getAdminDb()
  const role = await getProjectRole(db, projectId, auth.uid, auth.email, auth.systemRoles, auth)

  return NextResponse.json({ role })
}

// PATCH /api/projects/role — builder+ sets a member's brief_role (what they're
// *doing* on the brief). Body: { project_id, email, brief_role }. brief_role
// must be a valid BriefRole, or null to clear it (e.g. for an owner).
export async function PATCH(request: Request) {
  const auth = await getAuthenticatedUser(request)
  if (auth.error) return auth.error

  let body: Record<string, unknown>
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const projectId = typeof body.project_id === 'string' ? body.project_id : ''
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : ''
  const briefRole = body.brief_role

  if (!projectId || !email) {
    return NextResponse.json({ error: 'project_id and email are required' }, { status: 400 })
  }
  if (briefRole !== null && !isBriefRole(briefRole)) {
    return NextResponse.json({ error: 'brief_role must be a valid brief role or null' }, { status: 400 })
  }

  const db = getAdminDb()
  const callerRole = await getProjectRole(db, projectId, auth.uid, auth.email, auth.systemRoles, auth)
  const roleCheck = requireRole(callerRole, 'builder')
  if (roleCheck) return roleCheck

  const memberSnap = await db
    .collection('project_members')
    .where('project_id', '==', projectId)
    .where('email', '==', email)
    .limit(1)
    .get()

  if (memberSnap.empty) {
    return NextResponse.json({ error: 'Member not found' }, { status: 404 })
  }

  await memberSnap.docs[0].ref.update({ brief_role: briefRole, updated_at: new Date().toISOString() })
  return NextResponse.json({ ok: true, brief_role: briefRole })
}
