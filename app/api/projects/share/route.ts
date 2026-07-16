import { NextResponse } from 'next/server'
import {
  getAuthenticatedUser,
  getAdminDb,
  getProjectRole,
  requireRole,
} from '@/lib/api/firebase-server-helpers'
import { generateWelcomeMessage } from '@/lib/agent/welcome-message'
import { resolveBriefRole } from '@/lib/roles/brief-role'
import { copy } from '@/lib/copy'
import { generatePasscode } from '@/lib/passcode'
import { normalizeEmail } from '@/lib/email/normalize'
import { ensureInviteResetLink } from '@/lib/auth/ensure-invite-account'
import { scheduleGarmGrantSync } from '@/lib/garm-grants'

// POST /api/projects/share — share a project with a maker (builder+)
export async function POST(request: Request) {
  const auth = await getAuthenticatedUser(request)
  if (auth.error) return auth.error

  const body = await request.json()
  const { project_id, email, role: memberRole, brief_role, first_name, last_name } = body

  if (!project_id || !email?.trim()) {
    return NextResponse.json(
      { error: 'project_id and email are required' },
      { status: 400 }
    )
  }

  const db = getAdminDb()

  const callerRole = await getProjectRole(db, project_id, auth.uid, auth.email, auth.systemRoles, auth)
  const roleCheck = requireRole(callerRole, 'builder')
  if (roleCheck) return roleCheck

  const normalizedEmail = normalizeEmail(email)

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
  const assignedBriefRole = resolveBriefRole(brief_role, assignedRole)
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
      brief_role: assignedBriefRole,
      passcode,
      added_by: auth.email,
      created_at: now,
      updated_at: now,
    })
  } else {
    // Update role and regenerate passcode if re-sharing
    await existingMember.docs[0].ref.update({
      role: assignedRole,
      brief_role: assignedBriefRole,
      passcode,
      updated_at: now,
    })
  }

  // Keep requester info on the project for dashboard display. The project doc
  // holds ONE requester (the originator) — inviting a second person must NOT
  // clobber it. Only stamp requester_email/shared_at on the first share, or
  // when re-sharing the same person. Additional invitees live solely as
  // project_members rows (created above); the multi-human roster reads from
  // there, not from project.requester_email.
  const existingRequester = normalizeEmail(projectData.requester_email as string | undefined) || undefined
  const isFirstShare = !existingRequester
  const isSameRequester = existingRequester === normalizedEmail
  const projectUpdate: Record<string, unknown> = { updated_at: now }
  if (isFirstShare) {
    projectUpdate.requester_email = normalizedEmail
    projectUpdate.shared_at = now
  }
  if (isFirstShare || isSameRequester) {
    if (first_name) projectUpdate.requester_first_name = first_name.trim()
    if (last_name) projectUpdate.requester_last_name = last_name.trim()
  }
  await db.collection('projects').doc(project_id).update(projectUpdate)

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
      const configFields = ['session_mode', 'seed_questions', 'builder_directives', 'welcome_message'] as const
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
            projectData.context as string | undefined,
            undefined,
            { project_id }
          ) ||
          copy.chat.defaultWelcomeMessage(projectData.title as string)

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

  // Garm consumer plan Phase 1 / PR A: mint a password-setup link alongside
  // the passcode. Additive/reversible — passcode still works, this just gives
  // the "copy invite message" UI a link-first body to hand the maker instead.
  const resetLink = await ensureInviteResetLink(normalizedEmail)

  // Garm dual-write (Phase 4): this invite/re-share just created or updated a
  // project_members row for normalizedEmail — recompute + upsert their grant.
  scheduleGarmGrantSync(normalizedEmail)

  return NextResponse.json({
    email: normalizedEmail,
    project_id,
    passcode,
    reset_link: resetLink,
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

  const callerRole = await getProjectRole(db, project_id, auth.uid, auth.email, auth.systemRoles, auth)
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
  const { project_id, new_email } = body

  if (!project_id) {
    return NextResponse.json({ error: 'project_id is required' }, { status: 400 })
  }

  const db = getAdminDb()

  const callerRole = await getProjectRole(db, project_id, auth.uid, auth.email, auth.systemRoles, auth)
  const roleCheck = requireRole(callerRole, 'builder')
  if (roleCheck) return roleCheck

  // Email re-key path (#12): correct the originator's email across the three
  // coupled records — project.requester_email (display), the project_members
  // row (maker auth), and approved_emails (sign-in gate) — and reissue a
  // passcode so any invite that went to the wrong (typo'd) address stops
  // working. The old approved_emails entry is left in place: it may be in use
  // on other briefs, and removing it would risk locking someone else out.
  if (typeof new_email === 'string' && new_email.trim()) {
    return rekeyRequesterEmail(db, project_id, new_email, auth.email)
  }

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

async function rekeyRequesterEmail(
  db: FirebaseFirestore.Firestore,
  project_id: string,
  rawEmail: string,
  actorEmail: string
) {
  const normalizedEmail = normalizeEmail(rawEmail)
  const projectRef = db.collection('projects').doc(project_id)
  const projectDoc = await projectRef.get()
  if (!projectDoc.exists) {
    return NextResponse.json({ error: 'Project not found' }, { status: 404 })
  }
  const oldEmail = normalizeEmail(projectDoc.data()?.requester_email as string | undefined) || undefined
  const now = new Date().toISOString()

  // Approve the new email for sign-in (old one left in place — see PATCH note).
  await db.collection('approved_emails').doc(normalizedEmail).set({
    email: normalizedEmail,
    approved_by: actorEmail,
    created_at: now,
  })

  // Re-key the originator's membership row + reissue a passcode. Match by their
  // current email first; fall back to the maker role for legacy rows.
  const passcode = generatePasscode()
  let memberSnap = oldEmail
    ? await db
        .collection('project_members')
        .where('project_id', '==', project_id)
        .where('email', '==', oldEmail)
        .limit(1)
        .get()
    : ({ empty: true } as FirebaseFirestore.QuerySnapshot)
  if (memberSnap.empty) {
    memberSnap = await db
      .collection('project_members')
      .where('project_id', '==', project_id)
      .where('role', '==', 'maker')
      .limit(1)
      .get()
  }
  if (!memberSnap.empty) {
    await memberSnap.docs[0].ref.update({ email: normalizedEmail, passcode, updated_at: now })
  }

  await projectRef.update({ requester_email: normalizedEmail, updated_at: now })

  // Garm dual-write: the membership row moved from oldEmail to normalizedEmail.
  // Sync both — the new email needs its grant upserted, and the old email's
  // role may have just dropped (it could still hold grants via other briefs
  // or its own approved_emails row, which this rekey never removes).
  scheduleGarmGrantSync(normalizedEmail)
  if (oldEmail) scheduleGarmGrantSync(oldEmail)

  return NextResponse.json({ email: normalizedEmail, passcode })
}
