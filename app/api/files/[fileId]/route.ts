import { NextResponse } from 'next/server'
import { getAuthenticatedUser, getAdminDb, getProjectRole, requireRole } from '@/lib/api/firebase-server-helpers'
import { GetObjectCommand } from '@aws-sdk/client-s3'
import { s3, S3_BUCKET, deleteS3Object } from '@/lib/s3/client'

export async function GET(
  request: Request,
  { params }: { params: Promise<{ fileId: string }> }
) {
  const auth = await getAuthenticatedUser(request)
  if (auth.error) return auth.error

  const { fileId } = await params

  const db = getAdminDb()
  const fileDoc = await db.collection('files').doc(fileId).get()

  if (!fileDoc.exists) {
    return NextResponse.json({ error: 'File not found' }, { status: 404 })
  }

  const fileData = fileDoc.data()!
  const role = await getProjectRole(db, fileData.project_id, auth.uid, auth.email, auth.systemRoles, auth)
  if (!role) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  // Pending files have no S3 object yet (init succeeded, confirm not called).
  // Treat as not-found instead of attempting an S3 fetch that would 502.
  if (fileData.status === 'pending') {
    return NextResponse.json({ error: 'File not ready' }, { status: 404 })
  }

  try {
    const result = await s3.send(new GetObjectCommand({
      Bucket: S3_BUCKET,
      Key: fileData.storage_path,
    }))

    if (!result.Body) {
      return NextResponse.json({ error: 'File data missing' }, { status: 502 })
    }

    const bytes = await result.Body.transformToByteArray()

    return new Response(Buffer.from(bytes) as unknown as BodyInit, {
      headers: {
        'Content-Type': fileData.content_type,
        'Content-Disposition': `inline; filename="${encodeURIComponent(fileData.filename)}"`,
        'Cache-Control': 'private, max-age=3600',
      },
    })
  } catch (err) {
    console.error('S3 download failed:', err)
    return NextResponse.json({ error: 'File download failed' }, { status: 502 })
  }
}

// PATCH /api/files/[fileId] — move a file into a folder (#23b). Builder+.
// Body: { folder_id: string | null } — null moves it back to unfiled.
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ fileId: string }> }
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
  const roleCheck = requireRole(role, 'builder')
  if (roleCheck) return roleCheck

  const body = await request.json().catch(() => ({}))
  if (!('folder_id' in (body as Record<string, unknown>))) {
    return NextResponse.json({ error: 'folder_id is required (null to unfile)' }, { status: 400 })
  }
  const folderId = (body as { folder_id: string | null }).folder_id

  if (folderId !== null) {
    if (typeof folderId !== 'string' || !folderId) {
      return NextResponse.json({ error: 'folder_id must be a string or null' }, { status: 400 })
    }
    const folderDoc = await db.collection('file_folders').doc(folderId).get()
    if (!folderDoc.exists || folderDoc.data()!.project_id !== fileData.project_id) {
      return NextResponse.json({ error: 'Folder not found in this brief' }, { status: 400 })
    }
  }

  await fileRef.update({ folder_id: folderId, updated_at: new Date().toISOString() })
  return NextResponse.json({ id: fileId, folder_id: folderId })
}

// DELETE /api/files/[fileId] — remove a file (S3 object + Firestore doc).
// Builder+ only (#23a). Dangling file_ids on old messages are left as-is — they
// degrade gracefully (download 404s, UI shows nothing).
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ fileId: string }> }
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
  const roleCheck = requireRole(role, 'builder')
  if (roleCheck) return roleCheck

  // Delete the S3 object first (idempotent, tolerate failure so a missing/
  // already-gone object can't strand the Firestore doc). Then drop the doc.
  if (fileData.storage_path) {
    try {
      await deleteS3Object(fileData.storage_path)
    } catch (err) {
      console.error('S3 delete failed (continuing to delete the doc):', err)
    }
  }
  await fileRef.delete()

  return NextResponse.json({ id: fileId, deleted: true })
}
