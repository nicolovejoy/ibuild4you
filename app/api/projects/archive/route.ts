import { NextResponse } from 'next/server'
import {
  getAuthenticatedUser,
  getAdminDb,
  getProjectRole,
} from '@/lib/api/firebase-server-helpers'

// PATCH /api/projects/archive — the caller archives/unarchives THIS brief from
// their own dashboard. Per-viewer: the flag lives on the caller's membership, so
// archiving doesn't hide the brief for other people on a shared brief.
// Body: { project_id, archived: boolean }.
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
  const archived = body.archived
  if (!projectId || typeof archived !== 'boolean') {
    return NextResponse.json({ error: 'project_id and archived (boolean) are required' }, { status: 400 })
  }

  const db = getAdminDb()

  // Must be able to see the brief to archive it.
  const role = await getProjectRole(db, projectId, auth.uid, auth.email, auth.systemRoles, auth)
  if (!role) {
    return NextResponse.json({ error: 'Not a member of this brief' }, { status: 403 })
  }

  const archivedAt = archived ? new Date().toISOString() : null

  // Find the caller's own membership (by uid, then email). Legacy briefs the
  // caller owns via requester_* may have no membership row yet — create one so
  // the archive flag has a home.
  const byUid = await db
    .collection('project_members')
    .where('project_id', '==', projectId)
    .where('user_id', '==', auth.uid)
    .limit(1)
    .get()
  const memberDoc = byUid.empty
    ? (
        await db
          .collection('project_members')
          .where('project_id', '==', projectId)
          .where('email', '==', auth.email)
          .limit(1)
          .get()
      ).docs[0]
    : byUid.docs[0]

  if (memberDoc) {
    await memberDoc.ref.update({ archived_at: archivedAt, updated_at: new Date().toISOString() })
  } else {
    const now = new Date().toISOString()
    await db.collection('project_members').add({
      project_id: projectId,
      user_id: auth.uid,
      email: auth.email,
      role, // getProjectRole already maps instance admins to 'owner'
      added_by: auth.email,
      archived_at: archivedAt,
      created_at: now,
      updated_at: now,
    })
  }

  return NextResponse.json({ ok: true, archived })
}
