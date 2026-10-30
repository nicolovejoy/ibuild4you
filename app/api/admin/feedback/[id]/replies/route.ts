import { NextResponse } from 'next/server'
import { requireFeedbackAccess } from '@/lib/api/feedback-access'
import { getAuthenticatedUser, getAdminDb, hasSystemRole } from '@/lib/api/firebase-server-helpers'

// GET /api/admin/feedback/[id]/replies — admins and collaborators+ on the row's app: list replies for a
// feedback row, oldest first (chronological thread). Inbound submitter
// replies arrive via the Resend webhook; admin replies (future work) would
// be added through a separate POST that emails the submitter back.
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await getAuthenticatedUser(request)
  if (auth.error) return auth.error
  const { id } = await params
  if (!id) {
    return NextResponse.json({ error: 'id is required' }, { status: 400 })
  }

  const db = getAdminDb()
  // Admins skip the row load; everyone else is checked against the row's app.
  if (!hasSystemRole(auth, 'admin')) {
    const row = await db.collection('feedback').doc(id).get()
    if (!row.exists) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    const denied = await requireFeedbackAccess(auth, row.data()!.project_id as string)
    if (denied) return denied
  }
  const snap = await db
    .collection('feedback')
    .doc(id)
    .collection('replies')
    .orderBy('created_at', 'asc')
    .get()

  const rows = snap.docs.map((doc) => ({ id: doc.id, ...doc.data() }))
  return NextResponse.json(rows)
}
