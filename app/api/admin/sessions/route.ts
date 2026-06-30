import { NextResponse } from 'next/server'
import { getAuthenticatedUser, getAdminDb, hasSystemRole } from '@/lib/api/firebase-server-helpers'
import {
  planReopen,
  planArchive,
  planResetToFresh,
  planAddSyntheticMessage,
  type PlannerSession,
  type Plan,
} from '@/lib/admin/session-ops'

// Admin Brief-doctor (#105): inspect + run curated, non-destructive operations
// on a brief's conversations. Env-agnostic (works in prod, guarded by confirms),
// audit-logged to `admin_actions`. Never hard-deletes — sessions are archived.

async function loadSessionsWithCounts(
  db: ReturnType<typeof getAdminDb>,
  projectId: string
): Promise<PlannerSession[]> {
  const snap = await db.collection('sessions').where('project_id', '==', projectId).get()
  const sessions = await Promise.all(
    snap.docs.map(async (doc) => {
      const count = (await db.collection('messages').where('session_id', '==', doc.id).count().get()).data().count
      const d = doc.data()
      return {
        id: doc.id,
        status: String(d.status ?? 'active'),
        created_at: String(d.created_at ?? ''),
        messageCount: count,
      }
    })
  )
  // Oldest first — conversation #1 at the top.
  return sessions.sort((a, b) => a.created_at.localeCompare(b.created_at))
}

// GET /api/admin/sessions?project_id=… — list a brief's conversations with
// message counts + status, plus the brief title (for the typed-confirm prompt).
export async function GET(request: Request) {
  const auth = await getAuthenticatedUser(request)
  if (auth.error) return auth.error
  if (!hasSystemRole(auth, 'admin')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const projectId = new URL(request.url).searchParams.get('project_id')
  if (!projectId) {
    return NextResponse.json({ error: 'project_id is required' }, { status: 400 })
  }

  const db = getAdminDb()
  const proj = await db.collection('projects').doc(projectId).get()
  if (!proj.exists) {
    return NextResponse.json({ error: 'Brief not found' }, { status: 404 })
  }

  const sessions = await loadSessionsWithCounts(db, projectId)
  const p = proj.data()!
  return NextResponse.json({
    project: {
      id: projectId,
      title: (p.title as string) || '(no title)',
      slug: (p.slug as string) || null,
      session_count: (p.session_count as number | undefined) ?? null,
    },
    sessions: sessions.map((s) => ({
      id: s.id,
      status: s.status,
      created_at: s.created_at,
      message_count: s.messageCount,
    })),
  })
}

// POST /api/admin/sessions — run a curated operation.
// Body: { project_id, op, ...args }. Ops: reopen_conversation | archive_conversation
// | reset_to_fresh | add_synthetic_message.
export async function POST(request: Request) {
  const auth = await getAuthenticatedUser(request)
  if (auth.error) return auth.error
  if (!hasSystemRole(auth, 'admin')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  let body: Record<string, unknown>
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const projectId = typeof body.project_id === 'string' ? body.project_id : ''
  const op = typeof body.op === 'string' ? body.op : ''
  if (!projectId || !op) {
    return NextResponse.json({ error: 'project_id and op are required' }, { status: 400 })
  }

  const db = getAdminDb()
  const projRef = db.collection('projects').doc(projectId)
  const proj = await projRef.get()
  if (!proj.exists) {
    return NextResponse.json({ error: 'Brief not found' }, { status: 404 })
  }
  const briefTitle = (proj.data()!.title as string) || ''

  const sessions = await loadSessionsWithCounts(db, projectId)
  const now = new Date().toISOString()

  let result: Plan | { error: string }
  switch (op) {
    case 'reopen_conversation':
      result = planReopen({
        sessions,
        reopenId: String(body.reopen_id ?? ''),
        archiveId: body.archive_id ? String(body.archive_id) : undefined,
        now,
      })
      break
    case 'archive_conversation':
      result = planArchive({
        sessions,
        sessionId: String(body.session_id ?? ''),
        briefTitle,
        typedConfirm: typeof body.confirm_title === 'string' ? body.confirm_title : undefined,
        now,
      })
      break
    case 'reset_to_fresh':
      result = planResetToFresh({ sessions, now })
      break
    case 'add_synthetic_message': {
      const session = sessions.find((s) => s.id === String(body.session_id ?? ''))
      if (!session) {
        result = { error: 'session_id not found in this brief' }
        break
      }
      result = planAddSyntheticMessage({
        session,
        role: body.role === 'agent' ? 'agent' : 'user',
        content: String(body.content ?? ''),
        now,
      })
      break
    }
    default:
      return NextResponse.json({ error: `Unknown op "${op}"` }, { status: 400 })
  }

  if ('error' in result) {
    return NextResponse.json({ error: result.error }, { status: 400 })
  }

  const batch = db.batch()
  for (const u of result.sessionUpdates) {
    batch.update(db.collection('sessions').doc(u.id), u.patch)
  }
  if (result.projectPatch) {
    batch.update(projRef, { ...result.projectPatch } as Record<string, unknown>)
  }
  for (const m of result.messageInserts) {
    batch.set(db.collection('messages').doc(), m)
  }
  batch.set(db.collection('admin_actions').doc(), {
    ...result.audit,
    actor: auth.email || auth.uid,
    project_id: projectId,
    created_at: now,
  })
  await batch.commit()

  return NextResponse.json({ ok: true, audit: result.audit, sessions: await loadSessionsWithCounts(db, projectId) })
}
