import { NextResponse } from 'next/server'
import { getAuthenticatedUser, getAdminDb, getProjectRole } from '@/lib/api/firebase-server-helpers'

// POST handler removed in Phase 2 — uploads now go through:
//   POST /api/files/init   (presigned URL)
//   PUT  <upload_url>      (direct to S3)
//   POST /api/files/:id/confirm

export async function GET(request: Request) {
  const auth = await getAuthenticatedUser(request)
  if (auth.error) return auth.error

  const { searchParams } = new URL(request.url)
  const projectId = searchParams.get('project_id')

  if (!projectId) {
    return NextResponse.json({ error: 'project_id is required' }, { status: 400 })
  }

  const db = getAdminDb()
  const role = await getProjectRole(db, projectId, auth.uid, auth.email, auth.systemRoles, auth)
  if (!role) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  const snap = await db
    .collection('files')
    .where('project_id', '==', projectId)
    .orderBy('created_at', 'desc')
    .get()

  // Hide files still in the upload-pending state. Legacy files written before
  // the status field existed have no `status` and are treated as ready.
  const files = snap.docs
    .map((doc) => ({ id: doc.id, ...doc.data() }))
    .filter((f) => (f as { status?: string }).status !== 'pending')
  return NextResponse.json(files)
}
