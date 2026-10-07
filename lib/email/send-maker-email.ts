import { Resend } from 'resend'
import { textToEmailHtml } from '@/lib/email/html'

// Generic builder-initiated outbound email to a maker, sent via Resend.
// Kept separate from send-reminder.ts (the cron path) so changes here can't
// destabilize the live auto-reminder flow. From: noreply@; the caller sets
// replyTo to the builder's address so maker replies reach a human.

export interface SendMakerEmailInput {
  // One address, or several for a single shared email (multi-maker nudge —
  // everyone sees everyone, replies go to the whole thread).
  to: string | string[]
  bcc?: string[]
  replyTo?: string
  subject: string
  text: string
  // Optional HTML body. When omitted we derive it from `text` so every email
  // we send has clickable links (#181). Pass your own only if you have a
  // reason to diverge from the text.
  html?: string
}

export interface SendMakerEmailResult {
  emailId: string
}

const FROM = 'iBuild4you <noreply@ibuild4you.com>'

export async function sendMakerEmail(input: SendMakerEmailInput): Promise<SendMakerEmailResult> {
  if (!process.env.RESEND_API_KEY) {
    throw new Error('RESEND_API_KEY is not configured')
  }

  const resend = new Resend(process.env.RESEND_API_KEY)
  const { data, error } = await resend.emails.send({
    from: FROM,
    to: Array.isArray(input.to) ? input.to : [input.to],
    bcc: input.bcc,
    replyTo: input.replyTo,
    subject: input.subject,
    text: input.text,
    html: input.html ?? textToEmailHtml(input.text),
  })

  if (error) {
    throw new Error(`Resend error: ${error.name} — ${error.message}`)
  }

  return { emailId: data?.id || 'unknown' }
}
