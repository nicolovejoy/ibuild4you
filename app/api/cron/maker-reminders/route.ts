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
//   Dry-run is side-effect-free: it records a 'would_send' decision but does
//   NOT advance the cadence counters, so it can't eat a real maker's budget.
// - Every decision (sent / would_send / skipped / error) is written to the
//   reminder_log collection — surfaced at /admin/reminders.
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

  // Every decision — send, would-send (dry-run), skip, error — is recorded as
  // a reminder_log row so /admin/reminders is the self-observable surface that
  // replaces the REMINDER_DRY_RUN env switch.
  type Decision = 'sent' | 'would_send' | 'skipped' | 'error'
  type Outcome = {
    project_id: string
    decision: Decision
    reason: string | null
    reminder_number: number | null
    days_since_last_touch: number | null
    email_id: string | null
    dry_run: boolean
  }

  const outcomes: Outcome[] = []

  // Write the decision row + push it onto the in-memory outcomes for the
  // cron-run summary. Logging failures are swallowed — a bad log write must
  // not abort the batch or block a real send.
  async function record(
    projectId: string,
    makerEmail: string | null,
    o: Omit<Outcome, 'project_id'>,
  ) {
    outcomes.push({ project_id: projectId, ...o })
    try {
      await db.collection('reminder_log').add({
        project_id: projectId,
        maker_email: makerEmail,
        decision: o.decision,
        reason: o.reason,
        reminder_number: o.reminder_number,
        days_since_last_touch: o.days_since_last_touch,
        email_id: o.email_id,
        dry_run: o.dry_run,
        decided_at: nowIso,
      })
    } catch (logErr) {
      console.error(
        `[cron/maker-reminders] failed to log decision for ${projectId}:`,
        logErr instanceof Error ? logErr.message : String(logErr),
      )
    }
  }

  for (const doc of candidates.docs) {
    const project = doc.data()
    const projectId = doc.id
    const makerEmail = (project.requester_email as string | undefined) || null

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
        await record(projectId, makerEmail, {
          decision: 'skipped',
          reason: decision.reason,
          reminder_number: null,
          days_since_last_touch: null,
          email_id: null,
          dry_run: false,
        })
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
        sessionNumber: (project.session_count as number | undefined) ?? null,
      })

      // Only a REAL send advances the cadence. In dry-run we log the
      // would-send but leave reminders_sent_count / last_reminder_sent_at
      // untouched — otherwise dry-run would silently consume a real maker's
      // 3-reminder budget before we ever flip live.
      if (!result.dryRun) {
        const prevCount = (project.reminders_sent_count as number | undefined) ?? 0
        await doc.ref.update({
          reminders_sent_count: prevCount + 1,
          last_reminder_sent_at: nowIso,
          updated_at: nowIso,
        })
      }

      await record(projectId, makerEmail, {
        decision: result.dryRun ? 'would_send' : 'sent',
        reason: null,
        reminder_number: decision.reminderNumber,
        days_since_last_touch: decision.daysSinceLastTouch,
        email_id: result.emailId,
        dry_run: result.dryRun,
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      console.error(`[cron/maker-reminders] error for project ${projectId}:`, message)
      await record(projectId, makerEmail, {
        decision: 'error',
        reason: message,
        reminder_number: null,
        days_since_last_touch: null,
        email_id: null,
        dry_run: false,
      })
    }
  }

  // Aggregate counts for the response (the per-project array is useful in
  // logs but noisy in the cron-run summary).
  const summary = {
    candidates: candidates.size,
    sent: outcomes.filter((o) => o.decision === 'sent').length,
    would_send: outcomes.filter((o) => o.decision === 'would_send').length,
    skipped: outcomes.filter((o) => o.decision === 'skipped').length,
    errors: outcomes.filter((o) => o.decision === 'error').length,
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
