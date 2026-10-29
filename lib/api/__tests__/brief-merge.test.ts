import { describe, it, expect } from 'vitest'
import {
  mergeLockedDecisions,
  reconcileBrief,
  lockedFirst,
  stampDecisionProvenance,
  stripDecisionProvenance,
  lostLocks,
  resolveContest,
  contestFor,
  dismissedFor,
  normalizeDecisionText,
} from '../brief-merge'
import type { BriefContent, BriefDecision } from '@/lib/types'

// #71 brief↔build reconciliation — locked decisions are durable through regen.
// The regen model is told to preserve them, but durability can't depend on the
// model, so this code re-injects any it dropped or reworded.

const d = (topic: string, decision: string, locked?: boolean): BriefDecision =>
  locked ? { topic, decision, locked } : { topic, decision }

describe('mergeLockedDecisions', () => {
  it('passes regen output through unchanged when nothing was locked', () => {
    const next = [d('Auth', 'Google only'), d('DB', 'Firestore')]
    expect(mergeLockedDecisions([d('Auth', 'old')], next)).toEqual(next)
  })

  it('re-injects a locked decision the regen output dropped entirely', () => {
    const prev = [d('Stack', 'Next.js, no Vue', true)]
    const next = [d('Auth', 'Google only')]
    const merged = mergeLockedDecisions(prev, next)
    expect(merged).toEqual([
      { topic: 'Stack', decision: 'Next.js, no Vue', locked: true },
      { topic: 'Auth', decision: 'Google only' },
    ])
  })

  it('reverts a locked decision that regen reworded (locked text wins)', () => {
    const prev = [d('Stack', 'Next.js, no Vue', true)]
    const next = [d('Stack', 'Vue is fine actually')]
    const merged = mergeLockedDecisions(prev, next)
    expect(merged).toEqual([{ topic: 'Stack', decision: 'Next.js, no Vue', locked: true }])
  })

  it('matches topics case-insensitively and trimmed when reverting', () => {
    const prev = [d('Stack', 'Next.js, no Vue', true)]
    const next = [d('  stack ', 'Vue is fine'), d('Auth', 'Google')]
    const merged = mergeLockedDecisions(prev, next)
    expect(merged).toEqual([
      { topic: 'Stack', decision: 'Next.js, no Vue', locked: true },
      { topic: 'Auth', decision: 'Google' },
    ])
  })

  it('keeps non-locked prior decisions out — regen owns those', () => {
    const prev = [d('Color', 'blue'), d('Stack', 'Next.js', true)]
    const next = [d('Color', 'green')]
    const merged = mergeLockedDecisions(prev, next)
    // 'Color' was not locked, so regen's 'green' stands; only 'Stack' is durable.
    expect(merged).toEqual([
      { topic: 'Stack', decision: 'Next.js', locked: true },
      { topic: 'Color', decision: 'green' },
    ])
  })

  it('places locked decisions first, then regen contributions', () => {
    const prev = [d('A', 'a', true), d('B', 'b', true)]
    const next = [d('C', 'c'), d('A', 'changed')]
    const merged = mergeLockedDecisions(prev, next)
    expect(merged).toEqual([
      { topic: 'A', decision: 'a', locked: true },
      { topic: 'B', decision: 'b', locked: true },
      { topic: 'C', decision: 'c' },
    ])
  })

  it('handles undefined prev/next', () => {
    expect(mergeLockedDecisions(undefined, undefined)).toEqual([])
    expect(mergeLockedDecisions(undefined, [d('A', 'a')])).toEqual([d('A', 'a')])
    expect(mergeLockedDecisions([d('A', 'a', true)], undefined)).toEqual([
      { topic: 'A', decision: 'a', locked: true },
    ])
  })
})

