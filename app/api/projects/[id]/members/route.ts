import { NextResponse } from 'next/server'
import {
  getAuthenticatedUser,
  getAdminDb,
  getProjectRole,
  requireRole,
  getUserDisplayName,
} from '@/lib/api/firebase-server-helpers'
import type { BriefRole, MemberRole } from '@/lib/types'

// Display order: console operators first, then chat participants, then by time.
const ROLE_RANK: Record<string, number> = { owner: 0, builder: 1, apprentice: 2, maker: 3 }

export interface ProjectMemberSummary {
  id: string
  email: string
  display_name: string
  role: MemberRole | null
  brief_role: BriefRole | null
  added_by: string | null
  created_at: string | null
}

// GET /api/projects/[id]/members — builder+ lists everyone on the brief with
// their access tier + brief_role, for the Setup-tab Roles panel.
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await getAuthenticatedUser(request)
  if (auth.error) return auth.error

  const { id: projectId } = await params
  if (!projectId) {
    return NextResponse.json({ error: 'project id is required' }, { status: 400 })
  }

  const db = getAdminDb()
  const callerRole = await getProjectRole(db, projectId, auth.uid, auth.email, auth.systemRoles, auth)
  const roleCheck = requireRole(callerRole, 'builder')
  if (roleCheck) return roleCheck

  const snap = await db
    .collection('project_members')
    .where('project_id', '==', projectId)
    .get()

  const members: ProjectMemberSummary[] = await Promise.all(
    snap.docs.map(async (doc) => {
      const d = doc.data()
      const email = (d.email as string) || ''
      return {
        id: doc.id,
        email,
        display_name: await getUserDisplayName(db, (d.user_id as string) || '', email),
        role: (d.role as MemberRole | undefined) ?? null,
        brief_role: (d.brief_role as BriefRole | null | undefined) ?? null,
        added_by: (d.added_by as string | undefined) ?? null,
        created_at: (d.created_at as string | undefined) ?? null,
      }
    })
  )

  members.sort(
    (a, b) =>
      (ROLE_RANK[a.role ?? ''] ?? 9) - (ROLE_RANK[b.role ?? ''] ?? 9) ||
      (a.created_at || '').localeCompare(b.created_at || '')
  )

  return NextResponse.json({ members })
}
