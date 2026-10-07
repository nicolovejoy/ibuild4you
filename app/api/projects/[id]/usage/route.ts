import { NextResponse } from 'next/server'
import { getAuthenticatedUser, getAdminDb, hasSystemRole } from '@/lib/api/firebase-server-helpers'
import { rollUpProjectUsage, type ApiUsageRow } from '@/lib/api/usage-rollup'
import { isArchivedSession } from '@/lib/sessions/active'
import { labelSessions, type ProjectUsageResponse } from '@/lib/api/project-usage'

// GET /api/projects/[id]/usage — admin-only Anthropic spend for ONE brief:
// total, by route, and one row per conversation (#185). Cost is operator
// telemetry (#120), so this is gated on the admin system role, not on
// project membership.
//
// Query is a single-field equality + limit so it needs no composite index;
// grouping and ordering happen in memory (rollUpProjectUsage).
const MAX_ROWS = 5000

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await getAuthenticatedUser(request)
  if (auth.error) return auth.error
  if (!hasSystemRole(auth, 'admin')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { id: projectId } = await params
  if (!projectId) {
    return NextResponse.json({ error: 'project id is required' }, { status: 400 })
  }

  const db = getAdminDb()
  const [usageSnap, sessionsSnap] = await Promise.all([
    db.collection('api_usage').where('project_id', '==', projectId).limit(MAX_ROWS).get(),
    db.collection('sessions').where('project_id', '==', projectId).get(),
  ])

  const rows = usageSnap.docs.map((d) => d.data() as ApiUsageRow)
  const sessions = sessionsSnap.docs.map((d) => ({
    id: d.id,
    created_at: (d.data().created_at as string) || '',
    // Same predicate /api/sessions uses (status === 'archived').
    archived: isArchivedSession(d.data() as { status?: string }),
  }))

  const rollup = rollUpProjectUsage(rows)
  const body: ProjectUsageResponse = {
    ...rollup,
    by_session: labelSessions(rollup.by_session, sessions),
    truncated: usageSnap.size === MAX_ROWS,
  }
  return NextResponse.json(body)
}
