import { NextResponse } from 'next/server'
import { getAuthenticatedUser, getAdminDb, hasSystemRole } from '@/lib/api/firebase-server-helpers'
import { findAppBySlug } from '@/lib/api/apps'
import type { FeedbackStatus, FeedbackType } from '@/lib/types'

const ALLOWED_STATUSES: FeedbackStatus[] = ['new', 'acknowledged', 'in_progress', 'done', 'wontfix', 'spam']
const ALLOWED_TYPES: FeedbackType[] = ['bug', 'idea', 'other']

// GET /api/admin/feedback — list feedback submissions, newest first.
// Filters (all optional, all AND-ed): ?projectId=...&status=...&type=...
//
// Firestore can compose project_id + status with the existing index. Adding
// type into the filter would need another composite index; we filter by type
// in memory since the result set is small (admin UI, not user-facing).
export async function GET(request: Request) {
  const auth = await getAuthenticatedUser(request)
  if (auth.error) return auth.error
  if (!hasSystemRole(auth, 'admin')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { searchParams } = new URL(request.url)
  const projectId = searchParams.get('projectId')?.trim() || null
  const status = searchParams.get('status')?.trim() || null
  const type = searchParams.get('type')?.trim() || null

  if (status && !ALLOWED_STATUSES.includes(status as FeedbackStatus)) {
    return NextResponse.json({ error: 'Invalid status' }, { status: 400 })
  }
  if (type && !ALLOWED_TYPES.includes(type as FeedbackType)) {
    return NextResponse.json({ error: 'Invalid type' }, { status: 400 })
  }

  const db = getAdminDb()
  // A filter by app also matches rows stored under the app's legacy slugs
  // (pre-migration rows keep their old project_id). A projectId that matches no
  // app falls back to exact match so old free-text links keep working.
  let ids: string[] = []
  if (projectId) {
    const app = await findAppBySlug(db, projectId)
    ids = app ? [app.slug, ...(app.legacy_slugs ?? [])] : [projectId]
  }

  const runQuery = (id: string | null) => {
    let query: FirebaseFirestore.Query = db.collection('feedback')
    if (id) query = query.where('project_id', '==', id)
    if (status) query = query.where('status', '==', status)
    return query.orderBy('created_at', 'desc').get()
  }

  // One == query per id (the existing project_id+created_at index serves each;
  // no new composite index), merged newest first in memory. ids is a handful.
  const snaps = await Promise.all((ids.length ? ids : [null]).map(runQuery))
  let rows: Array<Record<string, unknown>> = snaps.flatMap((snap) =>
    snap.docs.map((doc) => ({ id: doc.id, ...doc.data() }))
  )
  if (snaps.length > 1) {
    rows.sort((a, b) => String(b.created_at ?? '').localeCompare(String(a.created_at ?? '')))
  }
  if (type) {
    rows = rows.filter((r) => r.type === type)
  }
  // Spam is hidden from the default view but reachable via ?status=spam.
  // In-memory like the type filter — no != composite index needed.
  if (!status) {
    rows = rows.filter((r) => r.status !== 'spam')
  }

  return NextResponse.json(rows)
}
