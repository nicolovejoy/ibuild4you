import { NextResponse } from 'next/server'
import { getAuthenticatedUser, getAdminDb, canAccessProject } from '@/lib/api/firebase-server-helpers'

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

  const projectDoc = await db.collection('projects').doc(projectId).get()
  if (!projectDoc.exists || !canAccessProject(projectDoc.data()!, auth.uid, auth.email)) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  const snapshot = await db
    .collection('sessions')
    .where('project_id', '==', projectId)
    .orderBy('created_at', 'desc')
    .get()

  const sessions = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }))
  return NextResponse.json(sessions)
}

// POST /api/sessions — create a new session for a project
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

  const projectDoc = await db.collection('projects').doc(project_id).get()
  if (!projectDoc.exists || !canAccessProject(projectDoc.data()!, auth.uid, auth.email)) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  const projectData = projectDoc.data()!
  const now = new Date().toISOString()

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
  const configFields = ['session_mode', 'seed_questions', 'builder_directives', 'welcome_message', 'style_guide'] as const
  for (const field of configFields) {
    if (projectData[field] !== undefined) {
      sessionData[field] = projectData[field]
    }
  }

  const docRef = db.collection('sessions').doc()
  batch.set(docRef, sessionData)

  // Add welcome message as first message in the new session
  const welcomeMessage = projectData.welcome_message as string | undefined
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
