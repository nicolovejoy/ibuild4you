import { NextResponse } from 'next/server'
import { getAuthenticatedUser, getAdminDb, hasSystemRole } from '@/lib/api/firebase-server-helpers'

// GET /api/admin/interest — admin-only: list all interest form submissions, newest first
export async function GET(request: Request) {
  const auth = await getAuthenticatedUser(request)
  if (auth.error) return auth.error

  if (!hasSystemRole(auth, 'admin')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const db = getAdminDb()
  const snap = await db
    .collection('interest_submissions')
    .orderBy('created_at', 'desc')
    .get()

  const submissions = snap.docs.map((doc) => ({
    id: doc.id,
    ...doc.data(),
  }))

  return NextResponse.json(submissions)
}
