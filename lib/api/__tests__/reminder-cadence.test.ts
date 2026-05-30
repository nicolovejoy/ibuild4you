import { describe, it, expect } from 'vitest'
import { decideReminder } from '../reminder-cadence'

// Fixed reference time so the suite is deterministic regardless of when
// it runs. `day(n)` is `n` days before `now` — both anchored to the same
// instant. Earlier version used `Date.now()` for day() while `now` was
// fixed; the drift broke the cadence tests on any day after the PR was
// authored (CI #158, 2026-05-23).
const now = new Date('2026-05-22T16:00:00.000Z')
const day = (n: number) => new Date(now.getTime() - n * 24 * 60 * 60 * 1000).toISOString()

describe('decideReminder — gating', () => {
  it('skips when autoRemindersEnabled is undefined (opt-out default)', () => {
    const decision = decideReminder(
      { requesterEmail: 'm@x.com', latestSessionCreatedAt: day(3) },
      now,
    )
    expect(decision.send).toBe(false)
    if (!decision.send) expect(decision.reason).toBe('auto_reminders_disabled')
  })

  it('skips when autoRemindersEnabled is false', () => {
    const decision = decideReminder(
      {
        autoRemindersEnabled: false,
        requesterEmail: 'm@x.com',
        latestSessionCreatedAt: day(3),
      },
      now,
    )
    expect(decision.send).toBe(false)
  })

  it('skips when no maker email is set', () => {
    const decision = decideReminder(
      { autoRemindersEnabled: true, latestSessionCreatedAt: day(3) },
      now,
    )
    expect(decision.send).toBe(false)
    if (!decision.send) expect(decision.reason).toBe('no_maker_email')
  })

  it('skips when the cap of 3 reminders is already reached', () => {
    const decision = decideReminder(
      {
        autoRemindersEnabled: true,
        requesterEmail: 'm@x.com',
        remindersSentCount: 3,
        lastReminderSentAt: day(20),
      },
      now,
    )
    expect(decision.send).toBe(false)
    if (!decision.send) expect(decision.reason).toBe('cap_reached')
  })

  it('skips when the maker has messaged since the current session was created', () => {
    const decision = decideReminder(
      {
        autoRemindersEnabled: true,
        requesterEmail: 'm@x.com',
        latestSessionCreatedAt: day(5),
        lastMakerMessageAt: day(1), // messaged 1 day ago, after a 5-day-old session
      },
      now,
    )
    expect(decision.send).toBe(false)
    if (!decision.send) expect(decision.reason).toBe('maker_already_responded')
  })

  it('skips when there is no reference timestamp at all', () => {
    const decision = decideReminder(
      { autoRemindersEnabled: true, requesterEmail: 'm@x.com' },
      now,
    )
    expect(decision.send).toBe(false)
    if (!decision.send) expect(decision.reason).toBe('no_reference_timestamp')
  })
})

describe('decideReminder — cadence (2 → 5 → 10 day gaps)', () => {
  const base = {
    autoRemindersEnabled: true,
    requesterEmail: 'm@x.com',
  }

  it('sends reminder #1 once 2 days have passed since the latest session', () => {
    const decision = decideReminder(
      { ...base, latestSessionCreatedAt: day(2.1) },
      now,
    )
    expect(decision.send).toBe(true)
    if (decision.send) expect(decision.reminderNumber).toBe(1)
  })

  it('does NOT send reminder #1 if only 1 day has passed', () => {
    const decision = decideReminder(
      { ...base, latestSessionCreatedAt: day(1) },
      now,
    )
    expect(decision.send).toBe(false)
  })

  it('sends reminder #2 once 5 days have passed since reminder #1', () => {
    const decision = decideReminder(
      {
        ...base,
        remindersSentCount: 1,
        lastReminderSentAt: day(5.1),
        latestSessionCreatedAt: day(20), // older — must use lastReminderSentAt
      },
      now,
    )
    expect(decision.send).toBe(true)
    if (decision.send) expect(decision.reminderNumber).toBe(2)
  })

  it('does NOT send reminder #2 if only 4 days passed since reminder #1', () => {
    const decision = decideReminder(
      {
        ...base,
        remindersSentCount: 1,
        lastReminderSentAt: day(4),
        latestSessionCreatedAt: day(20),
      },
      now,
    )
    expect(decision.send).toBe(false)
  })

  it('sends reminder #3 once 10 days have passed since reminder #2', () => {
    const decision = decideReminder(
      {
        ...base,
        remindersSentCount: 2,
        lastReminderSentAt: day(10.1),
        latestSessionCreatedAt: day(30),
      },
      now,
    )
    expect(decision.send).toBe(true)
    if (decision.send) expect(decision.reminderNumber).toBe(3)
  })

  it('does NOT send reminder #3 if only 9 days passed since reminder #2', () => {
    const decision = decideReminder(
      {
        ...base,
        remindersSentCount: 2,
        lastReminderSentAt: day(9),
        latestSessionCreatedAt: day(30),
      },
      now,
    )
    expect(decision.send).toBe(false)
  })
})

describe('decideReminder — reference-timestamp precedence', () => {
  const base = {
    autoRemindersEnabled: true,
    requesterEmail: 'm@x.com',
    remindersSentCount: 0,
  }

  it('prefers latestSessionCreatedAt over sharedAt when both exist', () => {
    const decision = decideReminder(
      { ...base, sharedAt: day(10), latestSessionCreatedAt: day(1) },
      now,
    )
    // session was 1 day ago — 2-day gap NOT met. Should be false (so we know it
    // used session, not sharedAt which would have fired).
    expect(decision.send).toBe(false)
  })

  it('falls back to sharedAt when there is no session yet', () => {
    const decision = decideReminder(
      { ...base, sharedAt: day(3) },
      now,
    )
    expect(decision.send).toBe(true)
    if (decision.send) expect(decision.reminderNumber).toBe(1)
  })

  // Regression for the persistence gap (PR feat/reminders-phase1): a fresh
  // session prepped 1 day ago must hold the cadence even when the project was
  // first shared long ago. Before latest_session_created_at was persisted onto
  // the project doc, the cron saw it as undefined and anchored on the stale
  // sharedAt — firing reminders off the original share instead of the newest
  // session. This asserts the session timestamp wins.
  it('does NOT fire off a stale sharedAt when a newer session exists', () => {
    const decision = decideReminder(
      { ...base, sharedAt: day(30), latestSessionCreatedAt: day(1) },
      now,
    )
    expect(decision.send).toBe(false)
    if (!decision.send) expect(decision.reason).toMatch(/cadence_not_elapsed/)
  })
})
