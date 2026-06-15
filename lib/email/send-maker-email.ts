import { Resend } from 'resend'

// Generic builder-initiated outbound email to a maker, sent via Resend.
// Kept separate from send-reminder.ts (the cron path) so changes here can't
// destabilize the live auto-reminder flow. From: noreply@; the caller sets
// replyTo to the builder's address so maker replies reach a human.

export interface SendMakerEmailInput {
  to: string
  bcc?: string[]
  replyTo?: string
  subject: string
  text: string
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
    to: [input.to],
    bcc: input.bcc,
    replyTo: input.replyTo,
    subject: input.subject,
    text: input.text,
  })

  if (error) {
    throw new Error(`Resend error: ${error.name} — ${error.message}`)
  }

  return { emailId: data?.id || 'unknown' }
}
