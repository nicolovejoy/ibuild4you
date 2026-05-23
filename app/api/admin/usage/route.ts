import { NextResponse } from 'next/server'
import { getAuthenticatedUser, getAdminDb, hasSystemRole } from '@/lib/api/firebase-server-helpers'
import { rollUpUsage, type ApiUsageRow } from '@/lib/api/usage-rollup'

// GET /api/admin/usage?days=14 — admin-only Anthropic API usage rollup.
// Returns shape matching lib/api/usage-rollup.ts UsageRollup.
const ALLOWED_DAYS = new Set([1, 3, 7, 14, 30])
const DEFAULT_DAYS = 14
// Hard ceiling so a misconfigured client doesn't pull the entire collection.
// Each row is ~250B → 5k rows ~= 1.25MB JSON, fine over a single request.
const MAX_ROWS = 5000

export async function GET(request: Request) {
  const auth = await getAuthenticatedUser(request)
  if (auth.error) return auth.error
  if (!hasSystemRole(auth, 'admin')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { searchParams } = new URL(request.url)
  const daysRaw = searchParams.get('days')
  const days = daysRaw ? Number(daysRaw) : DEFAULT_DAYS
  if (!ALLOWED_DAYS.has(days)) {
    return NextResponse.json(
      { error: `days must be one of ${[...ALLOWED_DAYS].join(', ')}` },
      { status: 400 },
    )
  }

  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString()
  const db = getAdminDb()
  const snap = await db
    .collection('api_usage')
    .where('created_at', '>=', since)
    .limit(MAX_ROWS)
    .get()

  const rows: ApiUsageRow[] = snap.docs.map((d) => d.data() as ApiUsageRow)
  const rollup = rollUpUsage(rows, days, since)

  // Hydrate project titles for by_project + top_calls so the client doesn't
  // need a second round-trip. Fetch each unique project id once.
  const projectIds = new Set<string>()
  for (const g of rollup.by_project) {
    if (g.key && g.key !== '(none)') projectIds.add(g.key)
  }
  for (const c of rollup.top_calls) {
    if (c.project_id) projectIds.add(c.project_id)
  }
  const titles: Record<string, string> = {}
  await Promise.all(
    [...projectIds].map(async (id) => {
      try {
        const doc = await db.collection('projects').doc(id).get()
        titles[id] = (doc.data()?.title as string) || '(no title)'
      } catch {
        titles[id] = '(error)'
      }
    }),
  )
  for (const g of rollup.by_project) {
    if (g.key in titles) g.label = titles[g.key]
  }
  for (const c of rollup.top_calls) {
    if (c.project_id in titles) c.project_label = titles[c.project_id]
  }

  return NextResponse.json({
    ...rollup,
    truncated: snap.size === MAX_ROWS,
  })
}
