import { NextResponse } from 'next/server'
import { getAdminDb } from '@/lib/api/firebase-server-helpers'
import { regenerateBriefForProject } from '@/lib/api/briefs'
import { NOTIFICATION_EMAILS } from '@/lib/constants'
import { Resend } from 'resend'

function getResend() {
  return new Resend(process.env.RESEND_API_KEY)
}

const BRIEF_IDLE_MS = 10 * 60 * 1000 // 10 min — brief regen fires once a session has been idle this long

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
    const makerName =
      (data.requester_first_name as string) ||
      (data.requester_email as string | undefined)?.split('@')[0] ||
      'the maker'
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

  for (const doc of idleSnap.docs) {
    const projectId = doc.id
    const lastMakerAt = doc.data().last_maker_message_at as string | undefined
    if (!lastMakerAt) continue

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
    } catch (err) {
      console.error(`[cron/notify] brief regen failed for project ${projectId}:`, err)
      regenErrors.push(projectId)
    }
  }

  return NextResponse.json({
    sent,
    errors,
    checked: readySnap.size,
    regenerated,
    regen_errors: regenErrors,
    idle_checked: idleSnap.size,
  })
}
