import { nextReminderAt } from '@/lib/api/reminder-cadence'
import type { Project, ProjectMemberSummary, Session } from '@/lib/types'

// Pure helpers behind the builder Conversations tab (#120 reader-first view).
// Everything here derives from already-loaded data so the strip, the dispatch
// button, and the transcript labels are unit-testable without React.

type ProjectLite = Pick<Project, 'requester_email' | 'requester_first_name'>

export interface MakerRoster {
  /** First names joined with " + " — "Mae + Sid". "the maker" when unknown. */
  names: string
  /** Active maker emails, in roster order. */
  emails: string[]
  /** Whether an outbound send has anyone to go to. */
  canSend: boolean
}

// Everyone an invite/nudge fans out to (#115). Falls back to the legacy
// requester fields while the roster loads (or on old briefs with no maker
// member rows).
export function makerRoster(
  members: ProjectMemberSummary[] | undefined,
  project: ProjectLite
): MakerRoster {
  const makers = (members || []).filter((m) => m.role === 'maker' && !m.removed_at)
  if (makers.length > 0) {
    return {
      names: makers
        .map((m) => (m.display_name || m.email.split('@')[0]).split(' ')[0])
        .join(' + '),
      emails: makers.map((m) => m.email),
      canSend: true,
    }
  }
  if (project.requester_email) {
    return {
      names: project.requester_first_name || project.requester_email.split('@')[0],
      emails: [project.requester_email],
      canSend: true,
    }
  }
  return { names: 'the maker', emails: [], canSend: false }
}

// The one state-aware dispatch action in the Conversations header:
//  invite — no maker on the brief yet, nothing to send to
//  nudge  — the live conversation is waiting on the maker's first reply
//  start  — round is done (or nothing live): start conversation N & email
export type DispatchState =
  | { kind: 'invite' }
  | { kind: 'nudge'; makerNames: string; sessionNumber: number }
  | { kind: 'start'; sessionNumber: number; makerNames: string; canSend: boolean }

export function getDispatchState(args: {
  project: ProjectLite
  members: ProjectMemberSummary[] | undefined
  sessionCount: number
  hasActiveSession: boolean
  makerRepliedInActive: boolean
}): DispatchState {
  const roster = makerRoster(args.members, args.project)
  if (!args.project.requester_email && roster.emails.length === 0) {
    return { kind: 'invite' }
  }
  if (args.hasActiveSession && !args.makerRepliedInActive) {
    return { kind: 'nudge', makerNames: roster.names, sessionNumber: args.sessionCount }
  }
  return {
    kind: 'start',
    sessionNumber: args.sessionCount + 1,
    makerNames: roster.names,
    canSend: roster.canSend,
  }
}

export function conversationLabel(number: number, status: Session['status']): string {
  const state = status === 'active' ? 'in progress' : status === 'archived' ? 'archived' : 'completed'
  return `Conversation ${number} · ${state}`
}

// Compact reminders line for the status strip. Same gating as the cron via
// nextReminderAt() so the strip never promises a phantom send.
export function remindersStripLine(
  project: Pick<
    Project,
    | 'auto_reminders_enabled'
    | 'reminders_sent_count'
    | 'last_reminder_sent_at'
    | 'latest_session_created_at'
    | 'shared_at'
    | 'last_maker_message_at'
    | 'requester_email'
  >,
  now: number
): string {
  const next = nextReminderAt({
    autoRemindersEnabled: project.auto_reminders_enabled,
    remindersSentCount: project.reminders_sent_count,
    lastReminderSentAt: project.last_reminder_sent_at,
    latestSessionCreatedAt: project.latest_session_created_at,
    sharedAt: project.shared_at,
    lastMakerMessageAt: project.last_maker_message_at,
    requesterEmail: project.requester_email,
  })
  if (next.at !== null) {
    const days = Math.ceil((Date.parse(next.at) - now) / 86400000)
    return days <= 0
      ? 'Reminders on · due now'
      : `Reminders on · next in ~${days} day${days === 1 ? '' : 's'}`
  }
  switch (next.block) {
    case 'disabled':
      return 'Reminders off'
    case 'cap_reached':
      return 'Reminders on · all 3 sent'
    case 'maker_already_responded':
      return 'Reminders on · paused (maker replied)'
    case 'no_maker_email':
      return 'Reminders on · no maker email'
    default:
      return 'Reminders on · nothing shared yet'
  }
}