describe('reconcileBrief', () => {
  const base: BriefContent = {
    problem: 'p',
    target_users: 't',
    features: ['f'],
    constraints: 'c',
    additional_context: '',
  }

  it('applies locked-decision durability while keeping other fields from next', () => {
    const prev: BriefContent = { ...base, decisions: [d('Stack', 'Next.js', true)] }
    const next: BriefContent = { ...base, problem: 'new problem', decisions: [d('Auth', 'Google')] }
    const result = reconcileBrief(prev, next)
    expect(result.problem).toBe('new problem')
    expect(result.decisions).toEqual([
      { topic: 'Stack', decision: 'Next.js', locked: true },
      { topic: 'Auth', decision: 'Google' },
    ])
  })

  it('is a no-op on decisions when prev is null', () => {
    const next: BriefContent = { ...base, decisions: [d('Auth', 'Google')] }
    expect(reconcileBrief(null, next).decisions).toEqual([d('Auth', 'Google')])
  })
})

// #121 decision provenance — stamps are authored by code, never by the model.
// One pure function used by BOTH write paths (regen + paste), run after
// mergeLockedDecisions.
describe('stampDecisionProvenance', () => {
  const NOW = '2026-07-11T20:00:00.000Z'

  it('stamps a brand-new topic with the current session context', () => {
    const out = stampDecisionProvenance({
      prev: [],
      next: [d('Auth', 'Google only')],
      sessionId: 's2',
      now: NOW,
    })
    expect(out).toEqual([
      { topic: 'Auth', decision: 'Google only', decided_in_session: 's2', decided_at: NOW },
    ])
  })

  it('stamps decided_in_session null on the paste path (out-of-band decision)', () => {
    const out = stampDecisionProvenance({
      prev: undefined,
      next: [d('Auth', 'Google only')],
      sessionId: null,
      now: NOW,
    })
    expect(out).toEqual([
      { topic: 'Auth', decision: 'Google only', decided_in_session: null, decided_at: NOW },
    ])
  })

  it('honors explicit provenance on a new decision (outside agent knows the truth)', () => {
    const out = stampDecisionProvenance({
      prev: [],
      next: [
        {
          topic: 'Auth',
          decision: 'Google only',
          decided_in_session: 's1',
          decided_at: '2026-07-01T00:00:00Z',
        },
      ],
      sessionId: null,
      now: NOW,
    })
    expect(out).toEqual([
      {
        topic: 'Auth',
        decision: 'Google only',
        decided_in_session: 's1',
        decided_at: '2026-07-01T00:00:00Z',
      },
    ])
  })

  it('carries prev stamps forward verbatim when the decision text is unchanged', () => {
    const prev: BriefDecision[] = [
      {
        topic: 'Auth',
        decision: 'Google only',
        decided_in_session: 's1',
        decided_at: '2026-07-01T00:00:00Z',
      },
    ]
    const out = stampDecisionProvenance({
      prev,
      next: [d('Auth', 'Google only')],
      sessionId: 's3',
      now: NOW,
    })
    expect(out).toEqual(prev)
  })

  it('restores stamps an outside agent dropped when round-tripping the JSON', () => {
    // The ferry may return decisions without decided_* — carry-forward puts them back.
    const prev: BriefDecision[] = [
      {
        topic: 'Payment',
        decision: 'Stripe',
        decided_in_session: 's2',
        decided_at: '2026-07-05T00:00:00Z',
      },
    ]
    const out = stampDecisionProvenance({
      prev,
      next: [{ topic: 'payment', decision: 'Stripe' }], // topic case differs; text same
      sessionId: null,
      now: NOW,
    })
    expect(out).toEqual([
      {
        topic: 'payment',
        decision: 'Stripe',
        decided_in_session: 's2',
        decided_at: '2026-07-05T00:00:00Z',
      },
    ])
  })

  it('never fabricates: an unstamped unchanged decision stays unstamped', () => {
    const out = stampDecisionProvenance({
      prev: [d('Auth', 'Google only')],
      next: [d('Auth', 'Google only')],
      sessionId: 's3',
      now: NOW,
    })
    expect(out).toEqual([{ topic: 'Auth', decision: 'Google only' }])
  })

  it('ignores echoed stamps on an unchanged decision — prev is the source of truth', () => {
    // Model saw stamps in its prompt and echoed (or hallucinated) them back.
    const out = stampDecisionProvenance({
      prev: [
        {
          topic: 'Auth',
          decision: 'Google only',
          decided_in_session: 's1',
          decided_at: '2026-07-01T00:00:00Z',
        },
      ],
      next: [
        {
          topic: 'Auth',
          decision: 'Google only',
          decided_in_session: 's9',
          decided_at: '2099-01-01T00:00:00Z',
        },
      ],
      sessionId: 's3',
      now: NOW,
    })
    expect(out).toEqual([
      {
        topic: 'Auth',
        decision: 'Google only',
        decided_in_session: 's1',
        decided_at: '2026-07-01T00:00:00Z',
      },
    ])
  })

  // #218 — a changed decision is a revision: the origin stays, revised_* is stamped.
  it('keeps the origin and stamps revised_* when the decision text changed this round', () => {
    const out = stampDecisionProvenance({
      prev: [
        {
          topic: 'Auth',
          decision: 'Google only',
          decided_in_session: 's1',
          decided_at: '2026-07-01T00:00:00Z',
        },
      ],
      next: [d('Auth', 'Google + passcode')],
      sessionId: 's3',
      now: NOW,
    })
    expect(out).toEqual([
      {
        topic: 'Auth',
        decision: 'Google + passcode',
        decided_in_session: 's1',
        decided_at: '2026-07-01T00:00:00Z',
        revised_in_session: 's3',
        revised_at: NOW,
      },
    ])
  })

  it('never lets incoming decided_* overwrite the origin of a changed decision (paste path)', () => {
    const out = stampDecisionProvenance({
      prev: [
        {
          topic: 'Auth',
          decision: 'Google only',
          decided_in_session: 's1',
          decided_at: '2026-07-01T00:00:00Z',
        },
      ],
      next: [
        {
          topic: 'Auth',
          decision: 'Google + passcode',
          decided_in_session: null,
          decided_at: '2026-07-10T00:00:00Z',
        },
      ],
      sessionId: null,
      now: NOW,
    })
    expect(out).toEqual([
      {
        topic: 'Auth',
        decision: 'Google + passcode',
        decided_in_session: 's1',
        decided_at: '2026-07-01T00:00:00Z',
        revised_in_session: null,
        revised_at: NOW,
      },
    ])
  })

  it('honors explicit revised_* on a changed decision (paste path knows the real revision)', () => {
    const out = stampDecisionProvenance({
      prev: [{ topic: 'Auth', decision: 'Google only', decided_in_session: 's1', decided_at: '2026-07-01T00:00:00Z' }],
      next: [{ topic: 'Auth', decision: 'Google + passcode', revised_in_session: 's2', revised_at: '2026-07-10T00:00:00Z' }],
      sessionId: null,
      now: NOW,
    })
    expect(out[0]).toMatchObject({
      decided_in_session: 's1',
      decided_at: '2026-07-01T00:00:00Z',
      revised_in_session: 's2',
      revised_at: '2026-07-10T00:00:00Z',
    })
  })

  it('a second revision replaces the first; the origin still stands', () => {
    const first = stampDecisionProvenance({
      prev: [{ topic: 'Auth', decision: 'Google only', decided_in_session: 's1', decided_at: '2026-07-01T00:00:00Z' }],
      next: [d('Auth', 'Google + passcode')],
      sessionId: 's3',
      now: NOW,
    })
    const second = stampDecisionProvenance({
      prev: first,
      next: [d('Auth', 'Passcode only')],
      sessionId: 's5',
      now: '2027-01-01T00:00:00Z',
    })
    expect(second).toEqual([
      {
        topic: 'Auth',
        decision: 'Passcode only',
        decided_in_session: 's1',
        decided_at: '2026-07-01T00:00:00Z',
        revised_in_session: 's5',
        revised_at: '2027-01-01T00:00:00Z',
      },
    ])
  })

  it('carries revised_* forward verbatim when the text is unchanged, ignoring echoes', () => {
    const prev: BriefDecision[] = [
      { topic: 'Auth', decision: 'Google + passcode', decided_in_session: 's1', decided_at: '2026-07-01T00:00:00Z', revised_in_session: 's3', revised_at: NOW },
    ]
    const out = stampDecisionProvenance({
      prev,
      next: [{ topic: 'Auth', decision: 'Google + passcode', revised_in_session: 'echo', revised_at: '2099-01-01T00:00:00Z' }],
      sessionId: 's9',
      now: '2027-01-01T00:00:00Z',
    })
    expect(out).toEqual(prev)
  })

  it('an echoed revised_* (editor spread / prep chat / contest accept) is restamped, not frozen', () => {
    const prev: BriefDecision[] = [
      { topic: 'Auth', decision: 'Google + passcode', decided_in_session: 's1', decided_at: '2026-07-01T00:00:00Z', revised_in_session: 's3', revised_at: NOW },
    ]
    // The structured editor spreads the stored decision and changes only the text.
    const out = stampDecisionProvenance({
      prev,
      next: [{ ...prev[0], decision: 'Passcode only' }],
      sessionId: null,
      now: '2027-01-01T00:00:00Z',
    })
    expect(out).toEqual([
      {
        topic: 'Auth',
        decision: 'Passcode only',
        decided_in_session: 's1',
        decided_at: '2026-07-01T00:00:00Z',
        revised_in_session: null,
        revised_at: '2027-01-01T00:00:00Z',
      },
    ])
  })

  it('accepting a contest on a previously revised lock restamps the revision', () => {
    const prev: BriefDecision[] = [
      { topic: 'Stack', decision: 'Next.js', locked: true, decided_in_session: 's1', decided_at: '2026-07-01T00:00:00Z', revised_in_session: 's2', revised_at: NOW, contested: { proposed: 'Remix', reason: 'maker confirmed' } },
    ]
    const next = resolveContest(prev, 'Stack', 'accept', '2027-01-01T00:00:00Z')
    const out = stampDecisionProvenance({ prev, next, sessionId: null, now: '2027-01-01T00:00:00Z' })
    expect(out[0]).toMatchObject({ decision: 'Remix', locked: true, decided_at: '2026-07-01T00:00:00Z', revised_in_session: null, revised_at: '2027-01-01T00:00:00Z' })
  })

  it('honors an explicit origin on a changed decision whose prev had none', () => {
    const out = stampDecisionProvenance({
      prev: [d('Auth', 'Google only')],
      next: [{ topic: 'Auth', decision: 'Google + passcode', decided_in_session: 's1', decided_at: '2026-07-01T00:00:00Z' }],
      sessionId: 's3',
      now: NOW,
    })
    expect(out).toEqual([
      { topic: 'Auth', decision: 'Google + passcode', decided_in_session: 's1', decided_at: '2026-07-01T00:00:00Z', revised_in_session: 's3', revised_at: NOW },
    ])
  })

  it('a changed decision with no origin stamp gets revised_* only — the origin is not invented', () => {
    const out = stampDecisionProvenance({
      prev: [d('Auth', 'Google only')],
      next: [d('Auth', 'Google + passcode')],
      sessionId: 's3',
      now: NOW,
    })
    expect(out).toEqual([
      { topic: 'Auth', decision: 'Google + passcode', revised_in_session: 's3', revised_at: NOW },
    ])
  })

  it('preserves stamps on a locked decision through the merge+stamp pipeline', () => {
    const prev: BriefDecision[] = [
      {
        topic: 'Stack',
        decision: 'Next.js, no Vue',
        locked: true,
        decided_in_session: 's1',
        decided_at: '2026-07-01T00:00:00Z',
      },
    ]
    // Regen dropped the locked decision; merge re-injects it, stamp carries stamps.
    const merged = mergeLockedDecisions(prev, [d('Auth', 'Google only')])
    const out = stampDecisionProvenance({ prev, next: merged, sessionId: 's3', now: NOW })
    expect(out).toEqual([
      {
        topic: 'Stack',
        decision: 'Next.js, no Vue',
        locked: true,
        decided_in_session: 's1',
        decided_at: '2026-07-01T00:00:00Z',
      },
      { topic: 'Auth', decision: 'Google only', decided_in_session: 's3', decided_at: NOW },
    ])
  })

  it('is idempotent: restamping unchanged output changes nothing', () => {
    const first = stampDecisionProvenance({
      prev: [],
      next: [d('Auth', 'Google only')],
      sessionId: 's2',
      now: NOW,
    })
    const second = stampDecisionProvenance({
      prev: first,
      next: first,
      sessionId: 's9',
      now: '2027-01-01T00:00:00Z',
    })
    expect(second).toEqual(first)
  })
})

