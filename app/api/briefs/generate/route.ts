import { NextResponse } from 'next/server'
import { getAuthenticatedUser, getAdminDb, getProjectRole, requireRole } from '@/lib/api/firebase-server-helpers'
import { regenerateBriefForProject } from '@/lib/api/briefs'

// POST /api/briefs/generate — generate/update the brief for a project (builder+)
export async function POST(request: Request) {
  const auth = await getAuthenticatedUser(request)
  if (auth.error) return auth.error

  const body = await request.json()
  const { project_id } = body

  if (!project_id) {
    return NextResponse.json({ error: 'project_id is required' }, { status: 400 })
  }

  const db = getAdminDb()

  const role = await getProjectRole(db, project_id, auth.uid, auth.email, auth.systemRoles)
  const roleCheck = requireRole(role, 'builder')
  if (roleCheck) return roleCheck

  try {
    const result = await regenerateBriefForProject(db, project_id)
    return NextResponse.json(result)
  } catch (err) {
    if (err instanceof Error && err.message === 'regenerate_brief_no_messages') {
      return NextResponse.json({ error: 'No messages to generate brief from' }, { status: 400 })
    }
    console.error('Brief generation error:', err)
    return NextResponse.json({ error: 'Failed to generate brief' }, { status: 500 })
  }
}
