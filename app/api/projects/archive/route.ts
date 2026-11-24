import { NextResponse } from 'next/server'
import {
  getAuthenticatedUser,
  getAdminDb,
  getProjectRole,
} from '@/lib/api/firebase-server-helpers'
import { normalizeEmail } from '@/lib/email/normalize'
import { findViewerMemberRows } from '@/lib/members/find'

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
  // Defensive normalize (#155) — auth.email is already normalized at the
  // token boundary, but this route writes rows keyed on it, so don't depend
  // on that upstream invariant here.
  const email = normalizeEmail(auth.email)

  // Must be able to see the brief to archive it.
  const role = await getProjectRole(db, projectId, auth.uid, email, auth.systemRoles, auth)
  if (!role) {
    return NextResponse.json({ error: 'Not a member of this brief' }, { status: 403 })
  }

  const archivedAt = archived ? new Date().toISOString() : null

  // Find the caller's own ACTIVE membership (by uid, then email). The flag
  // never goes on a removed row (#295): the list and the Settings tab read the
  // active row, so a flag on a removed one would show in neither.
  const { active: memberDoc, removed } = await findViewerMemberRows(db, projectId, auth.uid, email)

  if (memberDoc) {
    await memberDoc.ref.update({ archived_at: archivedAt, updated_at: new Date().toISOString() })
  } else if (removed) {
    // Only an instance admin gets here (a removed member has no role). Adding
    // a second row beside the removed one would leave two rows for one person
    // once the first is restored, so nothing is written.
    return NextResponse.json(
      { error: 'You were removed from this brief. Restore your membership under People before archiving it.' },
      { status: 409 }
    )
  } else {
    // An instance admin with no membership row yet — create one so the
    // archive flag has a home.
    const now = new Date().toISOString()
    await db.collection('project_members').add({
      project_id: projectId,
      user_id: auth.uid,
      email,
      role, // getProjectRole already maps instance admins to 'owner'
      added_by: email,
      archived_at: archivedAt,
      created_at: now,
      updated_at: now,
    })
  }

  return NextResponse.json({ ok: true, archived })
}