describe('stripDecisionProvenance', () => {
  it('removes decided_* fields and keeps everything else', () => {
    const input: BriefDecision[] = [
      {
        topic: 'Auth',
        decision: 'Google only',
        locked: true,
        decided_in_session: 's1',
        decided_at: '2026-07-01T00:00:00Z',
        revised_in_session: 's2',
        revised_at: '2026-07-02T00:00:00Z',
      },
      { topic: 'DB', decision: 'Firestore' },
    ]
    expect(stripDecisionProvenance(input)).toEqual([
      { topic: 'Auth', decision: 'Google only', locked: true },
      { topic: 'DB', decision: 'Firestore' },
    ])
  })
})

describe('lockedFirst', () => {
  it('moves locked decisions ahead of unlocked ones', () => {
    const list = [d('Auth', 'Google'), d('Stack', 'Next.js', true), d('Payments', 'Stripe')]
    expect(lockedFirst(list)).toEqual([
      d('Stack', 'Next.js', true),
      d('Auth', 'Google'),
      d('Payments', 'Stripe'),
    ])
  })

  it('is stable within the locked and unlocked groups', () => {
    const list = [d('A', '1', true), d('B', '2'), d('C', '3', true), d('D', '4')]
    expect(lockedFirst(list).map((x) => x.topic)).toEqual(['A', 'C', 'B', 'D'])
  })

  it('puts contested locks ahead of plain locks, stable within each group', () => {
    const c = { proposed: 'x', reason: 'y' }
    const list: BriefDecision[] = [
      d('A', '1'),
      d('B', '2', true),
      { topic: 'C', decision: '3', locked: true, contested: c },
      d('D', '4', true),
      { topic: 'E', decision: '5', locked: true, contested: c },
    ]
    expect(lockedFirst(list).map((x) => x.topic)).toEqual(['C', 'E', 'B', 'D', 'A'])
  })

  it('handles undefined', () => {
    expect(lockedFirst(undefined)).toEqual([])
  })
})

