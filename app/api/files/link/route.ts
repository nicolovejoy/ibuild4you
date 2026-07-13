import { NextResponse } from 'next/server'
import { getAuthenticatedUser, getAdminDb, getProjectRole, requireRole, getUserDisplayName } from '@/lib/api/firebase-server-helpers'
import { validateLinkInput } from '@/lib/files/artifacts'
import crypto from 'crypto'

// POST /api/files/link — create a linked artifact (#83 Phase A). Builder+.
// Body: { project_id, url, filename?, description?, folder_id? }.
// No S3 leg — a linked artifact is a files-collection doc with source:'linked',
// a url, and no storage_path/size_bytes/content_type.
export async function POST(request: Request) {
  const auth = await getAuthenticatedUser(request)
  if (auth.error) return auth.error

  const body = (await request.json().catch(() => ({}))) as {
    project_id?: string
    url?: string
    filename?: string
    description?: string
    folder_id?: string | null
  }

  if (!body.project_id) {
    return NextResponse.json({ error: 'project_id is required' }, { status: 400 })
  }

  const db = getAdminDb()
  const role = await getProjectRole(db, body.project_id, auth.uid, auth.email, auth.systemRoles, auth)
  const roleCheck = requireRole(role, 'builder')
  if (roleCheck) return roleCheck

  const validated = validateLinkInput(body)
  if (!validated.ok) {
    return NextResponse.json({ error: validated.error }, { status: 400 })
  }

  // Optional folder must belong to this project.
  const folderId = body.folder_id ?? null
  if (folderId !== null) {
    const folderDoc = await db.collection('file_folders').doc(folderId).get()
    if (!folderDoc.exists || folderDoc.data()!.project_id !== body.project_id) {
      return NextResponse.json({ error: 'Folder not found in this brief' }, { status: 400 })
    }
  }

  const fileId = crypto.randomUUID()
  const now = new Date().toISOString()
  const displayName = await getUserDisplayName(db, auth.uid, auth.email)

  const doc = {
    project_id: body.project_id,
    filename: validated.value.filename,
    source: 'linked' as const,
    url: validated.value.url,
    ...(validated.value.description && { description: validated.value.description }),
    ...(folderId && { folder_id: folderId }),
    uploaded_by_email: auth.email,
    uploaded_by_uid: auth.uid,
    uploaded_by_name: displayName,
    created_by_role: 'builder' as const,
    status: 'ready' as const,
    created_at: now,
    updated_at: now,
  }
  await db.collection('files').doc(fileId).set(doc)

  return NextResponse.json({ id: fileId, ...doc }, { status: 201 })
}
