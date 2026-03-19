import { NextResponse } from 'next/server'
import { getAuthenticatedUser, getAdminDb } from '@/lib/api/firebase-server-helpers'

// POST /api/projects/claim — claim a project that was shared with you
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

  if (!projectDoc.exists) {
    return NextResponse.json({ error: 'Project not found' }, { status: 404 })
  }

  const project = projectDoc.data()

  // Check that this project was shared with this user's email
  if (project?.requester_email !== auth.email) {
    return NextResponse.json({ error: 'This project was not shared with you' }, { status: 403 })
  }

  // Transfer ownership
  await db.collection('projects').doc(project_id).update({
    requester_id: auth.uid,
    updated_at: new Date().toISOString(),
  })

  return NextResponse.json({ claimed: true, project_id })
}
