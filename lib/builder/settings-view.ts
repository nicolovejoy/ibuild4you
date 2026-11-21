import type { Project } from '@/lib/types'
import { copy } from '@/lib/copy'
import { nextReminderAt } from '@/lib/api/reminder-cadence'
import { isBriefModel } from '@/lib/agent/model-choices'
import { LOCALE_NAMES, toLocale } from '@/lib/locale'

// Pure helpers behind the builder Settings tab: the one-line summary each
// section shows in its header (folded or not) and the reminders status lines.

const t = copy.settings

const pacificDayFmt = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/Los_Angeles',
  month: 'short',
  day: 'numeric',
})

// A calendar day shown to a person is Pacific (UTC at rest, Pacific on display).
export function pacificDay(iso: string): string {
  return pacificDayFmt.format(new Date(iso))
}

// "English · Default model · reminders on"
export function samSummary(
  project: Pick<Project, 'language' | 'model' | 'auto_reminders_enabled'>
): string {
  const language = LOCALE_NAMES[toLocale(project.language)]
  const model = isBriefModel(project.model)
    ? copy.agentModel.options[project.model]
    : t.sam.defaultModel
  return t.sam.summary(language, model, project.auto_reminders_enabled === true)
}

export function connectionsSummary(project: Pick<Project, 'github_repo'>): string {
  const repo = (project.github_repo || '').trim()
  return repo || t.connections.noRepo
}

// The two status lines under the reminders switch, or null when reminders are
// off. Same gating as the cron via nextReminderAt(), so it never shows a
// phantom send (after the maker replied, or once the 3-send cap is hit).
export function reminderDetail(
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
): { sent: string; next: string } | null {
  if (project.auto_reminders_enabled !== true) return null

  const sent =
    t.reminders.sent(project.reminders_sent_count ?? 0) +
    (project.last_reminder_sent_at
      ? t.reminders.last(pacificDay(project.last_reminder_sent_at))
      : '')

  const upcoming = nextReminderAt({
    autoRemindersEnabled: project.auto_reminders_enabled,
    remindersSentCount: project.reminders_sent_count,
    lastReminderSentAt: project.last_reminder_sent_at,
    latestSessionCreatedAt: project.latest_session_created_at,
    sharedAt: project.shared_at,
    lastMakerMessageAt: project.last_maker_message_at,
    requesterEmail: project.requester_email,
  })

  let next: string
  if (upcoming.at !== null) {
    const days = Math.ceil((Date.parse(upcoming.at) - now) / 86400000)
    next = days <= 0 ? t.reminders.dueNow : t.reminders.nextIn(days, pacificDay(upcoming.at))
  } else if (upcoming.block === 'no_maker_email') {
    next = t.reminders.noMakerEmail
  } else if (upcoming.block === 'cap_reached') {
    next = t.reminders.capReached
  } else if (upcoming.block === 'maker_already_responded') {
    next = t.reminders.makerReplied
  } else {
    next = t.reminders.nothingShared
  }

  return { sent, next }
}
