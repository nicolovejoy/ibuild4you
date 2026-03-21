import { NextResponse } from 'next/server'
import {
  getAuthenticatedUser,
  getAdminDb,
  requireAdmin,
} from '@/lib/api/firebase-server-helpers'
import { generateWelcomeMessage } from '@/lib/agent/welcome-message'

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

  const projectData = projectDoc.data()!

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

  // Snapshot agent config onto the active session + add welcome message
  try {
    const sessionSnap = await db
      .collection('sessions')
      .where('project_id', '==', project_id)
      .where('status', '==', 'active')
      .limit(1)
      .get()

    if (!sessionSnap.empty) {
      const sessionDoc = sessionSnap.docs[0]

      // Snapshot agent config from project onto session for tracking
      const configSnapshot: Record<string, unknown> = { updated_at: new Date().toISOString() }
      const configFields = ['session_mode', 'seed_questions', 'builder_directives', 'welcome_message', 'style_guide'] as const
      for (const field of configFields) {
        if (projectData[field] !== undefined) {
          configSnapshot[field] = projectData[field]
        }
      }
      await sessionDoc.ref.update(configSnapshot)

      // Only add welcome if session has no messages yet (prevent duplicate on re-share)
      const existingMessages = await db
        .collection('messages')
        .where('session_id', '==', sessionDoc.id)
        .limit(1)
        .get()

      if (existingMessages.empty) {
        // Use admin-reviewed welcome message if available, otherwise generate one
        const welcomeText = (projectData.welcome_message as string) ||
          await generateWelcomeMessage(
            projectData.title as string,
            projectData.context as string | undefined
          )

        if (welcomeText) {
          const now = new Date().toISOString()
          await db.collection('messages').add({
            session_id: sessionDoc.id,
            role: 'agent',
            content: welcomeText,
            created_at: now,
            updated_at: now,
          })
        }
      }
    }
  } catch (err) {
    console.error('Failed to set up session:', err)
    // Don't break the share flow
  }

  return NextResponse.json({
    email: normalizedEmail,
    project_id,
  })
}
