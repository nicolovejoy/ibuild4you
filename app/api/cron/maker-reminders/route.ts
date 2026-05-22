import { NextResponse } from 'next/server'
import { getAdminDb } from '@/lib/api/firebase-server-helpers'
import { decideReminder } from '@/lib/api/reminder-cadence'
import { sendReminderEmail } from '@/lib/email/send-reminder'

// Daily cron (see vercel.json — "0 16 * * *" = 09:00 PT in summer).
// For each project that's opted in to auto-reminders, check the cadence
// (2d → 5d → 10d, cap at 3 per maker-engagement cycle) and email the maker.
//
// Maker activity in /api/chat resets the cycle (reminders_sent_count=0,
// last_reminder_sent_at=null) so the next prepped session starts fresh.
//
// Safety rails:
// - Set REMINDER_DRY_RUN=true in Vercel env to log decisions without sending.
// - Per-project failures are logged and skipped — one bad project shouldn't
//   block the rest of the batch (lesson learned from the brief-regen loop).

export async function GET(request: Request) {
  const authHeader = request.headers.get('Authorization')
  const secret = process.env.CRON_SECRET
  if (secret && authHeader !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const db = getAdminDb()
  const now = new Date()
  const nowIso = now.toISOString()

  // Narrow upstream: only projects that have opted in. Skips most of the
  // collection without per-doc work.
  const candidates = await db
    .collection('projects')
    .where('auto_reminders_enabled', '==', true)
    .get()

  type Outcome =
    | { project_id: string; result: 'sent'; reminder_number: number; email_id: string; dry_run: boolean }
    | { project_id: string; result: 'skipped'; reason: string }
    | { project_id: string; result: 'error'; message: string }

  const outcomes: Outcome[] = []

  for (const doc of candidates.docs) {
    const project = doc.data()
    const projectId = doc.id

    try {
      const decision = decideReminder(
        {
          autoRemindersEnabled: project.auto_reminders_enabled as boolean | undefined,
          requesterEmail: project.requester_email as string | undefined,
          remindersSentCount: project.reminders_sent_count as number | undefined,
          lastReminderSentAt: project.last_reminder_sent_at as string | null | undefined,
          latestSessionCreatedAt: project.latest_session_created_at as string | null | undefined,
          sharedAt: project.shared_at as string | null | undefined,
          lastMakerMessageAt: project.last_maker_message_at as string | null | undefined,
        },
        now,
      )

      if (!decision.send) {
        outcomes.push({ project_id: projectId, result: 'skipped', reason: decision.reason })
        continue
      }

      const slug = (project.slug as string) || projectId
      const result = await sendReminderEmail({
        makerEmail: project.requester_email as string,
        makerFirstName: (project.requester_first_name as string | undefined) || null,
        projectTitle: (project.title as string) || 'Untitled project',
        projectId,
        shareLink: `https://ibuild4you.com/projects/${slug}`,
        reminderNumber: decision.reminderNumber,
      })

      const prevCount = (project.reminders_sent_count as number | undefined) ?? 0
      await doc.ref.update({
        reminders_sent_count: prevCount + 1,
        last_reminder_sent_at: nowIso,
        updated_at: nowIso,
      })

      await db.collection('reminder_log').add({
        project_id: projectId,
        maker_email: project.requester_email,
        reminder_number: decision.reminderNumber,
        days_since_last_touch: decision.daysSinceLastTouch,
        email_id: result.emailId,
        dry_run: result.dryRun,
        sent_at: nowIso,
      })

      outcomes.push({
        project_id: projectId,
        result: 'sent',
        reminder_number: decision.reminderNumber,
        email_id: result.emailId,
        dry_run: result.dryRun,
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      console.error(`[cron/maker-reminders] error for project ${projectId}:`, message)
      outcomes.push({ project_id: projectId, result: 'error', message })
    }
  }

  // Aggregate counts for the response (the per-project array is useful in
  // logs but noisy in the cron-run summary).
  const summary = {
    candidates: candidates.size,
    sent: outcomes.filter((o) => o.result === 'sent').length,
    skipped: outcomes.filter((o) => o.result === 'skipped').length,
    errors: outcomes.filter((o) => o.result === 'error').length,
  }

  console.log(
    JSON.stringify({
      event: 'maker_reminders_cron',
      ...summary,
      outcomes,
      ts: nowIso,
    }),
  )

  return NextResponse.json({ ...summary, outcomes })
}
