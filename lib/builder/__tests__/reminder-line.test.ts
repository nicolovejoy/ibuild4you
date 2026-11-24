import { describe, it, expect } from 'vitest'
import {
  pacificDateTime,
  latestReminder,
  conversationOpeningAt,
  headerReminderLine,
  reminderText,
} from '../reminder-line'

describe('pacificDateTime', () => {
  it('shows the Pacific date and time, in winter', () => {
    expect(pacificDateTime('2026-11-23T22:10:00.000Z')).toBe('November 23, 2:10 PM')
    expect(pacificDateTime('2026-11-23T17:00:00.000Z')).toBe('November 23, 9:00 AM')
  })

  it('uses summer time in July', () => {
    expect(pacificDateTime('2026-07-04T19:05:00.000Z')).toBe('July 4, 12:05 PM')
  })

  it('takes the Pacific day, not the UTC day, after 5 PM', () => {
    // 01:30 UTC on the 24th is 5:30 PM on the 23rd in Pacific time.
    expect(pacificDateTime('2026-11-24T01:30:00.000Z')).toBe('November 23, 5:30 PM')
  })
})

const T1 = '2026-11-20T10:00:00.000Z'
const T2 = '2026-11-21T10:00:00.000Z'
const T3 = '2026-11-22T10:00:00.000Z'

describe('latestReminder', () => {
  it('nothing set → none', () => {
    expect(latestReminder({})).toEqual({ kind: 'none' })
  })

  it('an emailed reminder carries the addresses', () => {
    expect(latestReminder({ last_nudged_at: T1, last_nudged_method: 'email', last_nudged_to: ['a@x.com'] })).toEqual({
      kind: 'emailed',
      at: T1,
      to: ['a@x.com'],
    })
  })

  it('a copied reminder', () => {
    expect(latestReminder({ last_nudged_at: T1, last_nudged_method: 'copy', last_nudged_to: null })).toEqual({
      kind: 'copied',
      at: T1,
    })
  })

  it('only the automatic stamp → automatic', () => {
    expect(latestReminder({ last_reminder_sent_at: T1 })).toEqual({ kind: 'automatic', at: T1 })
  })

  it('the newer of manual and automatic wins', () => {
    expect(
      latestReminder({ last_nudged_at: T2, last_nudged_method: 'copy', last_reminder_sent_at: T1 })
    ).toEqual({ kind: 'copied', at: T2 })
    expect(
      latestReminder({ last_nudged_at: T1, last_nudged_method: 'copy', last_reminder_sent_at: T2 })
    ).toEqual({ kind: 'automatic', at: T2 })
  })

  it('at the same instant the manual one wins (it carries the address)', () => {
    expect(
      latestReminder({ last_nudged_at: T1, last_nudged_method: 'email', last_nudged_to: ['a@x.com'], last_reminder_sent_at: T1 })
    ).toEqual({ kind: 'emailed', at: T1, to: ['a@x.com'] })
  })

  it('a stamp with no method is only recorded', () => {
    expect(latestReminder({ last_nudged_at: T1 })).toEqual({ kind: 'recorded', at: T1 })
    expect(latestReminder({ last_nudged_at: T1, last_nudged_method: null, last_nudged_to: null })).toEqual({
      kind: 'recorded',
      at: T1,
    })
  })

  it('method email with no addresses is only recorded', () => {
    expect(latestReminder({ last_nudged_at: T1, last_nudged_method: 'email', last_nudged_to: [] })).toEqual({
      kind: 'recorded',
      at: T1,
    })
    expect(latestReminder({ last_nudged_at: T1, last_nudged_method: 'email', last_nudged_to: null })).toEqual({
      kind: 'recorded',
      at: T1,
    })
  })
})

