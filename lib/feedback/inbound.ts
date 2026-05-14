import type { FeedbackReply } from '@/lib/types'

// Plus-addressing inbox for routing replies back to the right feedback row.
// MX for this host must point at Resend's inbound; the rest of the domain's
// mail can keep using its current provider. Configurable via env so we can
// flip to the apex domain later without a code change.
//
// Pattern: feedback+<feedback-id>@inbox.ibuild4you.com
//   - outbound notification sets Reply-To to this
//   - Resend forwards inbound mail here to our webhook
//   - webhook parses the "+<feedback-id>" tag to look up the row
export const FEEDBACK_INBOX_HOST =
  process.env.FEEDBACK_INBOX_HOST?.trim() || 'inbox.ibuild4you.com'

export const FEEDBACK_INBOX_LOCALPART = 'feedback'

export function feedbackReplyAddress(feedbackId: string): string {
  return `${FEEDBACK_INBOX_LOCALPART}+${feedbackId}@${FEEDBACK_INBOX_HOST}`
}

// Extract the feedback id from a recipient address. Handles:
//   - "feedback+abc123@inbox.ibuild4you.com" → "abc123"
//   - "Foo <feedback+abc123@inbox.ibuild4you.com>" → "abc123"
//   - whitespace around the address
//   - case-insensitive localpart and host match
//   - rejects mismatched localpart (e.g. "notify+abc@...")
//   - rejects mismatched host (e.g. "feedback+abc@evil.com")
//   - returns null if no plus-tag is present
export function parseFeedbackIdFromAddress(raw: string): string | null {
  if (!raw) return null
  // Strip display-name wrappers: "Name <addr>" → "addr"
  const match = raw.match(/<([^>]+)>/)
  const address = (match ? match[1] : raw).trim().toLowerCase()
  const atIdx = address.lastIndexOf('@')
  if (atIdx < 0) return null
  const localpart = address.slice(0, atIdx)
  const host = address.slice(atIdx + 1)
  if (host !== FEEDBACK_INBOX_HOST.toLowerCase()) return null
  const plusIdx = localpart.indexOf('+')
  if (plusIdx < 0) return null
  const base = localpart.slice(0, plusIdx)
  const tag = localpart.slice(plusIdx + 1)
  if (base !== FEEDBACK_INBOX_LOCALPART) return null
  if (!tag) return null
  return tag
}

// "to" comes back from Resend in different shapes depending on the version
// of the inbound payload — sometimes a single string, sometimes an array.
// Walk both, return the first id that matches our address pattern.
export function findFeedbackIdInRecipients(to: string | string[] | undefined): string | null {
  if (!to) return null
  const list = Array.isArray(to) ? to : [to]
  for (const item of list) {
    if (typeof item !== 'string') continue
    // A single header field can carry a comma-separated list.
    for (const piece of item.split(',')) {
      const id = parseFeedbackIdFromAddress(piece)
      if (id) return id
    }
  }
  return null
}

export interface InboundReplyInput {
  feedbackId: string
  fromEmail: string
  body: string
  now?: () => string // injectable for tests; defaults to ISO of Date.now()
}

// Shape an inbound reply for insertion into feedback/{id}/replies.
// `id` is intentionally left off — Firestore .add() assigns one.
export function buildInboundReply(input: InboundReplyInput): Omit<FeedbackReply, 'id'> {
  const nowFn = input.now ?? (() => new Date().toISOString())
  const ts = nowFn()
  return {
    feedback_id: input.feedbackId,
    from: 'submitter',
    from_email: input.fromEmail.trim().toLowerCase(),
    body: input.body,
    via_email: true,
    created_at: ts,
    updated_at: ts,
  }
}
