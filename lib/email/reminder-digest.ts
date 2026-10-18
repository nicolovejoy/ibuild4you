import { textToEmailHtml } from '@/lib/email/html'
import { normalizeEmail } from '@/lib/email/normalize'
import { outboundCopy } from '@/lib/email/outbound-copy'
import type { Locale } from '@/lib/locale'

// Pure grouping + copy for the maker reminder cron (#141). A maker on N briefs
// used to get N near-identical reminder emails in one cron pass; we now group
// all of a maker's pending sends and emit ONE email. Kept free of Firestore /
// Resend so it can be exhaustively unit-tested.

// One decided send from the cron's decision pass (the pure inputs needed to
// render the email — bookkeeping like doc refs / counters stays in the route).
export interface PendingReminder {
  projectId: string
  makerEmail: string
  makerFirstName: string | null
  projectTitle: string
  shareLink: string
  sessionNumber: number | null
  reminderNumber: 1 | 2 | 3
  // The brief's language — the email is written in it.
  language: Locale
}

// All of one maker's pending reminders, addressed by lowercased email.
export interface MakerBatch {
  email: string
  firstName: string | null
  // Language of the whole email: the first item's (title order). A maker whose
  // briefs disagree gets one language, not a mixed digest.
  language: Locale
  items: PendingReminder[]
}

// Group pending sends by lowercased maker email. Batch order is stable (by
// email); items within a batch are ordered by project title. firstName is
// taken from the first item (in title order) that carries one; language from
// the first item.
export function groupReminderSends(items: PendingReminder[]): MakerBatch[] {
  const byEmail = new Map<string, PendingReminder[]>()
  for (const item of items) {
    const key = normalizeEmail(item.makerEmail)
    const bucket = byEmail.get(key)
    if (bucket) bucket.push(item)
    else byEmail.set(key, [item])
  }

  return [...byEmail.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([email, bucket]) => {
      const sorted = [...bucket].sort((a, b) => a.projectTitle.localeCompare(b.projectTitle))
      const firstName = sorted.find((i) => i.makerFirstName)?.makerFirstName ?? null
      return { email, firstName, language: sorted[0].language, items: sorted }
    })
}

// Single-brief body is byte-identical to the pre-#141 reminder email: the
// shared #21 reminder copy plus the minimal sign-off.
function singleBriefBody(batch: MakerBatch): string {
  const item = batch.items[0]
  const oc = outboundCopy[batch.language]
  return [
    oc.nudge.reminder({
      firstName: item.makerFirstName,
      sessionNumber: item.sessionNumber,
      shareLink: item.shareLink,
    }),
    '',
    ...oc.signOff,
  ].join('\n')
}

function multiBriefBody(batch: MakerBatch): string {
  const oc = outboundCopy[batch.language]
  const lines = batch.items.map((item) =>
    oc.digest.line({
      projectTitle: item.projectTitle,
      sessionNumber: item.sessionNumber,
      shareLink: item.shareLink,
    }),
  )
  return [oc.digest.lead(batch.firstName), '', ...lines, '', ...oc.signOff].join('\n')
}

// Build the subject + text + html for one maker's batch. 1 brief → today's
// exact copy (so single-brief behavior is unchanged); 2+ → a digest with one
// line per brief. The html is derived from the text so links are clickable.
export function buildReminderEmail(batch: MakerBatch): {
  subject: string
  text: string
  html: string
} {
  const oc = outboundCopy[batch.language]
  if (batch.items.length === 1) {
    const text = singleBriefBody(batch)
    return {
      subject: oc.subject.reminder(batch.items[0].projectTitle),
      text,
      html: textToEmailHtml(text),
    }
  }

  const text = multiBriefBody(batch)
  return {
    subject: oc.digest.subject(batch.items.length),
    text,
    html: textToEmailHtml(text),
  }
}
