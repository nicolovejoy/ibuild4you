import { NextResponse } from 'next/server'
import { getAdminDb } from '@/lib/api/firebase-server-helpers'
import { regenerateBriefForProject } from '@/lib/api/briefs'
import { normalizeRegenStreak, isCircuitBroken, streakAfterFailure } from '@/lib/api/brief-regen-gate'

const BRIEF_IDLE_MS = 10 * 60 * 1000 // 10 min — brief regen fires once a session has been idle this long

// Every 5 min (see vercel.json). Auto-regenerates the brief for projects whose
// latest maker message is at least 10 minutes old and whose brief is stale
// (older than that message).
//
// Notification email moved out to the daily /api/cron/notify-digest cron (#65) —
// /api/chat still sets notify_after/notify_pending_since; this cron no longer
// reads them.
export async function GET(request: Request) {
  const authHeader = request.headers.get('Authorization')
  const secret = process.env.CRON_SECRET
  if (secret && authHeader !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const db = getAdminDb()
  const now = new Date().toISOString()

  // ---- Idle-based brief regeneration --------------------------------------

  const idleCutoff = new Date(Date.now() - BRIEF_IDLE_MS).toISOString()
  const idleSnap = await db
    .collection('projects')
    .where('last_maker_message_at', '<', idleCutoff)
    .get()

  let regenerated = 0
  const regenErrors: string[] = []

  let circuitBroken = 0
  let archivedSkipped = 0

  for (const doc of idleSnap.docs) {
    const projectId = doc.id
    const data = doc.data()
    const lastMakerAt = data.last_maker_message_at as string | undefined
    if (!lastMakerAt) continue

    // Circuit breaker: once a project's brief has failed to regenerate
    // BRIEF_REGEN_FAILURE_CAP times in a row, stop retrying every 5 min — a
    // permanently-failing brief (e.g. payload over BRIEF_MAX_TOKENS) would
    // otherwise bill a Sonnet call on every tick (the 2026-06-15 cost runaway).
    // A maker message newer than the streak's start resets it (see
    // normalizeRegenStreak — this is the bit the old inline code got wrong, where
    // it cleared the counter but kept the stale timestamp and retried forever).
    // A manual POST /api/briefs/generate also clears the counter.
    const streak = normalizeRegenStreak(
      data.brief_regen_failures as number | undefined,
      data.brief_regen_failures_since as string | undefined,
      lastMakerAt,
    )
    if (isCircuitBroken(streak)) {
      circuitBroken++
      continue
    }

    const briefSnap = await db
      .collection('briefs')
      .where('project_id', '==', projectId)
      .orderBy('version', 'desc')
      .limit(1)
      .get()

    const briefUpdatedAt = briefSnap.empty
      ? null
      : (briefSnap.docs[0].data().updated_at as string | undefined)

    // Skip if the brief is already at least as fresh as the last maker turn.
    if (briefUpdatedAt && briefUpdatedAt >= lastMakerAt) continue

    // Skip briefs everyone has archived — nobody's watching, so don't spend on
    // regenerating them. (Archive is per-viewer; we only skip when every member
    // has archived, so a builder still using a shared brief keeps it live.)
    const membersSnap = await db
      .collection('project_members')
      .where('project_id', '==', projectId)
      .get()
    const allArchived =
      membersSnap.size > 0 && membersSnap.docs.every((m) => !!m.data().archived_at)
    if (allArchived) {
      archivedSkipped++
      continue
    }

    try {
      await regenerateBriefForProject(db, projectId)
      regenerated++
      // Clear any prior failure state on success.
      if ((data.brief_regen_failures as number | undefined) || data.brief_regen_failures_since) {
        await doc.ref.update({
          brief_regen_failures: 0,
          brief_regen_failures_since: null,
          brief_regen_last_error: null,
        })
      }
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err)
      console.error(`[cron/notify] brief regen failed for project ${projectId}:`, err)
      regenErrors.push(projectId)
      const next = streakAfterFailure(streak, now)
      await doc.ref.update({
        brief_regen_failures: next.failures,
        brief_regen_failures_since: next.failuresSince,
        brief_regen_last_error: errMsg.slice(0, 200),
        brief_regen_last_error_at: now,
      })
    }
  }

  return NextResponse.json({
    regenerated,
    regen_errors: regenErrors,
    circuit_broken: circuitBroken,
    archived_skipped: archivedSkipped,
    idle_checked: idleSnap.size,
  })
}