describe('conversationOpeningAt', () => {
  const session = { created_at: T1 }

  it('is the newest tagged welcome', () => {
    const messages = [
      { kind: 'welcome', created_at: T3 },
      { kind: 'welcome', created_at: T2 },
    ]
    expect(conversationOpeningAt(session, messages)).toBe(T3)
  })

  it('is the start of the conversation when no welcome is tagged', () => {
    expect(conversationOpeningAt(session, [{ created_at: T2 }])).toBe(T1)
    expect(conversationOpeningAt(session, [])).toBe(T1)
  })

  it('ignores a canned greeting', () => {
    expect(conversationOpeningAt(session, [{ kind: 'unqueued_greeting', created_at: T3 }])).toBe(T1)
  })
})

describe('headerReminderLine', () => {
  const copied = { last_nudged_at: T2, last_nudged_method: 'copy' as const, last_nudged_to: null }

  it('Nudge state, nothing sent → none', () => {
    expect(headerReminderLine({ dispatchKind: 'nudge', project: {}, openingAt: T1 })).toEqual({ kind: 'none' })
  })

  it('Nudge state, a reminder from before the opening → none', () => {
    expect(headerReminderLine({ dispatchKind: 'nudge', project: copied, openingAt: T3 })).toEqual({ kind: 'none' })
  })

  it('Nudge state, a reminder at or after the opening → that reminder', () => {
    expect(headerReminderLine({ dispatchKind: 'nudge', project: copied, openingAt: T1 })).toEqual({
      kind: 'copied',
      at: T2,
    })
    expect(headerReminderLine({ dispatchKind: 'nudge', project: copied, openingAt: T2 })).toEqual({
      kind: 'copied',
      at: T2,
    })
  })

  it('Start state, nothing since the opening → null', () => {
    expect(headerReminderLine({ dispatchKind: 'start', project: {}, openingAt: T1 })).toBeNull()
    expect(headerReminderLine({ dispatchKind: 'start', project: copied, openingAt: T3 })).toBeNull()
  })

  it('Start state, one since the opening → that reminder', () => {
    expect(headerReminderLine({ dispatchKind: 'start', project: copied, openingAt: T1 })).toEqual({
      kind: 'copied',
      at: T2,
    })
  })

  it('Start state with no open conversation → null', () => {
    expect(headerReminderLine({ dispatchKind: 'start', project: copied, openingAt: null })).toBeNull()
  })

  it('Invite state → null', () => {
    expect(headerReminderLine({ dispatchKind: 'invite', project: copied, openingAt: T1 })).toBeNull()
  })
})

describe('reminderText', () => {
  it('none', () => {
    expect(reminderText({ kind: 'none' })).toBe('No reminder sent since the welcome was posted.')
  })

  it('emailed, with one or two addresses', () => {
    expect(reminderText({ kind: 'emailed', at: '2026-11-23T22:10:00.000Z', to: ['a@x.com'] })).toBe(
      'Reminder emailed to a@x.com, November 23, 2:10 PM.'
    )
    expect(reminderText({ kind: 'emailed', at: '2026-11-23T22:10:00.000Z', to: ['a@x.com', 'b@x.com'] })).toBe(
      'Reminder emailed to a@x.com, b@x.com, November 23, 2:10 PM.'
    )
  })

  it('copied', () => {
    expect(reminderText({ kind: 'copied', at: '2026-11-23T22:10:00.000Z' })).toBe(
      'Reminder text copied November 23, 2:10 PM. The app did not send it.'
    )
  })

  it('automatic', () => {
    expect(reminderText({ kind: 'automatic', at: '2026-11-23T17:00:00.000Z' })).toBe(
      'Automatic reminder emailed November 23, 9:00 AM.'
    )
  })

  it('recorded never says emailed', () => {
    const text = reminderText({ kind: 'recorded', at: '2026-11-20T00:00:00.000Z' })
    expect(text).toBe(
      'Reminder recorded November 19, 4:00 PM. The app did not save whether it was emailed or copied.'
    )
  })
})
