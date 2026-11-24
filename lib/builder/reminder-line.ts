import { copy } from '@/lib/copy'
import type { Project, Session } from '@/lib/types'
import type { DispatchState } from './conversations-view'

// The last reminder to the maker, as one sentence: on the builder Conversations
// header and on the dashboard card (builder viewers). Pure helpers, so the rules
// are testable without React. Timestamps are UTC at rest; people see Pacific.

type ReminderProject = Pick<
  Project,
  | 'last_nudged_at'
  | 'last_nudged_method'
  | 'last_nudged_to'
  | 'last_nudge_emailed_at'
  | 'last_reminder_sent_at'
  | 'last_auto_reminder_at'
>

// A reminder that was really sent (or recorded as sent).
type SentPart =
  | { kind: 'emailed'; at: string; to: string[] }
  | { kind: 'automatic'; at: string }
  | { kind: 'recorded'; at: string }

// What the line says. A copy newer than the reminder that was sent follows it
// (`copiedAt`): a copy never hides the last email.
export type ReminderLine =
  | { kind: 'none' }
  | { kind: 'emailed'; at: string; to: string[]; copiedAt?: string }
  | { kind: 'automatic'; at: string; copiedAt?: string }
  | { kind: 'recorded'; at: string; copiedAt?: string }
  | { kind: 'copied'; at: string }

const dateFmt = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/Los_Angeles',
  month: 'long',
  day: 'numeric',
})
const timeFmt = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/Los_Angeles',
  hour: 'numeric',
  minute: '2-digit',
})

// "November 23, 2:10 PM". Date and time are formatted apart and joined by hand:
// one formatter with both prints "November 23 at 2:10 PM". Newer ICU puts a
// narrow no-break space before PM; it is turned into a plain space.
export function pacificDateTime(iso: string): string {
  const d = new Date(iso)
  return `${dateFmt.format(d)}, ${timeFmt.format(d).replace(/ /g, ' ')}`
}

type Parts = { sent: SentPart | null; copiedAt: string | null }

// The two things the line can say. `sent` is the newer of the manual email and
// the automatic reminder (on a tie the manual one wins: it carries the address).
// `copiedAt` is a copy, kept only when it is newer than `sent`. The cron writes
// last_auto_reminder_at, which nothing clears; last_reminder_sent_at is nulled by
// every maker message (it drives the cadence), so it is only the fallback for
// reminders sent before the new field. Timestamps are UTC ISO strings, so string
// order is time order.
function reminderParts(project: ReminderProject): Parts {
  const stamp = project.last_nudged_at
  const method = project.last_nudged_method

  let manual: SentPart | null = null
  let copiedAt: string | null = null
  if (stamp && method === 'copy') copiedAt = stamp
  // The email time: its own field, else (a project stamped before that field
  // existed) last_nudged_at when the method says the last stamp was an email.
  const emailedAt = project.last_nudge_emailed_at ?? (method === 'email' ? stamp : undefined)
  if (emailedAt) {
    const to = project.last_nudged_to
    manual = to && to.length > 0 ? { kind: 'emailed', at: emailedAt, to } : { kind: 'recorded', at: emailedAt }
  } else if (stamp && method !== 'copy') {
    // No stored method (before 2026-11-23): say only that it happened.
    manual = { kind: 'recorded', at: stamp }
  }

  const autoAt = project.last_auto_reminder_at ?? project.last_reminder_sent_at
  const sent: SentPart | null =
    autoAt && (!manual || autoAt > manual.at) ? { kind: 'automatic', at: autoAt } : manual

  return { sent, copiedAt: copiedAt && (!sent || copiedAt > sent.at) ? copiedAt : null }
}

function composeLine({ sent, copiedAt }: Parts): ReminderLine {
  if (!sent) return copiedAt ? { kind: 'copied', at: copiedAt } : { kind: 'none' }
  return copiedAt ? { ...sent, copiedAt } : sent
}

export function latestReminder(project: ReminderProject): ReminderLine {
  return composeLine(reminderParts(project))
}

type OpeningMessage = { kind?: string | null; created_at?: string | null }

// When the open conversation was last opened: its newest welcome an import
// posted, else the conversation's own start (its welcome was posted at creation).
export function conversationOpeningAt(
  session: Pick<Session, 'created_at'>,
  messages: OpeningMessage[]
): string {
  let newest: string | null = null
  for (const m of messages) {
    if (m.kind === 'welcome' && m.created_at && (newest === null || m.created_at > newest)) {
      newest = m.created_at
    }
  }
  return newest ?? session.created_at
}

// What the Conversations header shows beside its dispatch button, or null for
// nothing. Nudge: always a line ("none" when no reminder since the opening).
// Start: only a reminder sent since the open conversation was opened. Invite: never.
export function headerReminderLine(args: {
  dispatchKind: DispatchState['kind']
  project: ReminderProject
  openingAt: string | null
}): ReminderLine | null {
  if (args.dispatchKind === 'invite') return null
  // Start: with no open conversation there is nothing to be "since".
  if (args.dispatchKind === 'start' && args.openingAt === null) return null
  // The "since the welcome" rule applies to each part on its own: an old email
  // is dropped while a newer copy stays.
  const { sent, copiedAt } = reminderParts(args.project)
  const since = (at: string) => args.openingAt === null || at >= args.openingAt
  const line = composeLine({
    sent: sent && since(sent.at) ? sent : null,
    copiedAt: copiedAt && since(copiedAt) ? copiedAt : null,
  })
  if (line.kind !== 'none') return line
  return args.dispatchKind === 'nudge' ? line : null
}

export function reminderText(line: ReminderLine): string {
  const t = copy.reminderLine
  switch (line.kind) {
    case 'none':
      return t.none
    case 'copied':
      return t.copied(pacificDateTime(line.at))
    case 'emailed':
      return withCopy(t.emailed(line.to.join(', '), pacificDateTime(line.at)), line.copiedAt)
    case 'automatic':
      return withCopy(t.automatic(pacificDateTime(line.at)), line.copiedAt)
    case 'recorded':
      return withCopy(t.recorded(pacificDateTime(line.at)), line.copiedAt)
  }
}

// The copy sentence follows the sent one when a copy is newer.
function withCopy(sentence: string, copiedAt: string | undefined): string {
  return copiedAt ? `${sentence} ${copy.reminderLine.copied(pacificDateTime(copiedAt))}` : sentence
}
