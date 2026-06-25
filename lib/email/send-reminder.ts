import { Resend } from 'resend'
import { NOTIFICATION_EMAILS } from '@/lib/constants'
import { copy } from '@/lib/copy'

// Sends the auto-reminder email for a project. Used by the daily cron at
// /api/cron/maker-reminders. To: maker, BCC: builder (NOTIFICATION_EMAILS),
// Reply-To: noreply@ until PR 3 wires per-session inbound reply-to addresses.
//
// REMINDER_DRY_RUN=true → log the would-send and return a synthetic id without
// hitting Resend. Use during initial rollout to confirm targeting before flipping
// the env var off.

export interface SendReminderInput {
  makerEmail: string
  makerFirstName?: string | null
  projectTitle: string
  projectId: string
  shareLink: string
  reminderNumber: 1 | 2 | 3
  // Conversation number for this brief (the waiting session's ordinal). Optional
  // — older projects without a persisted session_count just omit "(#n)".
  sessionNumber?: number | null
}

export interface SendReminderResult {
  emailId: string
  dryRun: boolean
}

const FROM = 'iBuild4you <noreply@ibuild4you.com>'
const REPLY_TO = 'noreply@ibuild4you.com'

function buildSubject(projectTitle: string): string {
  return `Your conversation for "${projectTitle}" is ready`
}

function buildBody(input: SendReminderInput): string {
  // Body is the shared in-app reminder copy (#21) — names the maker + carries
  // the conversation number — plus a minimal sign-off for the email surface.
  return [
    copy.nudge.reminder({
      firstName: input.makerFirstName,
      sessionNumber: input.sessionNumber,
      shareLink: input.shareLink,
    }),
    '',
    '—',
    `iBuild4you`,
  ].join('\n')
}

export async function sendReminderEmail(input: SendReminderInput): Promise<SendReminderResult> {
  const subject = buildSubject(input.projectTitle)
  const text = buildBody(input)
  const dryRun = process.env.REMINDER_DRY_RUN === 'true'

  if (dryRun) {
    console.log(
      JSON.stringify({
        event: 'reminder_email_dry_run',
        project_id: input.projectId,
        to: input.makerEmail,
        bcc: NOTIFICATION_EMAILS,
        subject,
        reminder_number: input.reminderNumber,
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
    to: [input.makerEmail],
    bcc: NOTIFICATION_EMAILS,
    replyTo: REPLY_TO,
    subject,
    text,
  })

  if (error) {
    throw new Error(`Resend error: ${error.name} — ${error.message}`)
  }

  return { emailId: data?.id || 'unknown', dryRun: false }
}
