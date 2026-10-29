import { NextResponse } from 'next/server'
import { getAuthenticatedUser, getAdminDb, getProjectRole, requireRole } from '@/lib/api/firebase-server-helpers'
import { listUnfoldedNotes } from '@/lib/api/brief-notes'
import { writeNoteForProject } from '@/lib/api/note-writer'

// Reset the circuit-breaker counters tracked in app/api/cron/notify/route.ts.
async function clearBriefRegenFailures(db: FirebaseFirestore.Firestore, projectId: string) {
  await db.collection('projects').doc(projectId).update({
    brief_regen_failures: 0,
    brief_regen_failures_since: null,
    brief_regen_last_error: null,
  })
}

// GET /api/briefs/notes?project_id=xxx — the unfolded notes plus the live brief
// version (builder+). Version 0 and no notes when the project has no brief yet.
export async function GET(request: Request) {
  const auth = await getAuthenticatedUser(request)
  if (auth.error) return auth.error

  const projectId = new URL(request.url).searchParams.get('project_id')
  if (!projectId) {
    return NextResponse.json({ error: 'project_id is required' }, { status: 400 })
  }

  const db = getAdminDb()

  const role = await getProjectRole(db, projectId, auth.uid, auth.email, auth.systemRoles, auth)
  const roleCheck = requireRole(role, 'builder')
  if (roleCheck) return roleCheck

  const snap = await db
    .collection('briefs')
    .where('project_id', '==', projectId)
    .orderBy('version', 'desc')
    .limit(1)
    .get()

  if (snap.empty) {
    return NextResponse.json({ brief_id: null, brief_version: 0, notes: [] })
  }

  const doc = snap.docs[0]
  const notes = await listUnfoldedNotes(db, doc.id)
  return NextResponse.json({
    brief_id: doc.id,
    brief_version: (doc.data().version as number) || 0,
    notes,
  })
}

// POST /api/briefs/notes — write a note for what the conversation added since
// the last one (builder+). Clears the circuit-breaker counters on success.
export async function POST(request: Request) {
  const auth = await getAuthenticatedUser(request)
  if (auth.error) return auth.error

  const body = await request.json()
  const { project_id } = body

  if (!project_id) {
    return NextResponse.json({ error: 'project_id is required' }, { status: 400 })
  }

  const db = getAdminDb()

  const role = await getProjectRole(db, project_id, auth.uid, auth.email, auth.systemRoles, auth)
  const roleCheck = requireRole(role, 'builder')
  if (roleCheck) return roleCheck

  try {
    const result = await writeNoteForProject(db, project_id)
    await clearBriefRegenFailures(db, project_id)
    return NextResponse.json(result)
  } catch (err) {
    if (err instanceof Error && err.message === 'write_note_no_messages') {
      return NextResponse.json({ error: 'Nothing new since the last note' }, { status: 400 })
    }
    console.error('Note writing error:', err)
    return NextResponse.json({ error: 'Failed to write note' }, { status: 500 })
  }
}
