import { NextResponse } from 'next/server'
import { getAdminDb } from '@/lib/firebase/admin'

// GET /api/health — unauthenticated health check that verifies critical Firestore queries
// This catches missing indexes, connectivity issues, and query shape problems
export async function GET() {
  const checks: { name: string; ok: boolean; ms: number; error?: string }[] = []

  const db = getAdminDb()

  // Check 1: Basic connectivity — can we read from Firestore at all?
  await runCheck(checks, 'firestore_connection', async () => {
    await db.collection('projects').limit(1).get()
  })

  // Check 2: Projects listing query (admin path — orderBy created_at)
  await runCheck(checks, 'projects_list', async () => {
    await db.collection('projects').orderBy('created_at', 'desc').limit(1).get()
  })

  // Check 3: Sessions by project_id + created_at
  await runCheck(checks, 'sessions_by_project', async () => {
    await db
      .collection('sessions')
      .where('project_id', '==', '__health_check__')
      .orderBy('created_at', 'asc')
      .limit(1)
      .get()
  })

  // Check 4: Messages by session_id + created_at ASC (chat history)
  await runCheck(checks, 'messages_by_session_asc', async () => {
    await db
      .collection('messages')
      .where('session_id', '==', '__health_check__')
      .orderBy('created_at', 'asc')
      .limit(1)
      .get()
  })

  // Check 5: Messages by session_id + created_at DESC (enrichment query)
  await runCheck(checks, 'messages_by_session_desc', async () => {
    await db
      .collection('messages')
      .where('session_id', 'in', ['__health_check__'])
      .orderBy('created_at', 'desc')
      .limit(1)
      .get()
  })

  // Check 6: Briefs by project_id + version DESC
  await runCheck(checks, 'briefs_by_project', async () => {
    await db
      .collection('briefs')
      .where('project_id', '==', '__health_check__')
      .orderBy('version', 'desc')
      .limit(1)
      .get()
  })

  // Check 7: Projects by requester_id + created_at (non-admin listing)
  await runCheck(checks, 'projects_by_requester', async () => {
    await db
      .collection('projects')
      .where('requester_id', '==', '__health_check__')
      .orderBy('created_at', 'desc')
      .limit(1)
      .get()
  })

  // Check 8: Projects by requester_email + created_at (shared listing)
  await runCheck(checks, 'projects_by_email', async () => {
    await db
      .collection('projects')
      .where('requester_email', '==', '__health_check__')
      .orderBy('created_at', 'desc')
      .limit(1)
      .get()
  })

  const allOk = checks.every((c) => c.ok)

  return NextResponse.json(
    { ok: allOk, checks, timestamp: new Date().toISOString() },
    { status: allOk ? 200 : 503 }
  )
}

async function runCheck(
  checks: { name: string; ok: boolean; ms: number; error?: string }[],
  name: string,
  fn: () => Promise<unknown>
) {
  const start = Date.now()
  try {
    await fn()
    checks.push({ name, ok: true, ms: Date.now() - start })
  } catch (err) {
    checks.push({
      name,
      ok: false,
      ms: Date.now() - start,
      error: err instanceof Error ? err.message : String(err),
    })
  }
}
