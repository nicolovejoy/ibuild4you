import { describe, it, expect } from 'vitest'
import { shouldKickoff, KICKOFF_GAP_MS } from '../kickoff'

const NOW = new Date('2026-06-07T12:00:00Z').getTime()
const ago = (ms: number) => new Date(NOW - ms).toISOString()

describe('shouldKickoff', () => {
  it('returns false for an empty session', () => {
    expect(shouldKickoff([], NOW)).toBe(false)
  })

  it('returns false for a fresh session with only a welcome message', () => {
    const messages = [{ role: 'agent' as const, created_at: ago(2 * KICKOFF_GAP_MS) }]
    expect(shouldKickoff(messages, NOW)).toBe(false)
  })

  it('returns false when the maker just spoke (last message is theirs)', () => {
    const messages = [
      { role: 'agent' as const, created_at: ago(3 * KICKOFF_GAP_MS) },
      { role: 'user' as const, created_at: ago(2 * KICKOFF_GAP_MS) },
    ]
    expect(shouldKickoff(messages, NOW)).toBe(false)
  })

  it('returns false when the gap since the last maker message is under threshold', () => {
    const messages = [
      { role: 'user' as const, created_at: ago(KICKOFF_GAP_MS - 1000) },
      { role: 'agent' as const, created_at: ago(KICKOFF_GAP_MS - 2000) },
    ]
    expect(shouldKickoff(messages, NOW)).toBe(false)
  })

  it('returns true when returning after a break (maker history + gap ≥ 1hr, last msg agent)', () => {
    const messages = [
      { role: 'agent' as const, created_at: ago(3 * KICKOFF_GAP_MS) },
      { role: 'user' as const, created_at: ago(2 * KICKOFF_GAP_MS) },
      { role: 'agent' as const, created_at: ago(2 * KICKOFF_GAP_MS) },
    ]
    expect(shouldKickoff(messages, NOW)).toBe(true)
  })

  it('measures the gap from the most-recent maker message, not the first', () => {
    const messages = [
      { role: 'user' as const, created_at: ago(10 * KICKOFF_GAP_MS) },
      { role: 'agent' as const, created_at: ago(10 * KICKOFF_GAP_MS) },
      { role: 'user' as const, created_at: ago(KICKOFF_GAP_MS / 2) }, // recent — under threshold
      { role: 'agent' as const, created_at: ago(KICKOFF_GAP_MS / 2) },
    ]
    expect(shouldKickoff(messages, NOW)).toBe(false)
  })

  // #70: a return session starts empty (no canned welcome). It should still earn
  // a kickoff when the project has prior maker history past the gap.
  it('fires on an empty session when the project has prior maker history past the gap', () => {
    expect(
      shouldKickoff([], NOW, { projectLastMakerMessageAt: ago(2 * KICKOFF_GAP_MS) }),
    ).toBe(true)
  })

  it('does not fire on an empty session with no project history (true first-ever)', () => {
    expect(shouldKickoff([], NOW, { projectLastMakerMessageAt: null })).toBe(false)
  })

  // 2026-09-17: a builder created session 2 five minutes after session 1. No
  // welcome (#70) and no kickoff (gap < 1hr) left the maker facing a blank chat
  // with no cue to start. An EMPTY return session has no conversation to
  // interrupt, so the gap doesn't apply — always greet.
  it('fires on an empty return session even when project history is under the gap', () => {
    expect(
      shouldKickoff([], NOW, { projectLastMakerMessageAt: ago(5 * 60 * 1000) }),
    ).toBe(true)
  })

  it('still applies the gap to a non-empty session with recent project history', () => {
    const messages = [{ role: 'agent' as const, created_at: ago(60 * 1000) }]
    expect(
      shouldKickoff(messages, NOW, { projectLastMakerMessageAt: ago(5 * 60 * 1000) }),
    ).toBe(false)
  })

  it('does not fire when the maker is mid-turn even if project history is stale', () => {
    const messages = [{ role: 'user' as const, created_at: ago(KICKOFF_GAP_MS / 2) }]
    expect(
      shouldKickoff(messages, NOW, { projectLastMakerMessageAt: ago(2 * KICKOFF_GAP_MS) }),
    ).toBe(false)
  })
})
