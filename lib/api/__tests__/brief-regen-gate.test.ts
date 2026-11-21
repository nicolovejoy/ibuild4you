import { describe, it, expect } from 'vitest'
import {
  normalizeRegenStreak,
  isCircuitBroken,
  streakAfterFailure,
  lastActivityAt,
  BRIEF_REGEN_FAILURE_CAP,
} from '../brief-regen-gate'

const T0 = Date.parse('2026-06-15T12:00:00.000Z')
const at = (msFromT0: number) => new Date(T0 + msFromT0).toISOString()
const MIN = 60 * 1000

describe('lastActivityAt', () => {
  it('is undefined when neither a maker message nor an email exists', () => {
    expect(lastActivityAt(undefined, undefined)).toBeUndefined()
    expect(lastActivityAt(null, null)).toBeUndefined()
  })

  it('is the maker message when there is no email', () => {
    expect(lastActivityAt(at(-30 * MIN), undefined)).toBe(at(-30 * MIN))
    expect(lastActivityAt(at(-30 * MIN), null)).toBe(at(-30 * MIN))
  })

  it('is the email when there is no maker message', () => {
    expect(lastActivityAt(undefined, at(-30 * MIN))).toBe(at(-30 * MIN))
    expect(lastActivityAt(null, at(-30 * MIN))).toBe(at(-30 * MIN))
  })

  it('is the later of the two when both exist, in either order', () => {
    expect(lastActivityAt(at(-30 * MIN), at(-10 * MIN))).toBe(at(-10 * MIN))
    expect(lastActivityAt(at(-10 * MIN), at(-30 * MIN))).toBe(at(-10 * MIN))
  })
})

describe('normalizeRegenStreak', () => {
  it('preserves the streak when no maker message exists', () => {
    expect(normalizeRegenStreak(3, at(-60 * MIN), null)).toEqual({
      failures: 3,
      failuresSince: at(-60 * MIN),
    })
  })

  it('preserves the streak when the maker last messaged BEFORE it started', () => {
    // failure streak began 20m ago; maker's last message was 60m ago → still valid
    expect(normalizeRegenStreak(3, at(-20 * MIN), at(-60 * MIN))).toEqual({
      failures: 3,
      failuresSince: at(-20 * MIN),
    })
  })

  it('RESETS the streak when the maker messaged AFTER it started (the bug)', () => {
    // streak began 60m ago; maker messaged 30m ago → new signal, reset entirely
    expect(normalizeRegenStreak(3, at(-60 * MIN), at(-30 * MIN))).toEqual({
      failures: 0,
      failuresSince: null,
    })
  })

  it('RESETS the streak when an email arrived AFTER it started (activity = the email)', () => {
    // streak began 60m ago; maker last messaged 90m ago, but an email came 30m ago
    const activity = lastActivityAt(at(-90 * MIN), at(-30 * MIN))
    expect(normalizeRegenStreak(3, at(-60 * MIN), activity)).toEqual({
      failures: 0,
      failuresSince: null,
    })
  })

  it('treats missing counters as a zero streak', () => {
    expect(normalizeRegenStreak(undefined, undefined, at(0))).toEqual({
      failures: 0,
      failuresSince: null,
    })
  })
})

describe('isCircuitBroken', () => {
  it('is broken at the cap', () => {
    expect(isCircuitBroken({ failures: BRIEF_REGEN_FAILURE_CAP, failuresSince: at(0) })).toBe(true)
  })
  it('is not broken below the cap', () => {
    expect(isCircuitBroken({ failures: BRIEF_REGEN_FAILURE_CAP - 1, failuresSince: at(0) })).toBe(false)
  })
})

describe('streakAfterFailure', () => {
  it('anchors failuresSince to now when starting a fresh streak', () => {
    expect(streakAfterFailure({ failures: 0, failuresSince: null }, at(0))).toEqual({
      failures: 1,
      failuresSince: at(0),
    })
  })

  it('keeps the original failuresSince while a streak is ongoing', () => {
    expect(streakAfterFailure({ failures: 1, failuresSince: at(-5 * MIN) }, at(0))).toEqual({
      failures: 2,
      failuresSince: at(-5 * MIN),
    })
  })

  // The end-to-end guarantee: after a maker message resets the streak, three more
  // failures re-trip the breaker — and it then HOLDS (the old code never did).
  it('re-trips and holds after a reset (no infinite retry)', () => {
    let streak = normalizeRegenStreak(99, at(-90 * MIN), at(-45 * MIN)) // reset by maker msg
    expect(streak).toEqual({ failures: 0, failuresSince: null })
    streak = streakAfterFailure(streak, at(0)) // tick 1 fails → since = now
    streak = streakAfterFailure(streak, at(5 * MIN)) // tick 2
    streak = streakAfterFailure(streak, at(10 * MIN)) // tick 3
    expect(isCircuitBroken(streak)).toBe(true)
    // No new maker message since the reset → normalization leaves it broken.
    const lastMakerAt = at(-45 * MIN)
    expect(isCircuitBroken(normalizeRegenStreak(streak.failures, streak.failuresSince, lastMakerAt))).toBe(true)
  })
})
