import { NextResponse } from 'next/server'
import { getAdminDb } from '@/lib/api/firebase-server-helpers'
import { decideReminder } from '@/lib/api/reminder-cadence'
import { sendReminderDigest } from '@/lib/email/send-reminder'
import { groupReminderSends, type PendingReminder } from '@/lib/email/reminder-digest'

// Daily cron (see vercel.json — "0 16 * * *" = 09:00 PT in summer).
// For each project that's opted in to auto-reminders, check the cadence
// (2d → 5d → 10d, cap at 3 per maker-engagement cycle) and email the maker.
//
// Two passes (#141): pass 1 decides every candidate; pass 2 groups the pending
// sends by maker email and sends ONE email per maker (a maker on N briefs used
// to get N near-identical emails in a single cron run). Counters + one
// reminder_log row are still tracked PER PROJECT — the batch shares one
// email_id, which is the batch marker /admin/reminders reads.
//
// Known limitation: targeting reads project.requester_email only, so additional
// makers on multi-maker briefs don't get cron reminders (that's the #115
// fan-out surface — deliberately out of scope here).
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

  // Pass 1: decide every candidate. Skips/errors are recorded immediately;
  // pending sends are collected (with the per-project bookkeeping the send pass
  // needs) so they can be grouped by maker before sending.
  type Bookkeeping = {
    docRef: (typeof candidates.docs)[number]['ref']
    prevCount: number
    daysSinceLastTouch: number
  }
  const pending: PendingReminder[] = []
  const bookkeeping = new Map<string, Bookkeeping>()

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
      pending.push({
        projectId,
        makerEmail: project.requester_email as string,
        makerFirstName: (project.requester_first_name as string | undefined) || null,
        projectTitle: (project.title as string) || 'Untitled project',
        shareLink: `https://ibuild4you.com/projects/${slug}`,
        sessionNumber: (project.session_count as number | undefined) ?? null,
        reminderNumber: decision.reminderNumber,
      })
      bookkeeping.set(projectId, {
        docRef: doc.ref,
        prevCount: (project.reminders_sent_count as number | undefined) ?? 0,
        daysSinceLastTouch: decision.daysSinceLastTouch,
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

  // Pass 2: one email per maker. A batch shares a single email_id across its
  // projects; each project still advances its own cadence + logs its own row.
  let emailsDispatched = 0
  for (const batch of groupReminderSends(pending)) {
    let result: { emailId: string; dryRun: boolean }
    try {
      result = await sendReminderDigest(batch)
    } catch (err) {
      // A failed batch send fails every project in it — none advance.
      const message = err instanceof Error ? err.message : String(err)
      console.error(
        `[cron/maker-reminders] batch send failed for ${batch.email}:`,
        message,
      )
      for (const item of batch.items) {
        const bk = bookkeeping.get(item.projectId)
        await record(item.projectId, item.makerEmail, {
          decision: 'error',
          reason: message,
          reminder_number: item.reminderNumber,
          days_since_last_touch: bk?.daysSinceLastTouch ?? null,
          email_id: null,
          dry_run: false,
        })
      }
      continue
    }

    if (!result.dryRun) emailsDispatched++

    for (const item of batch.items) {
      const bk = bookkeeping.get(item.projectId)
      // Only a REAL send advances the cadence. In dry-run we log the would-send
      // but leave the counters untouched — otherwise dry-run would silently
      // consume a real maker's 3-reminder budget before we ever flip live.
      if (!result.dryRun && bk) {
        await bk.docRef.update({
          reminders_sent_count: bk.prevCount + 1,
          last_reminder_sent_at: nowIso,
          updated_at: nowIso,
        })
      }
      await record(item.projectId, item.makerEmail, {
        decision: result.dryRun ? 'would_send' : 'sent',
        reason: null,
        reminder_number: item.reminderNumber,
        days_since_last_touch: bk?.daysSinceLastTouch ?? null,
        email_id: result.emailId,
        dry_run: result.dryRun,
      })
    }
  }

  // Aggregate counts for the response (the per-project array is useful in
  // logs but noisy in the cron-run summary). `emails` = distinct emails
  // actually dispatched (< `sent` when makers share briefs).
  const summary = {
    candidates: candidates.size,
    sent: outcomes.filter((o) => o.decision === 'sent').length,
    emails: emailsDispatched,
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
