import { NextResponse } from 'next/server'
import { getAdminDb } from '@/lib/api/firebase-server-helpers'
import { regenerateBriefForProject } from '@/lib/api/briefs'
import { NOTIFICATION_EMAILS } from '@/lib/constants'
import { getMakerShortName } from '@/lib/copy'
import { Resend } from 'resend'

function getResend() {
  return new Resend(process.env.RESEND_API_KEY)
}

const BRIEF_IDLE_MS = 10 * 60 * 1000 // 10 min — brief regen fires once a session has been idle this long
const BRIEF_REGEN_FAILURE_CAP = 3 // skip a project once it's failed this many times in a row; cleared on next maker turn or manual builder regen

// Every 5 min (see vercel.json). Two responsibilities:
//   1. Send debounced notification digests for projects where notify_after has passed
//   2. Auto-regenerate the brief for projects whose latest maker message is at
//      least 10 minutes old and whose brief is stale (older than that message)
export async function GET(request: Request) {
  const authHeader = request.headers.get('Authorization')
  const secret = process.env.CRON_SECRET
  if (secret && authHeader !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const db = getAdminDb()
  const now = new Date().toISOString()

  // ---- 1. Notification digests --------------------------------------------

  const readySnap = await db
    .collection('projects')
    .where('notify_after', '<', now)
    .get()

  let sent = 0
  const errors: string[] = []

  for (const doc of readySnap.docs) {
    const data = doc.data()
    const projectId = doc.id
    const title = (data.title as string) || 'Untitled project'
    const slug = (data.slug as string) || projectId
    const makerName = getMakerShortName(
      data.requester_first_name as string | undefined,
      data.requester_email as string | undefined,
      'the maker'
    )
    const pendingSince = data.notify_pending_since as string | undefined
    const subject = `New messages from ${makerName} in ${title}`
    const body = [
      `${makerName} has new messages in "${title}".`,
      pendingSince ? `First unread message at ${pendingSince}.` : '',
      '',
      `Open project: https://ibuild4you.com/projects/${slug}`,
    ]
      .filter(Boolean)
      .join('\n')

    try {
      await getResend().emails.send({
        from: 'iBuild4you <noreply@ibuild4you.com>',
        to: NOTIFICATION_EMAILS,
        subject,
        text: body,
      })
      sent++
    } catch (err) {
      console.error(`[cron/notify] send failed for project ${projectId}:`, err)
      errors.push(projectId)
      continue
    }

    await doc.ref.update({
      notify_after: null,
      notify_pending_since: null,
      notify_last_sent_at: now,
    })
  }

  // ---- 2. Idle-based brief regeneration -----------------------------------

  const idleCutoff = new Date(Date.now() - BRIEF_IDLE_MS).toISOString()
  const idleSnap = await db
    .collection('projects')
    .where('last_maker_message_at', '<', idleCutoff)
    .get()

  let regenerated = 0
  const regenErrors: string[] = []

  let circuitBroken = 0

  for (const doc of idleSnap.docs) {
    const projectId = doc.id
    const data = doc.data()
    const lastMakerAt = data.last_maker_message_at as string | undefined
    if (!lastMakerAt) continue

    // Circuit breaker: once a project has failed BRIEF_REGEN_FAILURE_CAP times
    // in a row, stop retrying every 5 min. POST /api/briefs/generate (manual)
    // and any new maker turn both clear the counter. Closes the cost-runaway
    // class of bug that caused the May 21 incident.
    const failures = (data.brief_regen_failures as number | undefined) ?? 0
    const failuresSince = data.brief_regen_failures_since as string | undefined
    if (failures >= BRIEF_REGEN_FAILURE_CAP) {
      // If the maker has messaged after the failure streak started, clear it
      // and try again on the next cron tick.
      if (failuresSince && lastMakerAt > failuresSince) {
        await doc.ref.update({
          brief_regen_failures: 0,
          brief_regen_failures_since: null,
          brief_regen_last_error: null,
        })
      } else {
        circuitBroken++
        continue
      }
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

    try {
      await regenerateBriefForProject(db, projectId)
      regenerated++
      if (failures > 0) {
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
      await doc.ref.update({
        brief_regen_failures: failures + 1,
        brief_regen_failures_since: failuresSince || now,
        brief_regen_last_error: errMsg.slice(0, 200),
        brief_regen_last_error_at: now,
      })
    }
  }

  return NextResponse.json({
    sent,
    errors,
    checked: readySnap.size,
    regenerated,
    regen_errors: regenErrors,
    circuit_broken: circuitBroken,
    idle_checked: idleSnap.size,
  })
}
