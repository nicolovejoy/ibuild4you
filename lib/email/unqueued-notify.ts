// Builder-facing email: a maker opened a conversation but nothing is queued
// for them (#214). Sent at most once per session by the kickoff route.

import { Resend } from 'resend'
import { NOTIFICATION_EMAILS } from '@/lib/constants'
import { textToEmailHtml } from '@/lib/email/html'

export interface UnqueuedEmailInput {
  makerName: string
  projectTitle: string
  slug: string
  openedAt: string
}

export function buildUnqueuedEmail({ makerName, projectTitle, slug, openedAt }: UnqueuedEmailInput) {
  const when = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Los_Angeles',
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(openedAt))
  const base = process.env.NEXT_PUBLIC_APP_URL || 'https://ibuild4you.com'
  const text = [
    `${makerName} opened a conversation on "${projectTitle}" but you haven't queued the next one, so they were told you'll be in touch.`,
    `Opened ${when} Pacific.`,
    `${base}/projects/${slug}?tab=conversations`,
  ].join('\n\n')
  return {
    subject: `${makerName} opened "${projectTitle}" — nothing queued`,
    text,
    html: textToEmailHtml(text),
  }
}

/** Returns false when nothing was sent (suppressed or no API key). */
export async function sendUnqueuedNotification(input: UnqueuedEmailInput): Promise<boolean> {
  if (process.env.FEEDBACK_NOTIFY_SUPPRESS === 'on') return false
  if (!process.env.RESEND_API_KEY) return false
  const { subject, text, html } = buildUnqueuedEmail(input)
  await new Resend(process.env.RESEND_API_KEY).emails.send({
    from: 'iBuild4you <noreply@ibuild4you.com>',
    to: NOTIFICATION_EMAILS,
    subject,
    text,
    html,
  })
  return true
}
