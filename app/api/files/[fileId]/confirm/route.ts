import { NextResponse } from 'next/server'
import { getAuthenticatedUser, getAdminDb, getProjectRole } from '@/lib/api/firebase-server-helpers'

export async function POST(
  request: Request,
  { params }: { params: Promise<{ fileId: string }> },
) {
  const auth = await getAuthenticatedUser(request)
  if (auth.error) return auth.error

  const { fileId } = await params

  const db = getAdminDb()
  const fileRef = db.collection('files').doc(fileId)
  const fileDoc = await fileRef.get()

  if (!fileDoc.exists) {
    return NextResponse.json({ error: 'File not found' }, { status: 404 })
  }

  const fileData = fileDoc.data()!
  const role = await getProjectRole(db, fileData.project_id, auth.uid, auth.email, auth.systemRoles, auth)
  if (!role) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  const now = new Date().toISOString()
  await fileRef.update({ status: 'ready', updated_at: now })

  return NextResponse.json({
    id: fileId,
    ...fileData,
    status: 'ready',
    updated_at: now,
  })
}