describe('mergeLockedDecisions — contested locks (#197)', () => {
  const contest = { proposed: 'Square', reason: 'switched POS, confirmed in conversation 3' }

  it('copies a model-emitted contested onto the verbatim lock', () => {
    const prev = [
      {
        topic: 'Payment',
        decision: 'Stripe only',
        locked: true,
        decided_at: '2026-01-01T00:00:00.000Z',
      },
    ]
    const next = [{ topic: 'payment', decision: 'Square', contested: contest }]
    expect(mergeLockedDecisions(prev, next)).toEqual([
      {
        topic: 'Payment',
        decision: 'Stripe only',
        locked: true,
        decided_at: '2026-01-01T00:00:00.000Z',
        contested: contest,
      },
    ])
  })

  it('carries an existing contested forward when regen no longer mentions it', () => {
    const prev = [{ topic: 'Payment', decision: 'Stripe only', locked: true, contested: contest }]
    const next = [{ topic: 'Payment', decision: 'Stripe only' }]
    expect(mergeLockedDecisions(prev, next)).toEqual([
      { topic: 'Payment', decision: 'Stripe only', locked: true, contested: contest },
    ])
  })

  it('a newer contested replaces the older one', () => {
    const prev = [{ topic: 'Payment', decision: 'Stripe only', locked: true, contested: contest }]
    const newer = { proposed: 'PayPal', reason: 'changed again, conversation 4' }
    const next = [{ topic: 'Payment', decision: 'Stripe only', contested: newer }]
    expect(mergeLockedDecisions(prev, next)[0].contested).toEqual(newer)
  })

  it('strips contested from a non-locked decision', () => {
    const prev = [d('Stack', 'Next.js', true)]
    const next = [{ topic: 'Auth', decision: 'Google', contested: contest }]
    expect(mergeLockedDecisions(prev, next)).toEqual([
      { topic: 'Stack', decision: 'Next.js', locked: true },
      { topic: 'Auth', decision: 'Google' },
    ])
  })

  it('strips contested from regen output even when nothing was locked', () => {
    const next = [{ topic: 'Auth', decision: 'Google', contested: contest }]
    expect(mergeLockedDecisions([], next)).toEqual([{ topic: 'Auth', decision: 'Google' }])
  })

  const dismissed = { proposed: 'Square', at: '2026-10-01T00:00:00.000Z' }

  it('ignores a contest repeating a dismissed proposal (case/whitespace-insensitive)', () => {
    const prev = [{ topic: 'Payment', decision: 'Stripe only', locked: true, contest_dismissed: dismissed }]
    const next = [
      { topic: 'Payment', decision: 'Stripe only', contested: { proposed: '  square ', reason: 'again' } },
    ]
    expect(mergeLockedDecisions(prev, next)).toEqual([
      { topic: 'Payment', decision: 'Stripe only', locked: true, contest_dismissed: dismissed },
    ])
  })

  it('a different proposal still lands and contest_dismissed is carried', () => {
    const prev = [{ topic: 'Payment', decision: 'Stripe only', locked: true, contest_dismissed: dismissed }]
    const paypal = { proposed: 'PayPal', reason: 'changed again' }
    const next = [{ topic: 'Payment', decision: 'Stripe only', contested: paypal }]
    expect(mergeLockedDecisions(prev, next)).toEqual([
      {
        topic: 'Payment',
        decision: 'Stripe only',
        locked: true,
        contest_dismissed: dismissed,
        contested: paypal,
      },
    ])
  })

  it('ignores a contest whose proposal equals the current decision', () => {
    const prev = [{ topic: 'Payment', decision: 'Stripe only', locked: true }]
    const next = [
      { topic: 'Payment', decision: 'Stripe only', contested: { proposed: 'STRIPE ONLY ', reason: 'x' } },
    ]
    expect(mergeLockedDecisions(prev, next)).toEqual([
      { topic: 'Payment', decision: 'Stripe only', locked: true },
    ])
  })

  it('carries contest_dismissed forward when regen says nothing', () => {
    const prev = [{ topic: 'Payment', decision: 'Stripe only', locked: true, contest_dismissed: dismissed }]
    expect(mergeLockedDecisions(prev, [])).toEqual(prev)
  })

  it('strips contest_dismissed (and contested) from decisions taken from next', () => {
    const next = [{ topic: 'Auth', decision: 'Google', contest_dismissed: dismissed, contested: contest }]
    expect(mergeLockedDecisions([], next)).toEqual([{ topic: 'Auth', decision: 'Google' }])
    expect(mergeLockedDecisions([d('Stack', 'Next.js', true)], next)).toEqual([
      d('Stack', 'Next.js', true),
      { topic: 'Auth', decision: 'Google' },
    ])
  })
})

