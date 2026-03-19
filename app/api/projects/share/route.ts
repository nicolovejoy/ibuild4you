import { NextResponse } from 'next/server'
import {
  getAuthenticatedUser,
  getAdminDb,
  requireAdmin,
} from '@/lib/api/firebase-server-helpers'

// POST /api/projects/share — share a project with a requester by email (admin-only)
export async function POST(request: Request) {
  const auth = await getAuthenticatedUser(request)
  if (auth.error) return auth.error

  const adminCheck = requireAdmin(auth.email)
  if (adminCheck) return adminCheck

  const body = await request.json()
  const { project_id, email } = body

  if (!project_id || !email?.trim()) {
    return NextResponse.json(
      { error: 'project_id and email are required' },
      { status: 400 }
    )
  }

  const db = getAdminDb()
  const normalizedEmail = email.trim().toLowerCase()

  // Verify project exists
  const projectDoc = await db.collection('projects').doc(project_id).get()
  if (!projectDoc.exists) {
    return NextResponse.json({ error: 'Project not found' }, { status: 404 })
  }

  // Add email to approved_emails so they can sign in
  await db.collection('approved_emails').doc(normalizedEmail).set({
    email: normalizedEmail,
    approved_by: auth.email,
    created_at: new Date().toISOString(),
  })

  // Store the requester_email on the project
  await db.collection('projects').doc(project_id).update({
    requester_email: normalizedEmail,
    updated_at: new Date().toISOString(),
  })

  return NextResponse.json({
    email: normalizedEmail,
    project_id,
  })
}
