// Pure helpers for the notify cron's brief-regeneration circuit breaker. Kept
// separate from the route so the (historically buggy) breaker math is unit
// testable without a Firestore mock.
//
// Background — the cost runaway (2026-06-15, and a similar May incident): a brief
// that always fails to regenerate (e.g. payload exceeds BRIEF_MAX_TOKENS) gets
// retried by the 5-min cron forever, billing a Sonnet call each tick. The breaker
// is meant to stop that after a few failures. The old inline version cleared the
// failure COUNTER when the maker messaged after the streak began, but rewrote
// `failures_since` to the STALE old timestamp — so "maker messaged after the
// streak" stayed true on every subsequent tick and it cleared-and-retried
// forever. The fix: a maker message newer than the streak's start invalidates the
// WHOLE streak (count + since), so the next failure starts a fresh streak from
// `now` and the breaker re-trips and holds.

export const BRIEF_REGEN_FAILURE_CAP = 3

export interface RegenStreak {
  failures: number
  failuresSince: string | null
}

// Normalize a project's persisted failure streak against the latest maker
// message. A maker message strictly newer than the streak's start means the brief
// has new signal worth another attempt — so the streak resets entirely. Otherwise
// the persisted streak stands.
export function normalizeRegenStreak(
  failures: number | null | undefined,
  failuresSince: string | null | undefined,
  lastMakerMessageAt: string | null | undefined,
): RegenStreak {
  const since = failuresSince ?? null
  const count = failures ?? 0
  if (since && lastMakerMessageAt && lastMakerMessageAt > since) {
    return { failures: 0, failuresSince: null }
  }
  return { failures: count, failuresSince: since }
}

// The breaker is tripped once a (normalized) streak reaches the cap.
export function isCircuitBroken(streak: RegenStreak, cap: number = BRIEF_REGEN_FAILURE_CAP): boolean {
  return streak.failures >= cap
}

// Next persisted streak after a failed regen attempt: bump the count, and anchor
// `failuresSince` to now if this is the first failure of a fresh streak.
export function streakAfterFailure(streak: RegenStreak, nowIso: string): RegenStreak {
  return {
    failures: streak.failures + 1,
    failuresSince: streak.failuresSince ?? nowIso,
  }
}