describe('lostLocks (#197 Part B)', () => {
  it('returns nothing when every lock survives, even if text or order changed', () => {
    const prev = [d('Stack', 'Next.js', true), d('Auth', 'Google')]
    const next = [d('Auth', 'Google'), d('stack ', 'Next.js, no Vue', true), d('DB', 'Firestore')]
    expect(lostLocks(prev, next)).toEqual([])
  })

  it('names a locked topic that is missing from next', () => {
    expect(lostLocks([d('Stack', 'Next.js', true)], [d('Auth', 'Google')])).toEqual(['Stack'])
  })

  it('names a locked topic that next carries unlocked', () => {
    expect(lostLocks([d('Stack', 'Next.js', true)], [d('Stack', 'Next.js')])).toEqual(['Stack'])
  })

  it('lists several in prev order and ignores unlocked prev decisions', () => {
    const prev = [d('A', '1', true), d('B', '2'), d('C', '3', true)]
    expect(lostLocks(prev, [])).toEqual(['A', 'C'])
  })

  it('handles undefined', () => {
    expect(lostLocks(undefined, undefined)).toEqual([])
    expect(lostLocks([d('A', '1', true)], undefined)).toEqual(['A'])
  })
})

describe('resolveContest (#197 Part A)', () => {
  const contest = { proposed: 'Square', reason: 'switched POS' }
  const list = (): BriefDecision[] => [
    {
      topic: 'Payment',
      decision: 'Stripe only',
      locked: true,
      contested: contest,
      decided_at: '2026-01-01T00:00:00.000Z',
    },
    d('Auth', 'Google'),
  ]

  it('accept: takes the proposed text, keeps the lock, clears contested', () => {
    expect(resolveContest(list(), 'payment', 'accept', '2026-10-15T12:00:00.000Z')).toEqual([
      {
        topic: 'Payment',
        decision: 'Square',
        locked: true,
        decided_at: '2026-01-01T00:00:00.000Z',
      },
      d('Auth', 'Google'),
    ])
  })

  it('accept_unlock: takes the proposed text and removes the lock', () => {
    expect(resolveContest(list(), 'Payment', 'accept_unlock', '2026-10-15T12:00:00.000Z')).toEqual([
      { topic: 'Payment', decision: 'Square', decided_at: '2026-01-01T00:00:00.000Z' },
      d('Auth', 'Google'),
    ])
  })

  it('dismiss: clears contested, remembers the proposal with the given now, changes nothing else', () => {
    expect(resolveContest(list(), 'Payment', 'dismiss', '2026-10-15T12:00:00.000Z')).toEqual([
      {
        topic: 'Payment',
        decision: 'Stripe only',
        locked: true,
        decided_at: '2026-01-01T00:00:00.000Z',
        contest_dismissed: { proposed: 'Square', at: '2026-10-15T12:00:00.000Z' },
      },
      d('Auth', 'Google'),
    ])
  })

  it('accept and accept_unlock clear an older contest_dismissed too', () => {
    const withDismissed = (): BriefDecision[] => [
      { ...list()[0], contest_dismissed: { proposed: 'PayPal', at: '2026-02-01T00:00:00.000Z' } },
    ]
    expect(resolveContest(withDismissed(), 'Payment', 'accept', '2026-10-15T12:00:00.000Z')).toEqual([
      { topic: 'Payment', decision: 'Square', locked: true, decided_at: '2026-01-01T00:00:00.000Z' },
    ])
    expect(resolveContest(withDismissed(), 'Payment', 'accept_unlock', '2026-10-15T12:00:00.000Z')).toEqual([
      { topic: 'Payment', decision: 'Square', decided_at: '2026-01-01T00:00:00.000Z' },
    ])
  })

  it('returns the list unchanged for a topic with no contest', () => {
    const l = list()
    expect(resolveContest(l, 'Auth', 'accept', '2026-10-15T12:00:00.000Z')).toEqual(l)
    expect(resolveContest(l, 'Nope', 'dismiss', '2026-10-15T12:00:00.000Z')).toEqual(l)
  })
})

