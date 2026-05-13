// Simple in-memory rate limiter for public endpoints.
//
// Keyed by IP + bucket name; sliding window via a list of recent hit timestamps.
// Lives in the warm Fluid Compute instance — accurate within a single instance
// but a determined attacker can scale across instances. Good enough for the
// FeedbackWidget threat model (low-stakes, invite-only platform).
//
// Disable with RATE_LIMIT_DISABLED=true (useful in tests).

type Bucket = number[] // ms timestamps of recent hits, oldest first

const buckets = new Map<string, Bucket>()

export type RateLimitResult =
  | { ok: true; remaining: number }
  | { ok: false; retryAfterSeconds: number }

export function checkRateLimit(
  key: string,
  limit: number,
  windowMs: number,
  now: number = Date.now()
): RateLimitResult {
  if (process.env.RATE_LIMIT_DISABLED === 'true') {
    return { ok: true, remaining: limit }
  }

  const cutoff = now - windowMs
  const existing = buckets.get(key) ?? []
  // Drop expired hits.
  const fresh = existing.filter((t) => t > cutoff)

  if (fresh.length >= limit) {
    const oldestKept = fresh[0]
    const retryAfterSeconds = Math.max(1, Math.ceil((oldestKept + windowMs - now) / 1000))
    // Persist the trimmed window so we don't keep stale entries.
    buckets.set(key, fresh)
    return { ok: false, retryAfterSeconds }
  }

  fresh.push(now)
  buckets.set(key, fresh)
  return { ok: true, remaining: limit - fresh.length }
}

// Pull the best-effort client IP from request headers. Vercel sets x-forwarded-for;
// fall back to x-real-ip. Returns 'unknown' if neither is present.
export function getClientIp(request: Request): string {
  const xff = request.headers.get('x-forwarded-for')
  if (xff) return xff.split(',')[0].trim()
  const xri = request.headers.get('x-real-ip')
  if (xri) return xri.trim()
  return 'unknown'
}

// Test-only: clear the in-memory store between tests.
export function _resetRateLimit(): void {
  buckets.clear()
}
