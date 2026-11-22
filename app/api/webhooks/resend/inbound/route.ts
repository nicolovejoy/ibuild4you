import { NextResponse } from 'next/server'
import { Webhook, WebhookVerificationError } from 'svix'
import type { DocumentReference, Firestore } from 'firebase-admin/firestore'
import { getAdminDb } from '@/lib/firebase/admin'
import { buildInboundReply, findFeedbackIdInRecipients } from '@/lib/feedback/inbound'
import { normalizeEmail } from '@/lib/email/normalize'
import { formatDisplayName } from '@/lib/copy'
import { fetchReceivedEmail, type ReceivedEmail } from '@/lib/email/resend-received'
import { projectAddressesIn } from '@/lib/email-in/address'
import { checkSender, type SenderCheck, type SenderMember } from '@/lib/email-in/sender'
import { loadSenderMembers, type EmailProject } from '@/lib/email-in/members'
import { EMAIL_TEXT_MAX, recordDrop, storeProjectEmail } from '@/lib/email-in/store'

// =============================================================================
// POST /api/webhooks/resend/inbound — receives Resend's `email.received`
// webhook. Verifies the Svix signature, then routes the email two ways:
//
//   - Loop replies: a plus-addressed recipient
//     (`feedback+<id>@inbox.ibuild4you.com`) appends to the
//     feedback/{id}/replies subcollection.
//   - Email-in: a project's own address (projects.email_in_address) on To,
//     CC or BCC stores the email in project_emails, when the sender is an
//     active member of that project and the mail passes DMARC. Anything else
//     is only counted on the project (email_in_dropped), with no content.
//
// One email can match both, and several projects.
//
// Trust model:
//   - Without a valid signature, NOTHING is written. The signature is the
//     only thing standing between this endpoint and forged "submitter said
//     X" replies or forged project emails — keep it strict.
//   - Every field of the webhook and of the fetched email is untrusted and
//     may be of the wrong type; each one is checked before use.
//   - We respond 200 to most "couldn't-route-this" cases so Resend doesn't
//     retry forever. The exception: when a project matched but the email
//     could not be fetched, we answer 500 and write nothing, so Resend
//     retries the whole email.
//   - Logs carry ids, counts and reasons only: never an address, a subject
//     or a body.
// =============================================================================

// Resend's webhook envelope, as recorded on 2026-11-20 (the fixture
// __tests__/fixtures/email-received.json). Every field is typed unknown: the
// shape is not trusted, and each field is checked where it is read.
//   data.received_for, to, cc, bcc: arrays of bare addresses (the top-level
//     to and cc are not the sender's header lines)
//   data.from: a bare address
//   data.email_id, subject, message_id, created_at: strings
interface ResendWebhookEnvelope {
  type?: unknown
  created_at?: unknown
  data?: unknown
}

interface ResendReceivedData {
  email_id?: unknown
  created_at?: unknown
  from?: unknown
  to?: unknown
  cc?: unknown
  bcc?: unknown
  received_for?: unknown
  subject?: unknown
  message_id?: unknown
  attachments?: unknown
}

type ProjectOutcome = 'stored' | 'duplicate' | 'not_member' | 'auth_failed' | 'over_limit'

// Resend's email ids are UUIDs. The id goes into a fetch URL and a Firestore
// document id, so anything else (a slash would make a nested path) is treated
// as no id at all. A bad or missing id is permanent, so it answers 200: a 500
// would only make Resend retry it for nothing.
const EMAIL_ID_SHAPE = /^[A-Za-z0-9_-]{1,128}$/

// Each project address is one Firestore query, so an email naming many
// inbox-host addresses (guesses, a long CC list) is looked up for the first
// ones only; the rest are ignored.
const MAX_PROJECT_ADDRESSES = 10

// A project the email is addressed to, with the requester fields that can
// name a member who has never signed in (they come with the lookup, no read).
type MatchedProject = EmailProject

