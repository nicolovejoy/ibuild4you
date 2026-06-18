import { NextResponse } from 'next/server'
import {
  getAuthenticatedUser,
  getAdminDb,
  getProjectRole,
  requireRole,
} from '@/lib/api/firebase-server-helpers'
import { sendMakerEmail } from '@/lib/email/send-maker-email'
import { getServerShareLink } from '@/lib/url'
import { generatePasscode } from '@/lib/passcode'
import { copy } from '@/lib/copy'

const KINDS = ['invite', 'nudge', 'reminder'] as const
type EmailKind = (typeof KINDS)[number]

// POST /api/projects/[id]/email — builder+ emails the maker directly via Resend
// (invite / new-conversation nudge / reminder). To: maker, BCC + Reply-To: the
// builder, so a maker who replies reaches a human. Bodies/subjects come from
// lib/copy so the email matches what the builder sees in the UI.
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await getAuthenticatedUser(request)
  if (auth.error) return auth.error

  const { id: projectId } = await params
  if (!projectId) {
    return NextResponse.json({ error: 'project id is required' }, { status: 400 })
  }

  const body = await request.json().catch(() => ({}))
  const kind = body.kind as EmailKind
  const note = typeof body.note === 'string' && body.note.trim() ? body.note.trim() : undefined
  if (!KINDS.includes(kind)) {
    return NextResponse.json({ error: 'invalid kind' }, { status: 400 })
  }

  const db = getAdminDb()
  const callerRole = await getProjectRole(db, projectId, auth.uid, auth.email, auth.systemRoles, auth)
  const roleCheck = requireRole(callerRole, 'builder')
  if (roleCheck) return roleCheck

  const projectDoc = await db.collection('projects').doc(projectId).get()
  if (!projectDoc.exists) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }
  const project = projectDoc.data()!

  const to = (project.requester_email as string | undefined)?.trim()
  if (!to) {
    return NextResponse.json(
      { error: 'This brief has no maker email to send to. Add one first.' },
      { status: 400 }
    )
  }

  const projectTitle = (project.title as string) || 'your brief'
  const shareLink = getServerShareLink((project.slug as string) || projectId)

  let subject: string
  let text: string

  if (kind === 'invite') {
    // The invite body includes the maker's sign-in passcode. Resolve it from the
    // maker membership (mint + persist one if missing, mirroring share GET).
    const memberSnap = await db
      .collection('project_members')
      .where('project_id', '==', projectId)
      .where('role', '==', 'maker')
      .limit(1)
      .get()
    let passcode: string | null = null
    if (!memberSnap.empty) {
      const memberDoc = memberSnap.docs[0]
      passcode = (memberDoc.data().passcode as string | undefined) || null
      if (!passcode) {
        passcode = generatePasscode()
        await memberDoc.ref.update({ passcode, updated_at: new Date().toISOString() })
      }
    }
    subject = copy.email.subject.invite(projectTitle)
    text = copy.invite.body({ projectTitle, shareLink, email: to, passcode })
  } else if (kind === 'nudge') {
    subject = copy.email.subject.nudge(projectTitle)
    // Mirror the builder UI: a saved nudge_message override is sent verbatim
    // (with the link appended); otherwise build the boilerplate nudge.
    const override = (project.nudge_message as string | undefined)?.trim()
    text = override
      ? [override, '', shareLink].join('\n')
      : copy.nudge.body({
          projectTitle,
          shareLink,
          note,
          sessionMode: project.session_mode as 'discover' | 'converge' | undefined,
        })
  } else {
    subject = copy.email.subject.reminder(projectTitle)
    text = copy.nudge.reminder({ projectTitle, shareLink })
  }

  // On preview/dev, don't email real makers while testing. Only actually send to
  // an allowlist (any @ibuild4you.com address + Nico's own); for everyone else
  // the session/activity still updates but the real send is suppressed.
  const isProd = process.env.VERCEL_ENV === 'production'
  const allowlisted =
    to.endsWith('@ibuild4you.com') ||
    ['nlovejoy@me.com', 'nicholas.lovejoy@gmail.com'].includes(to.toLowerCase())
  const suppressed = !isProd && !allowlisted

  let emailId = 'suppressed'
  if (!suppressed) {
    ;({ emailId } = await sendMakerEmail({
      to,
      bcc: auth.email ? [auth.email] : undefined,
      replyTo: auth.email || undefined,
      subject,
      text,
    }))
  }

  // Stamp activity so the dashboard reflects the outbound touch.
  const now = new Date().toISOString()
  const update: Record<string, unknown> = { updated_at: now }
  if (kind === 'invite') {
    update.shared_at = now
  } else {
    update.last_nudged_at = now
  }
  await projectDoc.ref.update(update)

  console.log(
    JSON.stringify({
      event: 'maker_email_sent',
      project_id: projectId,
      kind,
      to,
      email_id: emailId,
      suppressed,
      by: auth.email,
    })
  )

  return NextResponse.json({ ok: true, emailId, to, suppressed })
}
