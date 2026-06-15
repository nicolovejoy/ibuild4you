// Pure function: given a project's reminder state, decide whether the daily
// maker-reminders cron should send the next reminder. Kept separate from the
// cron route so it can be exhaustively tested without a Firestore mock.
//
// Cadence: 2 days → 5 days → 10 days (each measured since the last touch —
// either the latest reminder, or if none, the latest session created or the
// initial share). Cap at 3 reminders total per maker per project lifecycle.

export interface ReminderState {
  /** undefined / false = opted out; only `true` opts in */
  autoRemindersEnabled?: boolean | null
  /** how many reminders have already gone out this cycle (cleared on maker message) */
  remindersSentCount?: number | null
  /** ISO timestamp of the most recent reminder, or null/undefined if none yet */
  lastReminderSentAt?: string | null
  /** ISO timestamp of the latest session creation (the "new conversation ready" trigger) */
  latestSessionCreatedAt?: string | null
  /** ISO timestamp of when project was first shared with a maker (fallback when no session yet) */
  sharedAt?: string | null
  /** ISO timestamp of the most recent maker message — if newer than latestSessionCreatedAt, maker already responded */
  lastMakerMessageAt?: string | null
  /** Builder must have provided a maker email — no email, no reminder */
  requesterEmail?: string | null
}

export type CadenceDecision =
  | { send: false; reason: string }
  | { send: true; reminderNumber: 1 | 2 | 3; daysSinceLastTouch: number }

const DAY_MS = 24 * 60 * 60 * 1000
export const CADENCE_DAYS = [2, 5, 10] as const // gap before reminders #1, #2, #3
export const MAX_REMINDERS = 3

// Why no next reminder is scheduled — mirrors decideReminder's gating so the UI
// can explain the state instead of just hiding the date.
export type ReminderBlock =
  | 'disabled'
  | 'no_maker_email'
  | 'cap_reached'
  | 'maker_already_responded'
  | 'no_reference_timestamp'

// When the next maker reminder is due (ISO), or the reason none is scheduled.
// Read-only companion to decideReminder for surfacing status on the Setup tab
// (#67); the cron itself still drives sends via decideReminder.
export function nextReminderAt(
  state: ReminderState,
): { at: string; block?: undefined } | { at: null; block: ReminderBlock } {
  if (state.autoRemindersEnabled !== true) return { at: null, block: 'disabled' }
  if (!state.requesterEmail) return { at: null, block: 'no_maker_email' }

  const count = state.remindersSentCount ?? 0
  if (count >= MAX_REMINDERS) return { at: null, block: 'cap_reached' }

  if (
    state.lastMakerMessageAt &&
    state.latestSessionCreatedAt &&
    state.lastMakerMessageAt > state.latestSessionCreatedAt
  ) {
    return { at: null, block: 'maker_already_responded' }
  }

  const referenceTs =
    state.lastReminderSentAt || state.latestSessionCreatedAt || state.sharedAt
  const referenceMs = referenceTs ? Date.parse(referenceTs) : NaN
  if (Number.isNaN(referenceMs)) return { at: null, block: 'no_reference_timestamp' }

  return { at: new Date(referenceMs + CADENCE_DAYS[count] * DAY_MS).toISOString() }
}

export function decideReminder(state: ReminderState, now: Date): CadenceDecision {
  if (state.autoRemindersEnabled !== true) {
    return { send: false, reason: 'auto_reminders_disabled' }
  }
  if (!state.requesterEmail) {
    return { send: false, reason: 'no_maker_email' }
  }

  const count = state.remindersSentCount ?? 0
  if (count >= MAX_REMINDERS) {
    return { send: false, reason: 'cap_reached' }
  }

  // Has the maker already messaged in the current session? Then no reminder.
  if (
    state.lastMakerMessageAt &&
    state.latestSessionCreatedAt &&
    state.lastMakerMessageAt > state.latestSessionCreatedAt
  ) {
    return { send: false, reason: 'maker_already_responded' }
  }

  // Reference timestamp: most recent reminder > latest session > shared_at.
  const referenceTs =
    state.lastReminderSentAt || state.latestSessionCreatedAt || state.sharedAt
  if (!referenceTs) {
    return { send: false, reason: 'no_reference_timestamp' }
  }

  const referenceMs = Date.parse(referenceTs)
  if (Number.isNaN(referenceMs)) {
    return { send: false, reason: 'invalid_reference_timestamp' }
  }

  const daysSince = (now.getTime() - referenceMs) / DAY_MS
  const requiredDays = CADENCE_DAYS[count]
  if (daysSince < requiredDays) {
    return { send: false, reason: `cadence_not_elapsed (${daysSince.toFixed(1)}d < ${requiredDays}d)` }
  }

  return {
    send: true,
    reminderNumber: (count + 1) as 1 | 2 | 3,
    daysSinceLastTouch: daysSince,
  }
}
