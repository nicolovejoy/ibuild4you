import { copy } from '@/lib/copy'
import { normalizeEmail } from '@/lib/email/normalize'

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
}

// All of one maker's pending reminders, addressed by lowercased email.
export interface MakerBatch {
  email: string
  firstName: string | null
  items: PendingReminder[]
}

// Group pending sends by lowercased maker email. Batch order is stable (by
// email); items within a batch are ordered by project title. firstName is
// taken from the first item (in title order) that carries one.
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
      return { email, firstName, items: sorted }
    })
}

const SIGN_OFF = ['—', 'iBuild4you']

// Single-brief body is byte-identical to the pre-#141 reminder email: the
// shared #21 reminder copy plus the minimal sign-off.
function singleBriefBody(item: PendingReminder): string {
  return [
    copy.nudge.reminder({
      firstName: item.makerFirstName,
      sessionNumber: item.sessionNumber,
      shareLink: item.shareLink,
    }),
    '',
    ...SIGN_OFF,
  ].join('\n')
}

function multiBriefBody(batch: MakerBatch): string {
  const lead = batch.firstName ? `${batch.firstName}, your` : 'Your'
  const lines = batch.items.map((item) => {
    const num = item.sessionNumber ? ` — conversation #${item.sessionNumber}` : ''
    return `- "${item.projectTitle}"${num}: ${item.shareLink}`
  })
  return [`${lead} conversations are waiting:`, '', ...lines, '', ...SIGN_OFF].join('\n')
}

// Build the subject + text for one maker's batch. 1 brief → today's exact copy
// (so single-brief behavior is unchanged); 2+ → a digest with one line per brief.
export function buildReminderEmail(batch: MakerBatch): { subject: string; text: string } {
  if (batch.items.length === 1) {
    const item = batch.items[0]
    return {
      subject: copy.email.subject.reminder(item.projectTitle),
      text: singleBriefBody(item),
    }
  }

  return {
    subject: `Your conversations are waiting (${batch.items.length} briefs)`,
    text: multiBriefBody(batch),
  }
}
