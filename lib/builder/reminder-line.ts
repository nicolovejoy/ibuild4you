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
  | 'last_reminder_sent_at'
  | 'last_auto_reminder_at'
>

export type ReminderLine =
  | { kind: 'none' }
  | { kind: 'emailed'; at: string; to: string[] }
  | { kind: 'copied'; at: string }
  | { kind: 'automatic'; at: string }
  | { kind: 'recorded'; at: string }

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

// The newest reminder, manual (last_nudged_at: emailed or copied) or automatic
// (the cron). The cron writes last_auto_reminder_at, which nothing clears;
// last_reminder_sent_at is nulled by every maker message (it drives the cadence),
// so it is only the fallback for reminders sent before the new field. On a tie the manual one wins: it carries
// the address. Timestamps are UTC ISO strings, so string order is time order.
export function latestReminder(project: ReminderProject): ReminderLine {
  const manualAt = project.last_nudged_at
  const autoAt = project.last_auto_reminder_at ?? project.last_reminder_sent_at
  if (!manualAt && !autoAt) return { kind: 'none' }
  if (autoAt && (!manualAt || autoAt > manualAt)) return { kind: 'automatic', at: autoAt }
  const at = manualAt as string
  if (project.last_nudged_method === 'copy') return { kind: 'copied', at }
  const to = project.last_nudged_to
  if (project.last_nudged_method === 'email' && to && to.length > 0) {
    return { kind: 'emailed', at, to }
  }
  // No stored method, or an email with no addresses: say only that it happened.
  return { kind: 'recorded', at }
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
  const latest = latestReminder(args.project)
  const sinceOpening =
    latest.kind !== 'none' && (args.openingAt === null || latest.at >= args.openingAt)
  if (args.dispatchKind === 'nudge') return sinceOpening ? latest : { kind: 'none' }
  // Start: with no open conversation there is nothing to be "since".
  if (args.openingAt === null) return null
  return sinceOpening ? latest : null
}

export function reminderText(line: ReminderLine): string {
  const t = copy.reminderLine
  switch (line.kind) {
    case 'none':
      return t.none
    case 'emailed':
      return t.emailed(line.to.join(', '), pacificDateTime(line.at))
    case 'copied':
      return t.copied(pacificDateTime(line.at))
    case 'automatic':
      return t.automatic(pacificDateTime(line.at))
    case 'recorded':
      return t.recorded(pacificDateTime(line.at))
  }
}
