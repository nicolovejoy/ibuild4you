import { describe, it, expect } from 'vitest'
import {
  groupReminderSends,
  buildReminderEmail,
  type PendingReminder,
} from '../reminder-digest'

function pending(overrides: Partial<PendingReminder> = {}): PendingReminder {
  return {
    projectId: 'p1',
    makerEmail: 'maker@example.com',
    makerFirstName: 'Sam',
    projectTitle: "Sam's Cafe",
    shareLink: 'https://ibuild4you.com/projects/sams-cafe',
    sessionNumber: 1,
    reminderNumber: 1,
    ...overrides,
  }
}

describe('groupReminderSends', () => {
  it('groups by lowercased/trimmed email', () => {
    const batches = groupReminderSends([
      pending({ projectId: 'a', makerEmail: 'Maker@Example.com', projectTitle: 'A' }),
      pending({ projectId: 'b', makerEmail: ' maker@example.com ', projectTitle: 'B' }),
      pending({ projectId: 'c', makerEmail: 'other@example.com', projectTitle: 'C' }),
    ])
    expect(batches).toHaveLength(2)
    const mine = batches.find((b) => b.email === 'maker@example.com')!
    expect(mine.items.map((i) => i.projectId)).toEqual(['a', 'b'])
  })

  it('orders batches by email and items by project title', () => {
    const batches = groupReminderSends([
      pending({ projectId: 'z', makerEmail: 'z@example.com', projectTitle: 'Zeta' }),
      pending({ projectId: 'a2', makerEmail: 'a@example.com', projectTitle: 'Beta' }),
      pending({ projectId: 'a1', makerEmail: 'a@example.com', projectTitle: 'Alpha' }),
    ])
    expect(batches.map((b) => b.email)).toEqual(['a@example.com', 'z@example.com'])
    expect(batches[0].items.map((i) => i.projectTitle)).toEqual(['Alpha', 'Beta'])
  })

  it('takes firstName from the first item (title order) that has one', () => {
    const batches = groupReminderSends([
      pending({ makerEmail: 'x@example.com', projectTitle: 'Beta', makerFirstName: 'Jordan' }),
      pending({ makerEmail: 'x@example.com', projectTitle: 'Alpha', makerFirstName: null }),
    ])
    // Alpha sorts first but has no name → falls through to Jordan
    expect(batches[0].firstName).toBe('Jordan')
  })
})

describe('buildReminderEmail', () => {
  it('single brief is byte-identical to the pre-#141 reminder copy', () => {
    const batch = groupReminderSends([pending({ sessionNumber: 3 })])[0]
    const { subject, text } = buildReminderEmail(batch)
    expect(subject).toBe('Your conversation for "Sam\'s Cafe" is ready')
    expect(text).toBe(
      [
        'Sam, your next conversation (#3) awaits:',
        '',
        'https://ibuild4you.com/projects/sams-cafe',
        '',
        '—',
        'iBuild4you',
      ].join('\n'),
    )
  })

  it('single brief without a name or session number degrades gracefully', () => {
    const batch = groupReminderSends([
      pending({ makerFirstName: null, sessionNumber: null }),
    ])[0]
    const { text } = buildReminderEmail(batch)
    expect(text).toMatch(/^Your next conversation awaits:/)
  })

  it('2+ briefs: subject counts briefs, body lists every link', () => {
    const batch = groupReminderSends([
      pending({ projectId: 'a', projectTitle: 'Alpha', sessionNumber: 2, shareLink: 'https://ibuild4you.com/projects/alpha' }),
      pending({ projectId: 'b', projectTitle: 'Beta', sessionNumber: null, shareLink: 'https://ibuild4you.com/projects/beta' }),
    ])[0]
    const { subject, text } = buildReminderEmail(batch)
    expect(subject).toBe('Your conversations are waiting (2 briefs)')
    expect(text).toContain('Sam, your conversations are waiting:')
    expect(text).toContain('- "Alpha" — conversation #2: https://ibuild4you.com/projects/alpha')
    // sessionNumber null → no "conversation #n"
    expect(text).toContain('- "Beta": https://ibuild4you.com/projects/beta')
    expect(text.trimEnd().endsWith('iBuild4you')).toBe(true)
  })

  it('2+ briefs without a name drops the greeting name', () => {
    const batch = groupReminderSends([
      pending({ projectId: 'a', projectTitle: 'Alpha', makerFirstName: null }),
      pending({ projectId: 'b', projectTitle: 'Beta', makerFirstName: null }),
    ])[0]
    const { text } = buildReminderEmail(batch)
    expect(text).toMatch(/^Your conversations are waiting:/)
  })
})
