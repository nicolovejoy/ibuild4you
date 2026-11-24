// Emails project members send to a project's address (email-in), stored in the
// top-level, server-only project_emails collection, and the counters kept for
// mail that was dropped. Nothing here logs an email's text or subject.

import { FieldValue, type Firestore } from 'firebase-admin/firestore'
import type { ProjectEmail } from '@/lib/types'

// Stored text is cut to this many characters, from the end (the end of an
// email is the oldest quoted history). The webhook route does the cut.
export const EMAIL_TEXT_MAX = 50_000

// Flood guard: a project accepts at most this many emails in any 24 hours.
export const EMAILS_PER_DAY_MAX = 50
const DAY_MS = 24 * 60 * 60 * 1000

export type DropReason = 'not_member' | 'auth_failed' | 'over_limit'

function emailsRef(db: Firestore) {
  return db.collection('project_emails')
}

// One email CC'd to two projects is stored once for each.
export function projectEmailDocId(emailId: string, projectId: string): string {
  return `${emailId}_${projectId}`
}

// A create() on a doc that exists, alone or in a batch, fails with gRPC
// ALREADY_EXISTS (6).
function isAlreadyExists(err: unknown): boolean {
  const code = (err as { code?: unknown } | null)?.code
  return code === 6 || code === 'already-exists'
}

// How many emails the project accepted in the 24 hours up to `at`. A single
// equality filter (no composite index, as with build reports), reading only
// received_at so the count does not pull every stored text; the window is
// applied here in memory.
async function countRecent(db: Firestore, projectId: string, at: string): Promise<number> {
  const since = Date.parse(at) - DAY_MS
  const snap = await emailsRef(db).where('project_id', '==', projectId).select('received_at').get()
  return snap.docs.filter((d) => {
    const receivedAt = Date.parse(String(d.data().received_at ?? ''))
    return receivedAt > since
  }).length
}

// Stores an accepted email, create-if-absent. A retried webhook for an email
// already stored is 'duplicate' and changes nothing: it does not move
// received_at or last_email_at, and it is checked before the flood guard so a
// retry never reads as 'over_limit' (which the route would count as a drop).
//
// The email and the project's last_email_at go in one batch, so either both
// are written or neither is. Were they two writes, a failed second one would
// leave the email stored with no last_email_at; Resend's retry would then read
// 'duplicate' and the cron would never pick the email up. Any commit error
// other than already-exists (a missing project included) rethrows with
// nothing stored, so the route answers 500 and the retry starts clean.
//
// The existence check, the count and the commit are not one transaction, so
// two deliveries racing can both pass the guard; the batch's create still
// stores the email only once, and the loser's commit applies nothing.
export async function storeProjectEmail(
  db: Firestore,
  emailId: string,
  email: Omit<ProjectEmail, 'id'>
): Promise<'stored' | 'duplicate' | 'over_limit'> {
  const ref = emailsRef(db).doc(projectEmailDocId(emailId, email.project_id))
  if ((await ref.get()).exists) return 'duplicate'

  // The window ends at this email's received_at: the app's clock when the
  // route stores it (read once per webhook), not Resend's time.
  if ((await countRecent(db, email.project_id, email.received_at)) >= EMAILS_PER_DAY_MAX) {
    return 'over_limit'
  }

  const batch = db.batch()
  batch.create(ref, email)
  batch.update(db.collection('projects').doc(email.project_id), {
    last_email_at: email.received_at,
  })
  try {
    await batch.commit()
  } catch (err) {
    if (isAlreadyExists(err)) return 'duplicate'
    throw err
  }
  return 'stored'
}

// Counts a dropped email on the project. Nothing of its content is kept. Only
// for auth_failed is an address kept: the claimed sender is then a member's
// own address, and it tells the builder whose mail is being refused. A
// non-member's address is never stored, so fromEmail is ignored otherwise.
export async function recordDrop(
  db: Firestore,
  projectId: string,
  reason: DropReason,
  fromEmail?: string
): Promise<void> {
  const patch: Record<string, unknown> = {
    [`email_in_dropped.${reason}`]: FieldValue.increment(1),
    'email_in_dropped.last_at': new Date().toISOString(),
  }
  if (reason === 'auth_failed' && fromEmail) {
    patch['email_in_dropped.last_auth_failed_from'] = fromEmail
  }
  await db.collection('projects').doc(projectId).update(patch)
}

// All of a project's emails, oldest first by received_at. Single equality
// filter, ordered in memory (no composite index).
export async function listProjectEmails(db: Firestore, projectId: string): Promise<ProjectEmail[]> {
  const snap = await emailsRef(db).where('project_id', '==', projectId).get()
  return snap.docs
    .map((d) => ({ ...(d.data() as Omit<ProjectEmail, 'id'>), id: d.id }))
    .sort((a, b) => a.received_at.localeCompare(b.received_at))
}
