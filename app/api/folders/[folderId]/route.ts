import { NextResponse } from 'next/server'
import {
  getAuthenticatedUser,
  getAdminDb,
  getProjectRole,
  requireRole,
} from '@/lib/api/firebase-server-helpers'
import { validateFolderName, isDuplicateFolderName } from '@/lib/files/folders'

// Rename / delete a file folder (#23b). Builder+. Deleting a folder never
// touches the files — they move back to unfiled.

async function loadFolderForWrite(request: Request, folderId: string) {
  const auth = await getAuthenticatedUser(request)
  if (auth.error) return { error: auth.error }

  const db = getAdminDb()
  const ref = db.collection('file_folders').doc(folderId)
  const doc = await ref.get()
  if (!doc.exists) {
    return { error: NextResponse.json({ error: 'Folder not found' }, { status: 404 }) }
  }

  const data = doc.data()!
  const role = await getProjectRole(db, data.project_id, auth.uid, auth.email, auth.systemRoles, auth)
  const roleCheck = requireRole(role, 'builder')
  if (roleCheck) return { error: roleCheck }

  return { db, ref, data }
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ folderId: string }> },
) {
  const { folderId } = await params
  const loaded = await loadFolderForWrite(request, folderId)
  if (loaded.error) return loaded.error
  const { db, ref, data } = loaded

  const body = await request.json().catch(() => ({}))
  const validated = validateFolderName((body as { name?: string }).name ?? '')
  if (!validated.ok) {
    return NextResponse.json({ error: validated.error }, { status: 400 })
  }

  const siblings = await db
    .collection('file_folders')
    .where('project_id', '==', data.project_id)
    .get()
  const others = siblings.docs.map((d) => ({ id: d.id, name: (d.data().name as string) ?? '' }))
  if (isDuplicateFolderName(validated.name, others, folderId)) {
    return NextResponse.json({ error: 'A folder with that name already exists' }, { status: 409 })
  }

  await ref.update({ name: validated.name, updated_at: new Date().toISOString() })
  return NextResponse.json({ id: folderId, ...data, name: validated.name })
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ folderId: string }> },
) {
  const { folderId } = await params
  const loaded = await loadFolderForWrite(request, folderId)
  if (loaded.error) return loaded.error
  const { db, ref } = loaded

  // Move contained files back to unfiled in the same batch as the folder
  // delete, so a folder can never vanish while files still point at it.
  const files = await db.collection('files').where('folder_id', '==', folderId).get()
  const now = new Date().toISOString()
  const batch = db.batch()
  for (const doc of files.docs) {
    batch.update(doc.ref, { folder_id: null, updated_at: now })
  }
  batch.delete(ref)
  await batch.commit()

  return NextResponse.json({ id: folderId, deleted: true, files_moved: files.docs.length })
}
