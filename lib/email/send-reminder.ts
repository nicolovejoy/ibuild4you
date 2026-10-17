import { Resend } from 'resend'
import { NOTIFICATION_EMAILS } from '@/lib/constants'
import { buildReminderEmail, type MakerBatch } from '@/lib/email/reminder-digest'

// Sends the auto-reminder digest email for a maker. Used by the daily cron at
// /api/cron/maker-reminders. To: maker, BCC: builder (NOTIFICATION_EMAILS),
// Reply-To: noreply@ until PR 3 wires per-session inbound reply-to addresses.
//
// REMINDER_DRY_RUN=true → log the would-send and return a synthetic id without
// hitting Resend. Use during initial rollout to confirm targeting before flipping
// the env var off.

export interface SendReminderResult {
  emailId: string
  dryRun: boolean
}

const FROM = 'iBuild4you <noreply@ibuild4you.com>'
const REPLY_TO = 'noreply@ibuild4you.com'

// Send ONE reminder email for a maker's whole batch of pending briefs (#141).
// Single-brief batches render as a plain reminder; multi-brief batches collapse
// into one digest so a maker on N briefs gets 1 email, not N.
export async function sendReminderDigest(batch: MakerBatch): Promise<SendReminderResult> {
  const { subject, text, html } = buildReminderEmail(batch)
  const dryRun = process.env.REMINDER_DRY_RUN === 'true'
  const projectIds = batch.items.map((i) => i.projectId)

  if (dryRun) {
    console.log(
      JSON.stringify({
        event: 'reminder_email_dry_run',
        project_ids: projectIds,
        to: batch.email,
        bcc: NOTIFICATION_EMAILS,
        subject,
        brief_count: batch.items.length,
        text_preview: text.slice(0, 200),
      }),
    )
    return { emailId: 'dry-run', dryRun: true }
  }

  if (!process.env.RESEND_API_KEY) {
    throw new Error('RESEND_API_KEY is not configured')
  }

  const resend = new Resend(process.env.RESEND_API_KEY)
  const { data, error } = await resend.emails.send({
    from: FROM,
    to: [batch.email],
    bcc: NOTIFICATION_EMAILS,
    replyTo: REPLY_TO,
    subject,
    text,
    html,
  })

  if (error) {
    throw new Error(`Resend error: ${error.name} — ${error.message}`)
  }

  return { emailId: data?.id || 'unknown', dryRun: false }
}
