import { NextResponse } from 'next/server'
import {
  getAuthenticatedUser,
  getAdminDb,
  getProjectRole,
  requireRole,
} from '@/lib/api/firebase-server-helpers'
import { validateFolderName, isDuplicateFolderName } from '@/lib/files/folders'
import type { FileFolder } from '@/lib/types'

// File folders (#23b) — flat, per-project. GET: any member. POST: builder+.

async function listFolders(db: FirebaseFirestore.Firestore, projectId: string) {
  const snap = await db.collection('file_folders').where('project_id', '==', projectId).get()
  // Sorted in memory — folder counts are small and this avoids a composite index.
  return snap.docs
    .map((doc) => ({ id: doc.id, ...doc.data() }) as FileFolder)
    .sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()))
}

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

  return NextResponse.json(await listFolders(db, projectId))
}

export async function POST(request: Request) {
  const auth = await getAuthenticatedUser(request)
  if (auth.error) return auth.error

  const body = await request.json().catch(() => ({}))
  const { project_id, name } = body as { project_id?: string; name?: string }

  if (!project_id) {
    return NextResponse.json({ error: 'project_id is required' }, { status: 400 })
  }

  const db = getAdminDb()
  const role = await getProjectRole(db, project_id, auth.uid, auth.email, auth.systemRoles, auth)
  if (!role) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }
  const roleCheck = requireRole(role, 'builder')
  if (roleCheck) return roleCheck

  const validated = validateFolderName(name ?? '')
  if (!validated.ok) {
    return NextResponse.json({ error: validated.error }, { status: 400 })
  }

  const existing = await listFolders(db, project_id)
  if (isDuplicateFolderName(validated.name, existing)) {
    return NextResponse.json({ error: 'A folder with that name already exists' }, { status: 409 })
  }

  const now = new Date().toISOString()
  const ref = db.collection('file_folders').doc()
  const folder = {
    project_id,
    name: validated.name,
    created_by_email: auth.email,
    created_at: now,
    updated_at: now,
  }
  await ref.set(folder)

  return NextResponse.json({ id: ref.id, ...folder }, { status: 201 })
}
