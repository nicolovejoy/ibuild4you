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

// One outbound email target. `ref` is the member doc (null for the legacy
// requester_email fallback, where there's no membership row to mint against).
type Recipient = {
  email: string
  passcode: string | null
  ref: FirebaseFirestore.DocumentReference | null
}

// POST /api/projects/[id]/email — builder+ emails the maker(s) directly via
// Resend (invite / new-conversation nudge / reminder). To: maker, BCC +
// Reply-To: the builder, so a maker who replies reaches a human. Bodies/
// subjects come from lib/copy so the email matches what the builder sees in
// the UI. Invite and nudge fan out to every active maker on the brief (#115),
// one email per person; reminder stays a single send to the requester (the
// cron path owns multi-recipient reminders if we ever want them).
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
  // Optional single-recipient filter — the ShareModal's "Send to X" invite
  // targets one person; without it, invite/nudge go to every active maker.
  const onlyTo = typeof body.to === 'string' && body.to.trim() ? body.to.trim().toLowerCase() : null
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

  const requesterEmail = (project.requester_email as string | undefined)?.trim()

  // Resolve who gets this email.
  let recipients: Recipient[]
  if (kind === 'reminder') {
    recipients = requesterEmail ? [{ email: requesterEmail, passcode: null, ref: null }] : []
  } else {
    // Every active maker membership; briefs that predate participants[] may
    // have no member rows, so fall back to the legacy requester_email.
    const makerSnap = await db
      .collection('project_members')
      .where('project_id', '==', projectId)
      .where('role', '==', 'maker')
      .get()
    recipients = makerSnap.docs
      .filter((doc) => !doc.data().removed_at)
      .map((doc) => ({
        email: ((doc.data().email as string) || '').trim(),
        passcode: (doc.data().passcode as string | undefined) || null,
        ref: doc.ref,
      }))
      .filter((r) => r.email)
    if (recipients.length === 0 && requesterEmail) {
      recipients = [{ email: requesterEmail, passcode: null, ref: null }]
    }
  }
  if (onlyTo) {
    recipients = recipients.filter((r) => r.email.toLowerCase() === onlyTo)
    if (recipients.length === 0) {
      return NextResponse.json(
        { error: 'That person is not an active maker on this brief.' },
        { status: 400 }
      )
    }
  }
  if (recipients.length === 0) {
    return NextResponse.json(
      { error: 'This brief has no maker email to send to. Add one first.' },
      { status: 400 }
    )
  }

  const projectTitle = (project.title as string) || 'your brief'
  const shareLink = getServerShareLink((project.slug as string) || projectId)
  const now = new Date().toISOString()

  let subject: string
  // The nudge/reminder body is the same for everyone; the invite body is
  // per-recipient (their own email + passcode), built inside the send loop.
  let sharedText: string | null = null

  if (kind === 'invite') {
    subject = copy.email.subject.invite(projectTitle)
  } else if (kind === 'nudge') {
    subject = copy.email.subject.nudge(projectTitle)
    // Precedence: a saved nudge_message override wins verbatim; else the AI-prepped
    // nudge (slice 2); else the static template. The share link is appended the
    // same way in every case so it can't go stale.
    const override = (project.nudge_message as string | undefined)?.trim()
    const prepped = (project.prep_nudge as string | undefined)?.trim()
    const bodyText = override || prepped
    sharedText = bodyText
      ? [bodyText, '', shareLink].join('\n')
      : copy.nudge.body({
          projectTitle,
          shareLink,
          note,
          sessionMode: project.session_mode as 'discover' | 'converge' | undefined,
        })
  } else {
    subject = copy.email.subject.reminder(projectTitle)
    sharedText = copy.nudge.reminder({
      firstName: (project.requester_first_name as string | undefined) || null,
      sessionNumber: (project.session_count as number | undefined) ?? null,
      shareLink,
    })
  }

  // On preview/dev, don't email real makers while testing. Only actually send to
  // an allowlist (any @ibuild4you.com address + Nico's own); for everyone else
  // the session/activity still updates but the real send is suppressed.
  const isProd = process.env.VERCEL_ENV === 'production'
  const allowlisted = (email: string) =>
    email.endsWith('@ibuild4you.com') ||
    ['nlovejoy@me.com', 'nicholas.lovejoy@gmail.com'].includes(email.toLowerCase())

  const results: Array<{ to: string; emailId: string; suppressed: boolean }> = []
  for (const r of recipients) {
    let text: string
    if (kind === 'invite') {
      // The invite body includes the maker's sign-in passcode. Mint + persist
      // one if the membership doesn't have one yet (mirrors share GET).
      let passcode = r.passcode
      if (!passcode && r.ref) {
        passcode = generatePasscode()
        await r.ref.update({ passcode, updated_at: now })
      }
      text = copy.invite.body({ projectTitle, shareLink, email: r.email, passcode })
    } else {
      text = sharedText!
    }

    const suppressed = !isProd && !allowlisted(r.email)
    let emailId = 'suppressed'
    if (!suppressed) {
      ;({ emailId } = await sendMakerEmail({
        to: r.email,
        bcc: auth.email ? [auth.email] : undefined,
        replyTo: auth.email || undefined,
        subject,
        text,
      }))
    }
    results.push({ to: r.email, emailId, suppressed })

    console.log(
      JSON.stringify({
        event: 'maker_email_sent',
        project_id: projectId,
        kind,
        to: r.email,
        email_id: emailId,
        suppressed,
        by: auth.email,
      })
    )
  }

  // Stamp activity so the dashboard reflects the outbound touch.
  const update: Record<string, unknown> = { updated_at: now }
  if (kind === 'invite') {
    update.shared_at = now
  } else {
    update.last_nudged_at = now
  }
  await projectDoc.ref.update(update)

  return NextResponse.json({
    ok: true,
    results,
    to: results.map((r) => r.to),
    // true only when nothing actually went out (the all-suppressed preview case)
    suppressed: results.every((r) => r.suppressed),
  })
}
