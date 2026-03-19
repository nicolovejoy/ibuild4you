import { NextResponse } from 'next/server'
import { getAuthenticatedUser, getAdminDb } from '@/lib/api/firebase-server-helpers'

// GET /api/projects — list the current user's projects
export async function GET(request: Request) {
  const auth = await getAuthenticatedUser(request)
  if (auth.error) return auth.error

  const db = getAdminDb()
  const snapshot = await db
    .collection('projects')
    .where('requester_id', '==', auth.uid)
    .orderBy('created_at', 'desc')
    .get()

  const projects = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }))
  return NextResponse.json(projects)
}

// POST /api/projects — create a new project
export async function POST(request: Request) {
  const auth = await getAuthenticatedUser(request)
  if (auth.error) return auth.error

  const body = await request.json()
  const { title } = body

  if (!title?.trim()) {
    return NextResponse.json({ error: 'Title is required' }, { status: 400 })
  }

  const db = getAdminDb()
  const now = new Date().toISOString()

  const docRef = await db.collection('projects').add({
    requester_id: auth.uid,
    title: title.trim(),
    status: 'active',
    created_at: now,
    updated_at: now,
  })

  // Create the first session for the project automatically
  const sessionRef = await db.collection('sessions').add({
    project_id: docRef.id,
    status: 'active',
    created_at: now,
    updated_at: now,
  })

  const project = {
    id: docRef.id,
    requester_id: auth.uid,
    title: title.trim(),
    status: 'active',
    created_at: now,
    updated_at: now,
  }

  return NextResponse.json({ ...project, session_id: sessionRef.id }, { status: 201 })
}
