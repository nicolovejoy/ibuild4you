import { NextResponse } from 'next/server'
import { getAuthenticatedUser, getAdminDb, hasSystemRole } from '@/lib/api/firebase-server-helpers'
import type { FeedbackStatus, FeedbackType } from '@/lib/types'

const ALLOWED_STATUSES: FeedbackStatus[] = ['new', 'acknowledged', 'in_progress', 'done', 'wontfix']
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
  let query: FirebaseFirestore.Query = db.collection('feedback')
  if (projectId) query = query.where('project_id', '==', projectId)
  if (status) query = query.where('status', '==', status)
  query = query.orderBy('created_at', 'desc')

  const snap = await query.get()
  let rows: Array<Record<string, unknown>> = snap.docs.map((doc) => ({ id: doc.id, ...doc.data() }))
  if (type) {
    rows = rows.filter((r) => r.type === type)
  }

  return NextResponse.json(rows)
}
