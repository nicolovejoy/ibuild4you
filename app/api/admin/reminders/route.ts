import { NextResponse } from 'next/server'
import { getAuthenticatedUser, getAdminDb, hasSystemRole } from '@/lib/api/firebase-server-helpers'

// GET /api/admin/reminders — admin-only view of recent maker-reminder
// decisions written by the daily cron (app/api/cron/maker-reminders).
//
// Every cron decision (sent / would_send / skipped / error) is a reminder_log
// row. This lists the most recent ones, newest first, with project titles
// hydrated so the client doesn't need a second round-trip. This is the
// self-observable surface that replaces the REMINDER_DRY_RUN env switch.
//
// Filters (optional, AND-ed): ?projectId=...&decision=...
// decision is filtered in memory (small result set; avoids a composite index).

const ALLOWED_DECISIONS = new Set(['sent', 'would_send', 'skipped', 'error'])
const DEFAULT_LIMIT = 200
const MAX_LIMIT = 1000

export async function GET(request: Request) {
  const auth = await getAuthenticatedUser(request)
  if (auth.error) return auth.error
  if (!hasSystemRole(auth, 'admin')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { searchParams } = new URL(request.url)
  const projectId = searchParams.get('projectId')?.trim() || null
  const decision = searchParams.get('decision')?.trim() || null
  const limitRaw = searchParams.get('limit')
  const limit = Math.min(limitRaw ? Number(limitRaw) || DEFAULT_LIMIT : DEFAULT_LIMIT, MAX_LIMIT)

  if (decision && !ALLOWED_DECISIONS.has(decision)) {
    return NextResponse.json({ error: 'Invalid decision' }, { status: 400 })
  }

  const db = getAdminDb()
  let query: FirebaseFirestore.Query = db.collection('reminder_log')
  if (projectId) query = query.where('project_id', '==', projectId)
  query = query.orderBy('decided_at', 'desc').limit(limit)

  const snap = await query.get()
  let rows: Array<Record<string, unknown>> = snap.docs.map((doc) => ({ id: doc.id, ...doc.data() }))
  if (decision) {
    rows = rows.filter((r) => r.decision === decision)
  }

  // Hydrate project titles for the unique project ids in this page.
  const projectIds = new Set<string>()
  for (const r of rows) {
    if (typeof r.project_id === 'string') projectIds.add(r.project_id)
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
  for (const r of rows) {
    r.project_title = titles[r.project_id as string] ?? null
  }

  return NextResponse.json({ rows, truncated: snap.size === limit })
}
