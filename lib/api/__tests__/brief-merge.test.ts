import { describe, it, expect } from 'vitest'
import {
  mergeLockedDecisions,
  reconcileBrief,
  lockedFirst,
  stampDecisionProvenance,
  stripDecisionProvenance,
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
      { topic: 'Payment', decision: 'Stripe', decided_in_session: 's2', decided_at: '2026-07-05T00:00:00Z' },
    ]
    const out = stampDecisionProvenance({
      prev,
      next: [{ topic: 'payment', decision: 'Stripe' }], // topic case differs; text same
      sessionId: null,
      now: NOW,
    })
    expect(out).toEqual([
      { topic: 'payment', decision: 'Stripe', decided_in_session: 's2', decided_at: '2026-07-05T00:00:00Z' },
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
        { topic: 'Auth', decision: 'Google only', decided_in_session: 's1', decided_at: '2026-07-01T00:00:00Z' },
      ],
      next: [
        { topic: 'Auth', decision: 'Google only', decided_in_session: 's9', decided_at: '2099-01-01T00:00:00Z' },
      ],
      sessionId: 's3',
      now: NOW,
    })
    expect(out).toEqual([
      { topic: 'Auth', decision: 'Google only', decided_in_session: 's1', decided_at: '2026-07-01T00:00:00Z' },
    ])
  })

  it('restamps with the current context when the decision text changed this round', () => {
    const out = stampDecisionProvenance({
      prev: [
        { topic: 'Auth', decision: 'Google only', decided_in_session: 's1', decided_at: '2026-07-01T00:00:00Z' },
      ],
      next: [d('Auth', 'Google + passcode')],
      sessionId: 's3',
      now: NOW,
    })
    expect(out).toEqual([
      { topic: 'Auth', decision: 'Google + passcode', decided_in_session: 's3', decided_at: NOW },
    ])
  })

  it('honors explicit provenance on a changed decision (paste path)', () => {
    const out = stampDecisionProvenance({
      prev: [
        { topic: 'Auth', decision: 'Google only', decided_in_session: 's1', decided_at: '2026-07-01T00:00:00Z' },
      ],
      next: [
        { topic: 'Auth', decision: 'Google + passcode', decided_in_session: null, decided_at: '2026-07-10T00:00:00Z' },
      ],
      sessionId: null,
      now: NOW,
    })
    expect(out).toEqual([
      { topic: 'Auth', decision: 'Google + passcode', decided_in_session: null, decided_at: '2026-07-10T00:00:00Z' },
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

  it('handles undefined', () => {
    expect(lockedFirst(undefined)).toEqual([])
  })
})
