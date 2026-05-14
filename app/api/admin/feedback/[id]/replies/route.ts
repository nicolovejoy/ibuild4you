import { NextResponse } from 'next/server'
import { getAuthenticatedUser, getAdminDb, hasSystemRole } from '@/lib/api/firebase-server-helpers'

// GET /api/admin/feedback/[id]/replies — admin-only: list replies for a
// feedback row, oldest first (chronological thread). Inbound submitter
// replies arrive via the Resend webhook; admin replies (future work) would
// be added through a separate POST that emails the submitter back.
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await getAuthenticatedUser(request)
  if (auth.error) return auth.error
  if (!hasSystemRole(auth, 'admin')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { id } = await params
  if (!id) {
    return NextResponse.json({ error: 'id is required' }, { status: 400 })
  }

  const db = getAdminDb()
  const snap = await db
    .collection('feedback')
    .doc(id)
    .collection('replies')
    .orderBy('created_at', 'asc')
    .get()

  const rows = snap.docs.map((doc) => ({ id: doc.id, ...doc.data() }))
  return NextResponse.json(rows)
}
