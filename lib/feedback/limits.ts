// Anti-abuse limits for POST /api/feedback (see README.md "Anti-abuse rules").
// Lives outside the route file so tests can import it (Next.js route modules
// may only export handlers).

// 20/hr: a maker firing off notes during a guided walkthrough hit the old
// limit of 5 — this is a legit-use ceiling, not just anti-abuse.
export const RATE_LIMIT_PER_HOUR = 20
