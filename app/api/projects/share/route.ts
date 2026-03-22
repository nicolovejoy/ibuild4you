import { NextResponse } from 'next/server'
import {
  getAuthenticatedUser,
  getAdminDb,
  getProjectRole,
  requireRole,
} from '@/lib/api/firebase-server-helpers'
import { generateWelcomeMessage } from '@/lib/agent/welcome-message'
import crypto from 'crypto'

function generatePasscode(): string {
  return crypto.randomBytes(4).toString('base64url').slice(0, 6).toUpperCase()
}

// POST /api/projects/share — share a project with a maker (builder+)
export async function POST(request: Request) {
  const auth = await getAuthenticatedUser(request)
  if (auth.error) return auth.error

  const body = await request.json()
  const { project_id, email, role: memberRole } = body

  if (!project_id || !email?.trim()) {
    return NextResponse.json(
      { error: 'project_id and email are required' },
      { status: 400 }
    )
  }

  const db = getAdminDb()

  const callerRole = await getProjectRole(db, project_id, auth.uid, auth.email)
  const roleCheck = requireRole(callerRole, 'builder')
  if (roleCheck) return roleCheck

  const normalizedEmail = email.trim().toLowerCase()

  // Verify project exists
  const projectDoc = await db.collection('projects').doc(project_id).get()
  if (!projectDoc.exists) {
    return NextResponse.json({ error: 'Project not found' }, { status: 404 })
  }

  const projectData = projectDoc.data()!
  const now = new Date().toISOString()

  // Add email to approved_emails so they can sign in
  await db.collection('approved_emails').doc(normalizedEmail).set({
    email: normalizedEmail,
    approved_by: auth.email,
    created_at: now,
  })

  // Create or update project_members record
  const assignedRole = memberRole || 'maker'
  const passcode = generatePasscode()

  const existingMember = await db
    .collection('project_members')
    .where('project_id', '==', project_id)
    .where('email', '==', normalizedEmail)
    .limit(1)
    .get()

  if (existingMember.empty) {
    await db.collection('project_members').add({
      project_id,
      user_id: '', // will be set on claim
      email: normalizedEmail,
      role: assignedRole,
      passcode,
      added_by: auth.email,
      created_at: now,
      updated_at: now,
    })
  } else {
    // Update role and regenerate passcode if re-sharing
    await existingMember.docs[0].ref.update({
      role: assignedRole,
      passcode,
      updated_at: now,
    })
  }

  // Keep requester_email on the project as convenience (for dashboard display)
  await db.collection('projects').doc(project_id).update({
    requester_email: normalizedEmail,
    updated_at: now,
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
      const configSnapshot: Record<string, unknown> = { updated_at: now }
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
    passcode,
  })
}

// GET /api/projects/share?project_id=X — get passcode for the maker member (builder+)
export async function GET(request: Request) {
  const auth = await getAuthenticatedUser(request)
  if (auth.error) return auth.error

  const { searchParams } = new URL(request.url)
  const project_id = searchParams.get('project_id')

  if (!project_id) {
    return NextResponse.json({ error: 'project_id is required' }, { status: 400 })
  }

  const db = getAdminDb()

  const callerRole = await getProjectRole(db, project_id, auth.uid, auth.email)
  const roleCheck = requireRole(callerRole, 'builder')
  if (roleCheck) return roleCheck

  // Find the maker member for this project
  const memberSnap = await db
    .collection('project_members')
    .where('project_id', '==', project_id)
    .where('role', '==', 'maker')
    .limit(1)
    .get()

  if (memberSnap.empty) {
    return NextResponse.json({ error: 'No maker found for this project' }, { status: 404 })
  }

  const memberDoc = memberSnap.docs[0]
  const member = memberDoc.data()

  // Auto-generate passcode for pre-existing shares that don't have one
  if (!member.passcode) {
    const passcode = generatePasscode()
    await memberDoc.ref.update({ passcode, updated_at: new Date().toISOString() })
    return NextResponse.json({ passcode })
  }

  return NextResponse.json({ passcode: member.passcode })
}

// PATCH /api/projects/share — reset passcode for the maker member (builder+)
export async function PATCH(request: Request) {
  const auth = await getAuthenticatedUser(request)
  if (auth.error) return auth.error

  const body = await request.json()
  const { project_id } = body

  if (!project_id) {
    return NextResponse.json({ error: 'project_id is required' }, { status: 400 })
  }

  const db = getAdminDb()

  const callerRole = await getProjectRole(db, project_id, auth.uid, auth.email)
  const roleCheck = requireRole(callerRole, 'builder')
  if (roleCheck) return roleCheck

  // Find the maker member for this project
  const memberSnap = await db
    .collection('project_members')
    .where('project_id', '==', project_id)
    .where('role', '==', 'maker')
    .limit(1)
    .get()

  if (memberSnap.empty) {
    return NextResponse.json({ error: 'No maker found for this project' }, { status: 404 })
  }

  const newPasscode = generatePasscode()
  await memberSnap.docs[0].ref.update({
    passcode: newPasscode,
    updated_at: new Date().toISOString(),
  })

  return NextResponse.json({ passcode: newPasscode })
}
