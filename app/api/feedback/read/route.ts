import { NextResponse, after } from 'next/server'
import { getAdminDb } from '@/lib/firebase/admin'
import { checkRateLimit } from '@/lib/api/rate-limit'
import { isValidAppSlug } from '@/lib/api/apps'
import {
  READ_RATE_LIMIT_PER_MINUTE,
  READ_SCAN_BATCH,
  READ_SCAN_MAX_BATCHES,
  parseReadLimit,
} from '@/lib/feedback/limits'
import { decodeCursor, encodeCursor, senderTag } from '@/lib/feedback/read-crypto'
import { verifyReadKey, touchReadKey } from '@/lib/feedback/read-keys'
import { platformFromUserAgent, summarize } from '@/lib/feedback/read-format'
import type { FeedbackStatus, FeedbackType, ReadItem } from '@/lib/types'

// =============================================================================
// GET /api/feedback/read?app=<slug>&limit=<n>&before=<cursor> (#237)
//
// Server-to-server only: a host app reads its own app's feedback with a
// per-app read key (`Authorization: Bearer lrk_…`). No CORS headers and no
// OPTIONS handler, so a browser page cannot call it cross-origin.
//
// Privacy rule: no email, user agent, page URL, body text or internal note
// ever appears in a response or a log line. Hosts get a summary, a coarse
// platform and a per-app sender tag instead. The summary is the body's first
// line with anything email-shaped replaced by "[email]", since people type
// addresses into feedback.
//
// Every auth failure (missing or malformed header, wrong key, a key for
// another app, an invalid or unknown slug) answers the same 404, so an
// outsider cannot tell which apps exist or have keys.
//
// The rate limit runs only after the key verifies: counting failed attempts
// would let anyone without a key starve the host of its own reads.
//
// Spam is filtered in code rather than with a `status !=` filter, so the
// existing `project_id asc + created_at desc` index serves the query and no
// new composite index is needed. That means one page can take several
// batches; the batch cap bounds the work and hands back a cursor past it.
// =============================================================================

const ONE_MINUTE_MS = 60 * 1000

function json(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return NextResponse.json(body, {
    status,
    headers: { 'Cache-Control': 'no-store', ...headers },
  })
}

function notFound() {
  return json({ error: 'Not found' }, 404)
}

// Token from `Bearer <token>` (scheme case-insensitive), or null.
function bearerToken(request: Request): string | null {
  const header = request.headers.get('authorization')
  if (!header) return null
  const match = /^bearer\s+(.*)$/i.exec(header.trim())
  if (!match) return null
  const token = match[1].trim()
  return token.length > 0 ? token : null
}

export async function GET(request: Request) {
  const secret = process.env.LOOP_SENDER_TAG_SECRET
  if (!secret) return json({ error: 'not_configured' }, 503)

  const params = new URL(request.url).searchParams
  const slug = params.get('app') ?? ''
  const token = bearerToken(request)
  if (!isValidAppSlug(slug) || !token) return notFound()

  const db = getAdminDb()
  const key = await verifyReadKey(db, slug, token)
  if (!key) return notFound()

  const rate = checkRateLimit(`feedback-read:${slug}`, READ_RATE_LIMIT_PER_MINUTE, ONE_MINUTE_MS)
  if (!rate.ok) {
    return json({ error: 'Too many requests' }, 429, {
      'Retry-After': String(rate.retryAfterSeconds),
    })
  }

  const before = params.get('before')
  let cursor: string | null = null
  if (before !== null) {
    cursor = decodeCursor(before)
    if (cursor === null) return json({ error: 'Invalid cursor' }, 400)
  }

  const limit = parseReadLimit(params.get('limit'))

  // Collect limit + 1 non-spam rows: the extra one tells us there is more.
  const kept: Array<{ id: string; data: Record<string, unknown> }> = []
  let lastScanned = cursor
  let hitBatchCap = false
  for (let batch = 0; batch < READ_SCAN_MAX_BATCHES; batch++) {
    let query = db
      .collection('feedback')
      .where('project_id', '==', slug)
      .orderBy('created_at', 'desc')
    if (lastScanned !== null) query = query.startAfter(lastScanned)
    const snap = await query.limit(READ_SCAN_BATCH).get()

    for (const doc of snap.docs) {
      const data = doc.data() as Record<string, unknown>
      lastScanned = data.created_at as string
      if (data.status !== 'spam' && kept.length <= limit) kept.push({ id: doc.id, data })
    }
    if (kept.length > limit || snap.docs.length < READ_SCAN_BATCH) break
    if (batch === READ_SCAN_MAX_BATCHES - 1) hitBatchCap = true
  }

  const page = kept.slice(0, limit)
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://ibuild4you.com'
  const items: ReadItem[] = page.map(({ id, data }) => ({
    id,
    type: data.type as FeedbackType,
    summary: summarize(data.body),
    platform: platformFromUserAgent(data.user_agent as string | null),
    created_at: data.created_at as string,
    status: data.status as FeedbackStatus,
    loop_url: `${baseUrl}/admin/apps/${slug}?id=${encodeURIComponent(id)}`,
    sender: senderTag(secret, slug, data.submitter_email as string | null),
  }))

  // More rows exist: point at the last returned item. Stopped on the batch cap
  // without filling the page: point at the last row scanned, so the next call
  // resumes the scan instead of re-reading the same spam.
  let next_cursor: string | null = null
  if (kept.length > limit) next_cursor = encodeCursor(items[limit - 1].created_at)
  else if (hitBatchCap && lastScanned !== null) next_cursor = encodeCursor(lastScanned)

  const response = json({ items, next_cursor })
  // after() keeps the invocation alive until the touch settles, so it is not
  // dropped when the function freezes after responding. It throws outside a
  // request scope (scripts); fall back to plain fire-and-forget there.
  const lastUsedAt = key.last_used_at
  try {
    after(() => touchReadKey(db, slug, lastUsedAt))
  } catch {
    void touchReadKey(db, slug, lastUsedAt)
  }
  console.log(JSON.stringify({ event: 'loop_read', slug, count: items.length }))
  return response
}
