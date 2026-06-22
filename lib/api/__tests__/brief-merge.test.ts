import { describe, it, expect } from 'vitest'
import { mergeLockedDecisions, reconcileBrief, lockedFirst } from '../brief-merge'
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
