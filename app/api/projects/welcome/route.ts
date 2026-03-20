import { NextResponse } from 'next/server'
import {
  getAuthenticatedUser,
  getAdminDb,
  requireAdmin,
} from '@/lib/api/firebase-server-helpers'
import { generateWelcomeMessage } from '@/lib/agent/welcome-message'

// POST /api/projects/welcome — generate a welcome message for a project (admin-only)
export async function POST(request: Request) {
  const auth = await getAuthenticatedUser(request)
  if (auth.error) return auth.error

  const adminCheck = requireAdmin(auth.email)
  if (adminCheck) return adminCheck

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

  const projectData = projectDoc.data()!
  const welcomeMessage = await generateWelcomeMessage(
    projectData.title as string,
    projectData.context as string | undefined
  )

  return NextResponse.json({ welcome_message: welcomeMessage })
}
