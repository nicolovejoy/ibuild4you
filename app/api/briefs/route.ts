import { NextResponse } from 'next/server'
import { getAuthenticatedUser, getAdminDb, getProjectRole, requireRole } from '@/lib/api/firebase-server-helpers'
import { upsertBrief } from '@/lib/api/briefs'
import type { BriefContent } from '@/lib/types'

// GET /api/briefs?project_id=xxx — get the latest brief for a project
export async function GET(request: Request) {
  const auth = await getAuthenticatedUser(request)
  if (auth.error) return auth.error

  const { searchParams } = new URL(request.url)
  const projectId = searchParams.get('project_id')

  if (!projectId) {
    return NextResponse.json({ error: 'project_id is required' }, { status: 400 })
  }

  const db = getAdminDb()

  const role = await getProjectRole(db, projectId, auth.uid, auth.email, auth.systemRoles)
  if (!role) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  const snapshot = await db
    .collection('briefs')
    .where('project_id', '==', projectId)
    .orderBy('version', 'desc')
    .limit(1)
    .get()

  if (snapshot.empty) {
    return NextResponse.json(null)
  }

  const doc = snapshot.docs[0]
  return NextResponse.json({ id: doc.id, ...doc.data() })
}

// PUT /api/briefs — upsert a brief from pasted JSON (builder+)
export async function PUT(request: Request) {
  const auth = await getAuthenticatedUser(request)
  if (auth.error) return auth.error

  const body = await request.json()
  const { project_id, content } = body

  if (!project_id) {
    return NextResponse.json({ error: 'project_id is required' }, { status: 400 })
  }

  const db = getAdminDb()

  const role = await getProjectRole(db, project_id, auth.uid, auth.email, auth.systemRoles)
  const roleCheck = requireRole(role, 'builder')
  if (roleCheck) return roleCheck

  // Validate BriefContent shape
  const validationError = validateBriefContent(content)
  if (validationError) {
    return NextResponse.json({ error: validationError }, { status: 400 })
  }

  // Normalize the content
  const briefContent: BriefContent = {
    problem: typeof content.problem === 'string' ? content.problem : '',
    target_users: typeof content.target_users === 'string' ? content.target_users : '',
    features: Array.isArray(content.features) ? content.features.filter((f: unknown) => typeof f === 'string') : [],
    constraints: typeof content.constraints === 'string' ? content.constraints : '',
    additional_context: typeof content.additional_context === 'string' ? content.additional_context : '',
    decisions: Array.isArray(content.decisions)
      ? content.decisions.filter(
          (d: unknown) => d && typeof (d as Record<string, unknown>).topic === 'string' && typeof (d as Record<string, unknown>).decision === 'string'
        )
      : [],
    open_risks: Array.isArray(content.open_risks)
      ? content.open_risks.filter((r: unknown) => typeof r === 'string' && (r as string).trim())
      : [],
  }

  // Upsert: find existing brief or create new
  const result = await upsertBrief(db, project_id, briefContent)

  return NextResponse.json(result)
}

function validateBriefContent(content: unknown): string | null {
  if (!content || typeof content !== 'object') {
    return 'content must be an object with BriefContent shape'
  }

  const c = content as Record<string, unknown>

  // At least one field should have data
  const hasData =
    (typeof c.problem === 'string' && c.problem.length > 0) ||
    (typeof c.target_users === 'string' && c.target_users.length > 0) ||
    (Array.isArray(c.features) && c.features.length > 0) ||
    (typeof c.constraints === 'string' && c.constraints.length > 0) ||
    (typeof c.additional_context === 'string' && c.additional_context.length > 0) ||
    (Array.isArray(c.decisions) && c.decisions.length > 0)

  if (!hasData) {
    return 'Brief content is empty — at least one field must have data'
  }

  return null
}

