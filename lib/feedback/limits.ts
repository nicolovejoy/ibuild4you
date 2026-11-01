// Anti-abuse limits for POST /api/feedback (see README.md "Anti-abuse rules").
// Lives outside the route file so tests can import it (Next.js route modules
// may only export handlers).

// 20/hr: a maker firing off notes during a guided walkthrough hit the old
// limit of 5 — this is a legit-use ceiling, not just anti-abuse.
export const RATE_LIMIT_PER_HOUR = 20

// Loop read API (GET /api/feedback/read, #237).
// 60/min per app, counted only after the app's read key verifies.
export const READ_RATE_LIMIT_PER_MINUTE = 60
export const READ_LIMIT_DEFAULT = 20
export const READ_LIMIT_MAX = 50
// Spam is filtered in code, so one page may need several Firestore batches.
// The batch cap bounds the work per request; past it the caller gets a cursor.
export const READ_SCAN_BATCH = 100
export const READ_SCAN_MAX_BATCHES = 5

// `limit` query param: non-numeric or missing → default; else floored and
// clamped to 1..READ_LIMIT_MAX.
export function parseReadLimit(raw: string | null): number {
  if (raw === null || raw.trim() === '') return READ_LIMIT_DEFAULT
  const n = Number(raw)
  if (!Number.isFinite(n)) return READ_LIMIT_DEFAULT
  return Math.min(READ_LIMIT_MAX, Math.max(1, Math.floor(n)))
}