describe('contestFor (#197)', () => {
  it('accepts a well-formed contest on a locked decision only', () => {
    expect(contestFor(true, { proposed: 'Square', reason: 'why' })).toEqual({
      proposed: 'Square',
      reason: 'why',
    })
    expect(contestFor(false, { proposed: 'Square', reason: 'why' })).toBeUndefined()
  })
  it('rejects malformed input', () => {
    expect(contestFor(true, undefined)).toBeUndefined()
    expect(contestFor(true, 'Square')).toBeUndefined()
    expect(contestFor(true, { proposed: '', reason: 'why' })).toBeUndefined()
    expect(contestFor(true, { proposed: 'Square', reason: 3 })).toBeUndefined()
    expect(contestFor(true, { proposed: 'Square' })).toBeUndefined()
    expect(contestFor(true, { proposed: '   ', reason: 'x' })).toBeUndefined()
    expect(contestFor(true, ['a'])).toBeUndefined()
  })
})

describe('dismissedFor (#197)', () => {
  it('accepts a well-formed dismissal on a locked decision only', () => {
    const v = { proposed: 'Square', at: '2026-10-15T12:00:00.000Z' }
    expect(dismissedFor(true, v)).toEqual(v)
    expect(dismissedFor(false, v)).toBeUndefined()
  })
  it('rejects malformed input', () => {
    expect(dismissedFor(true, undefined)).toBeUndefined()
    expect(dismissedFor(true, 'Square')).toBeUndefined()
    expect(dismissedFor(true, ['a'])).toBeUndefined()
    expect(dismissedFor(true, { proposed: '  ', at: '2026-10-15T12:00:00.000Z' })).toBeUndefined()
    expect(dismissedFor(true, { proposed: 'Square', at: 3 })).toBeUndefined()
    expect(dismissedFor(true, { proposed: 'Square' })).toBeUndefined()
  })
  it('drops extra fields', () => {
    expect(dismissedFor(true, { proposed: 'Square', at: 'x', extra: 1 })).toEqual({ proposed: 'Square', at: 'x' })
  })
})

