import { NextResponse } from 'next/server'
import { getAuthenticatedUser, getAdminDb, getProjectRole } from '@/lib/api/firebase-server-helpers'

// GET /api/projects/role?project_id=xxx — get the current user's role on a project
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

  return NextResponse.json({ role })
}
