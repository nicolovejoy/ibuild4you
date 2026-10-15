import { NextResponse } from 'next/server'
import { getAuthenticatedUser, getAdminDb, getProjectRole, requireRole } from '@/lib/api/firebase-server-helpers'
import type { BriefVersion } from '@/lib/types'

// #194: archived versions of a project's brief, newest first. Builder tooling
// (the Brief tab's History list) — makers read only the live brief.
const MAX_VERSIONS = 50

// GET /api/briefs/versions?project_id=xxx
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
  if (!role) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const roleCheck = requireRole(role, 'builder')
  if (roleCheck) return roleCheck

  const liveSnap = await db
    .collection('briefs')
    .where('project_id', '==', projectId)
    .orderBy('version', 'desc')
    .limit(1)
    .get()
  if (liveSnap.empty) return NextResponse.json({ versions: [] })

  const versionsSnap = await liveSnap.docs[0].ref
    .collection('versions')
    .orderBy('version', 'desc')
    .limit(MAX_VERSIONS)
    .get()

  const versions: BriefVersion[] = versionsSnap.docs.map((d) => {
    const v = d.data()
    return {
      version: v.version as number,
      content: v.content as BriefVersion['content'],
      updated_at: v.updated_at as string,
      source: (v.source as BriefVersion['source']) ?? null,
      archived_at: v.archived_at as string,
    }
  })

  return NextResponse.json({ versions })
}