// #228 part 2 + #229: trivial rewording is not a revision; a new topic's origin
// can come from the note that introduced it.
describe('stampDecisionProvenance: normalised comparison and note origin', () => {
  const NOW = '2026-10-29T20:00:00.000Z'
  const stamped = {
    topic: 'Payment',
    decision: 'Use Stripe only.',
    decided_in_session: 's1',
    decided_at: '2026-07-01T00:00:00Z',
  }

  it('a reworded decision whose normalised text matches keeps prev stamps and gains no revised_*', () => {
    const out = stampDecisionProvenance({
      prev: [stamped],
      next: [d('Payment', 'use stripe only')],
      sessionId: 's9',
      now: NOW,
    })
    expect(out).toEqual([
      { topic: 'Payment', decision: 'use stripe only', decided_in_session: 's1', decided_at: '2026-07-01T00:00:00Z' },
    ])
  })

  it('a real change still stamps revised_*', () => {
    const out = stampDecisionProvenance({
      prev: [stamped],
      next: [d('Payment', 'Use Square')],
      sessionId: 's9',
      now: NOW,
    })
    expect(out[0].revised_at).toBe(NOW)
    expect(out[0].decided_at).toBe('2026-07-01T00:00:00Z')
  })

  it('a new topic with no explicit provenance takes its origin from originByTopic', () => {
    const out = stampDecisionProvenance({
      prev: [],
      next: [d('Hosting', 'Vercel')],
      sessionId: null,
      now: NOW,
      originByTopic: new Map([['hosting', { session_id: 's4', at: '2026-10-20T00:00:00Z' }]]),
    })
    expect(out[0].decided_in_session).toBe('s4')
    expect(out[0].decided_at).toBe('2026-10-20T00:00:00Z')
  })

  it('explicit provenance on the incoming decision still wins over originByTopic', () => {
    const out = stampDecisionProvenance({
      prev: [],
      next: [{ topic: 'Hosting', decision: 'Vercel', decided_in_session: 's2', decided_at: '2026-09-01T00:00:00Z' }],
      sessionId: null,
      now: NOW,
      originByTopic: new Map([['hosting', { session_id: 's4', at: '2026-10-20T00:00:00Z' }]]),
    })
    expect(out[0].decided_in_session).toBe('s2')
    expect(out[0].decided_at).toBe('2026-09-01T00:00:00Z')
  })

  it('a revision on a topic in originByTopic takes that note as the revision (#229)', () => {
    const origin = new Map([['payment', { session_id: 's4', at: '2026-10-20T00:00:00Z' }]])
    const out = stampDecisionProvenance({
      prev: [stamped],
      next: [d('Payment', 'Use Square')],
      sessionId: null,
      now: NOW,
      originByTopic: origin,
    })
    expect(out[0].revised_in_session).toBe('s4')
    expect(out[0].revised_at).toBe('2026-10-20T00:00:00Z')
    expect(out[0].decided_at).toBe('2026-07-01T00:00:00Z')
  })

  it('an explicit differing revised_* still wins over originByTopic', () => {
    const out = stampDecisionProvenance({
      prev: [stamped],
      next: [{ ...d('Payment', 'Use Square'), revised_in_session: 's3', revised_at: '2026-10-05T00:00:00Z' }],
      sessionId: null,
      now: NOW,
      originByTopic: new Map([['payment', { session_id: 's4', at: '2026-10-20T00:00:00Z' }]]),
    })
    expect(out[0].revised_in_session).toBe('s3')
    expect(out[0].revised_at).toBe('2026-10-05T00:00:00Z')
  })

  it('normalizeDecisionText lowercases, strips punctuation and collapses whitespace', () => {
    expect(normalizeDecisionText('  Stripe — ONLY! ')).toBe('stripe only')
  })
})
