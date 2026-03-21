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
export async function POST(request: Request) {
  const auth = await getAuthenticatedUser(request)
  if (auth.error) return auth.error

  const body = await request.json()
  const { project_id, include_welcome } = body

  if (!project_id) {
    return NextResponse.json({ error: 'project_id is required' }, { status: 400 })
  }

  const db = getAdminDb()

  const projectDoc = await db.collection('projects').doc(project_id).get()
  if (!projectDoc.exists || !canAccessProject(projectDoc.data()!, auth.uid, auth.email)) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  const now = new Date().toISOString()
  const docRef = await db.collection('sessions').add({
    project_id,
    status: 'active',
    created_at: now,
    updated_at: now,
  })

  // Add welcome message to the new session if requested and one exists on the project
  if (include_welcome) {
    const welcomeMessage = projectDoc.data()?.welcome_message as string | undefined
    if (welcomeMessage) {
      await db.collection('messages').add({
        session_id: docRef.id,
        role: 'agent',
        content: welcomeMessage,
        created_at: now,
        updated_at: now,
      })
    }
  }

  return NextResponse.json(
    { id: docRef.id, project_id, status: 'active', created_at: now, updated_at: now },
    { status: 201 }
  )
}
