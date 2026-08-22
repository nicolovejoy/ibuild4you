import { NextResponse } from 'next/server'
import { getAdminDb } from '@/lib/firebase/admin'
import { garmProbe } from '@/lib/garm'

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

  // (Former checks 7/8 — projects by requester_id / requester_email — removed
  // with the legacy listing queries they exercised, Garm PR E.)

  // Check 7: Garm liveness. Sign-in is gated on Garm fail-closed, so Garm being
  // unreachable means nobody can sign in — this must not go unnoticed. A deny
  // from Garm is healthy (proves URL/key/scope/DB all work); only "Garm didn't
  // answer well-formed 200" fails this check. See lib/garm.ts's garmProbe for
  // why garmCheck itself can't be reused here.
  await runCheck(checks, 'garm_reachable', async () => {
    const result = await garmProbe()
    if (!result.ok) {
      throw new Error(result.error ?? `garm probe failed (status ${result.status ?? 'unknown'})`)
    }
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
