import { NextResponse } from 'next/server'
import { getAuthenticatedUser, getAdminDb, getProjectRole, requireRole } from '@/lib/api/firebase-server-helpers'
import { copy } from '@/lib/copy'
import { welcomeToPost } from '@/lib/sessions/welcome'
import { excludeArchived, isArchivedSession } from '@/lib/sessions/active'

// GET /api/sessions?project_id=xxx — list sessions for a project
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
  if (!role) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  const snapshot = await db
    .collection('sessions')
    .where('project_id', '==', projectId)
    .orderBy('created_at', 'desc')
    .get()

  // Hide admin-archived conversations (#105) so they don't render as empty entries.
  const sessions = excludeArchived(
    snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }) as { id: string; status?: string })
  )
  return NextResponse.json(sessions)
}

// POST /api/sessions — create a new session for a project (builder+)
// Snapshots current agent config from the project onto the session for tracking.
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

  const projectDoc = await db.collection('projects').doc(project_id).get()
  if (!projectDoc.exists) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  const projectData = projectDoc.data()!
  const now = new Date().toISOString()

  // Is this the project's first session? The first session always opens with a
  // welcome (the default copy if none is set). On session 2+ the maker is
  // returning: a welcome the builder wrote for this round is posted word for
  // word, otherwise Sam greets via kickoff instead of replaying an old opener
  // (#70). See lib/sessions/welcome.ts.
  const existingSessions = await db
    .collection('sessions')
    .where('project_id', '==', project_id)
    .get()
  // Archived conversations don't count: after an admin reset-to-fresh (#105) the
  // next session is a genuine first session (gets the welcome) and #1.
  const liveCount = existingSessions.docs.filter((d) => !isArchivedSession(d.data())).length
  const isFirstSession = liveCount === 0
  // The new session's ordinal = live count + 1. Denormalized onto the
  // project below so the maker-reminders cron + outbound copy can show
  // "conversation (#n)" without an extra query (#21).
  const sessionNumber = liveCount + 1

  // Mark any existing active sessions as completed
  const activeSessions = await db
    .collection('sessions')
    .where('project_id', '==', project_id)
    .where('status', '==', 'active')
    .get()

  const batch = db.batch()
  for (const doc of activeSessions.docs) {
    batch.update(doc.ref, { status: 'completed', updated_at: now })
  }

  // Snapshot agent config from project onto the new session
  const sessionData: Record<string, unknown> = {
    project_id,
    status: 'active',
    created_at: now,
    updated_at: now,
  }
  const configFields = ['session_mode', 'seed_questions', 'builder_directives', 'welcome_message', 'identity'] as const
  for (const field of configFields) {
    if (projectData[field] !== undefined) {
      sessionData[field] = projectData[field]
    }
  }

  const docRef = db.collection('sessions').doc()
  batch.set(docRef, sessionData)

  // Denormalize the latest session timestamp onto the project so the
  // maker-reminders cron can anchor its cadence on the newest session
  // without an extra query. (The dashboard's enrich-projects computes this
  // read-time; the cron reads the persisted field.)
  batch.update(projectDoc.ref, {
    latest_session_created_at: now,
    session_count: sessionNumber,
    updated_at: now,
  })

  // Open the conversation with the builder's welcome, word for word: always on
  // the first session (default copy if none is set), and on a return session
  // only when the welcome is new for this round. Archived sessions count as
  // "earlier" too, so a reset brief doesn't replay a welcome it already used.
  const builderWelcome = welcomeToPost({
    isFirstSession,
    welcome: projectData.welcome_message as string | undefined,
    earlierWelcomes: existingSessions.docs.map((d) => d.data().welcome_message as string | undefined),
  })
  const welcomeMessage =
    builderWelcome ?? (isFirstSession ? copy.chat.defaultWelcomeMessage(projectData.title as string) : null)
  if (welcomeMessage) {
    const msgRef = db.collection('messages').doc()
    batch.set(msgRef, {
      session_id: docRef.id,
      role: 'agent',
      content: welcomeMessage,
      created_at: now,
      updated_at: now,
    })
  }

  await batch.commit()

  return NextResponse.json(
    { id: docRef.id, ...sessionData },
    { status: 201 }
  )
}