export async function POST(request: Request) {
  const secret = process.env.RESEND_INBOUND_SECRET
  if (!secret) {
    console.error('[resend-inbound] RESEND_INBOUND_SECRET is not set; refusing all inbound')
    return NextResponse.json({ error: 'Not configured' }, { status: 500 })
  }

  // Svix verification requires the EXACT raw bytes of the request body.
  // Don't .json() first — even a re-serialize will fail the signature.
  const rawBody = await request.text()
  const svixHeaders = {
    'svix-id': request.headers.get('svix-id') ?? '',
    'svix-timestamp': request.headers.get('svix-timestamp') ?? '',
    'svix-signature': request.headers.get('svix-signature') ?? '',
  }

  let payload: ResendWebhookEnvelope
  try {
    const wh = new Webhook(secret)
    const verified = wh.verify(rawBody, svixHeaders)
    payload = isObject(verified) ? (verified as ResendWebhookEnvelope) : {}
  } catch (err) {
    if (err instanceof WebhookVerificationError) {
      return NextResponse.json({ error: 'Invalid signature' }, { status: 401 })
    }
    console.error('[resend-inbound] verification error:', err)
    return NextResponse.json({ error: 'Verification failed' }, { status: 401 })
  }

  // Only react to inbound mail. Other event types (delivered, bounced, etc.)
  // are ack'd 200 so Resend doesn't retry. They're not errors — they're
  // just not interesting here.
  if (payload.type !== 'email.received') {
    const ignored = typeof payload.type === 'string' ? payload.type : 'unknown'
    return NextResponse.json({ ok: true, ignored })
  }

  const data: ResendReceivedData = isObject(payload.data) ? payload.data : {}
  const emailId =
    typeof data.email_id === 'string' && EMAIL_ID_SHAPE.test(data.email_id) ? data.email_id : ''
  const db = getAdminDb()

  // Find both kinds of match from the webhook body before fetching anything.
  const feedbackId = findFeedbackIdInRecipients(recipients(data.to))
  let feedback: { id: string; ref: DocumentReference } | null = null
  if (feedbackId) {
    const ref = db.collection('feedback').doc(feedbackId)
    if ((await ref.get()).exists) feedback = { id: feedbackId, ref }
    else console.warn('[resend-inbound] feedback doc not found for id:', feedbackId)
  }
  const addresses = projectAddressesIn([
    recipients(data.received_for),
    recipients(data.to),
    recipients(data.cc),
    recipients(data.bcc),
  ])
  const projects = await findProjects(db, addresses.slice(0, MAX_PROJECT_ADDRESSES))

  if (!feedback && projects.length === 0) {
    const ignored = feedbackId
      ? 'feedback-not-found'
      : addresses.length
        ? 'no-project'
        : 'no-feedback-id'
    if (ignored !== 'feedback-not-found')
      console.warn('[resend-inbound] no recipient matched:', ignored)
    return NextResponse.json({ ok: true, ignored })
  }

  // The fetch-failure line serves both branches; `projects` and `loop` say
  // which one it held up (a Loop-only failure has projects 0).
  const fetchFailedFields = { projects: projects.length, loop: feedback !== null }

  // No usable id: nothing can be fetched now or on a retry. The id itself is
  // untrusted text, so it is not logged. The project branch writes nothing;
  // a Loop reply still gets its placeholder.
  if (!emailId) {
    console.warn(
      JSON.stringify({ event: 'email_in_fetch_failed', reason: 'bad_email_id', ...fetchFailedFields })
    )
    if (!feedback) return NextResponse.json({ ok: true, ignored: 'bad-email-id' })
    await writeLoopReply(feedback.ref, feedback.id, null, data)
    return NextResponse.json({ ok: true, feedback_id: feedback.id })
  }

  // The webhook ships metadata only; fetch the body, headers and DMARC once.
  const email = await fetchReceivedEmail(emailId)
  if (!email) {
    console.warn(
      JSON.stringify({
        event: 'email_in_fetch_failed',
        email_id: emailId,
        reason: 'fetch_failed',
        ...fetchFailedFields,
      })
    )
    // A project email must not be lost: write nothing (not the Loop reply
    // either) and let Resend retry the whole email.
    if (projects.length > 0) {
      return NextResponse.json({ error: 'Could not fetch the email' }, { status: 500 })
    }
  }

  // Project emails first, the Loop reply last: the store is idempotent, so a
  // retry after a failure part-way never writes a second Loop reply.
  //
  // received_at is the app's own clock, read once, just before the first store,
  // and shared by every project the email is stored for. Not Resend's
  // created_at: an email stored late (Resend retries a 500 for hours) must
  // still sort after anything a note has covered since, or no note would ever
  // read it.
  const projectEmails: Array<{ project_id: string; outcome: ProjectOutcome }> = []
  if (email) {
    let receivedAt: string | null = null
    const storeTime = () => (receivedAt ??= new Date().toISOString())
    for (const project of projects) {
      const outcome = await handleProjectEmail(db, project, emailId, email, storeTime)
      projectEmails.push({ project_id: project.id, outcome })
    }
  }

  if (feedback) {
    await writeLoopReply(feedback.ref, feedback.id, email, data)
    return NextResponse.json({
      ok: true,
      feedback_id: feedback.id,
      ...(projectEmails.length > 0 && { project_emails: projectEmails }),
    })
  }
  return NextResponse.json({ ok: true, project_emails: projectEmails })
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

// A recipient field as the shapes the address helpers take: a string or a
// list of strings. Anything else is no recipients.
function recipients(value: unknown): string | string[] | undefined {
  if (typeof value === 'string') return value
  if (Array.isArray(value)) return value.filter((v): v is string => typeof v === 'string')
  return undefined
}

// The projects holding any of these addresses, each once.
async function findProjects(db: Firestore, addresses: string[]): Promise<MatchedProject[]> {
  const found = new Map<string, MatchedProject>()
  for (const address of addresses) {
    const snap = await db
      .collection('projects')
      .where('email_in_address', '==', address)
      .limit(1)
      .get()
    for (const doc of snap.docs) {
      const d = doc.data()
      const str = (v: unknown) => (typeof v === 'string' ? v : undefined)
      found.set(doc.id, {
        id: doc.id,
        requester_email: normalizeEmail(str(d.requester_email) ?? ''),
        requester_name: formatDisplayName(str(d.requester_first_name), str(d.requester_last_name)),
      })
    }
  }
  return [...found.values()]
}

// Who sent it, failing closed. The strict parser in checkSender reads the raw
// From header, and only that: with no header string (none at all, or an
// array for two From headers) the email is from a non-member. Resend's
// top-level from is an address it parsed itself, and DMARC was checked for
// that one, so the two must also agree, or the email is treated as from a
// non-member (and no address is kept).
function checkEmailSender(email: ReceivedEmail, members: SenderMember[]): SenderCheck {
  if (email.header_from === null) return { ok: false, reason: 'not_member' }
  const check = checkSender({ from: email.header_from, dmarc: email.dmarc, members })
  if (
    (check.ok || check.reason === 'auth_failed') &&
    check.from_email !== normalizeEmail(email.from)
  ) {
    return { ok: false, reason: 'not_member' }
  }
  return check
}

// The first EMAIL_TEXT_MAX characters (the end of an email is the oldest
// quoted history). A cut that would split a surrogate pair stops one short.
function cutText(text: string): { text: string; truncated: boolean } {
  if (text.length <= EMAIL_TEXT_MAX) return { text, truncated: false }
  let end = EMAIL_TEXT_MAX
  const last = text.charCodeAt(end - 1)
  if (last >= 0xd800 && last <= 0xdbff) end--
  return { text: text.slice(0, end), truncated: true }
}

// Check the sender against this project's members and store the email, or
// count the drop. Logs one line with ids and the outcome only. `storeTime`
// gives the webhook's one received_at (read on its first call).
async function handleProjectEmail(
  db: Firestore,
  project: MatchedProject,
  emailId: string,
  email: ReceivedEmail,
  storeTime: () => string
): Promise<ProjectOutcome> {
  const projectId = project.id
  const check = checkEmailSender(email, await loadSenderMembers(db, project))

  let outcome: ProjectOutcome
  if (check.ok) {
    const { text, truncated } = cutText(email.text)
    outcome = await storeProjectEmail(db, emailId, {
      project_id: projectId,
      from_email: check.from_email,
      from_name: check.from_name,
      from_role: check.from_role,
      received_at: storeTime(),
      sent_at: email.sent_at,
      subject: email.subject,
      message_id: email.message_id,
      text,
      truncated,
      attachments: email.attachments,
    })
  } else {
    outcome = check.reason
  }

  if (outcome === 'stored' || outcome === 'duplicate') {
    console.log(
      JSON.stringify({
        event: 'email_in_accepted',
        project_id: projectId,
        email_id: emailId,
        reason: outcome,
      })
    )
  } else {
    // Only an auth_failed check carries an address: the claimed sender is a
    // member, and the builder needs to know whose mail is being refused.
    const fromEmail = !check.ok && check.reason === 'auth_failed' ? check.from_email : undefined
    await recordDrop(db, projectId, outcome, fromEmail)
    console.log(
      JSON.stringify({
        event: 'email_in_dropped',
        project_id: projectId,
        email_id: emailId,
        reason: outcome,
      })
    )
  }
  return outcome
}

// Append the Loop reply and bump the feedback row. When the email could not
// be fetched, or has no text, the reply still gets written with a placeholder
// body so the admin sees that a reply arrived and can dig in via the Resend
// dashboard.
async function writeLoopReply(
  feedbackRef: DocumentReference,
  feedbackId: string,
  email: ReceivedEmail | null,
  data: ResendReceivedData
): Promise<void> {
  const subject = typeof data.subject === 'string' ? data.subject : ''
  let body: string
  if (!email) body = placeholderBody(subject, 'could not fetch the email from Resend')
  else if (!email.text.trim()) body = placeholderBody(subject, 'no text or html in response')
  else body = email.text

  const fromEmail = normalizeEmail(typeof data.from === 'string' ? data.from : '')
  const reply = buildInboundReply({ feedbackId, fromEmail, body })

  await feedbackRef.collection('replies').add(reply)

  // Bump the parent feedback's status back to 'new' so the row resurfaces in
  // the admin's default filter, plus refresh updated_at for sort order. A reply
  // also unarchives the row (#232), since archived rows are hidden from the inbox.
  await feedbackRef.update({
    status: 'new',
    archived_at: null,
    updated_at: new Date().toISOString(),
  })
}

function placeholderBody(subject: string, reason: string): string {
  return `[Reply received — body retrieval failed: ${reason}]\nSubject: ${subject}`
}
