import type { FeedbackReply } from '@/lib/types'
import { normalizeEmail } from '@/lib/email/normalize'

// Plus-addressing inbox for routing replies back to the right feedback row.
// MX for this host must point at Resend's inbound; the rest of the domain's
// mail can keep using its current provider. Configurable via env so we can
// flip to the apex domain later without a code change.
//
// Pattern: feedback+h-<feedback id as lowercase hex>@inbox.ibuild4you.com
//   - outbound notification sets Reply-To to this
//   - Resend forwards inbound mail here to our webhook
//   - webhook parses the "+h-<hex>" tag to look up the row
//
// Why hex and not the id itself (#277): the id is a Firestore document id,
// mixed case and case sensitive, and a mail client or server may lowercase a
// local part on the way. Hex has no case to lose. A 20-character id gives a
// 49-character local part, under the 64 an address allows.
export const FEEDBACK_INBOX_HOST =
  process.env.FEEDBACK_INBOX_HOST?.trim() || 'inbox.ibuild4you.com'

export const FEEDBACK_INBOX_LOCALPART = 'feedback'

// Marks a tag as hex-encoded. A Firestore auto id never contains a hyphen,
// so a raw id from an older address cannot be mistaken for an encoded one.
const ENCODED_TAG_PREFIX = 'h-'

export function feedbackReplyAddress(feedbackId: string): string {
  const hex = Buffer.from(feedbackId, 'utf8').toString('hex')
  return `${FEEDBACK_INBOX_LOCALPART}+${ENCODED_TAG_PREFIX}${hex}@${FEEDBACK_INBOX_HOST}`
}

// Turn the tag back into the feedback id. Returns null for an encoded tag
// that is not valid hex.
function decodeTag(tag: string): string | null {
  const lower = tag.toLowerCase()
  if (!lower.startsWith(ENCODED_TAG_PREFIX)) {
    // An address sent before the encoding: the tag is the raw id. Keep its
    // case; it only matches if the mail path kept it too.
    return tag
  }
  const hex = lower.slice(ENCODED_TAG_PREFIX.length)
  if (!hex || hex.length % 2 !== 0 || !/^[0-9a-f]+$/.test(hex)) return null
  return Buffer.from(hex, 'hex').toString('utf8')
}

// Extract the feedback id from a recipient address. Handles:
//   - "feedback+h-616263@inbox.ibuild4you.com" → "abc"
//   - "Foo <feedback+h-616263@inbox.ibuild4you.com>" → "abc"
//   - "feedback+abc123@inbox.ibuild4you.com" → "abc123" (sent before #277)
//   - whitespace around the address
//   - the "feedback" base and the host in any case
//   - rejects mismatched localpart (e.g. "notify+abc@...")
//   - rejects mismatched host (e.g. "feedback+abc@evil.com")
//   - returns null if no plus-tag is present
export function parseFeedbackIdFromAddress(raw: string): string | null {
  if (!raw) return null
  // Strip display-name wrappers: "Name <addr>" → "addr"
  const match = raw.match(/<([^>]+)>/)
  // Not normalizeEmail: it lowercases, and a raw id in the tag needs its case.
  const address = (match ? match[1] : raw).trim()
  const atIdx = address.lastIndexOf('@')
  if (atIdx < 0) return null
  const localpart = address.slice(0, atIdx)
  const host = address.slice(atIdx + 1)
  if (host.toLowerCase() !== FEEDBACK_INBOX_HOST.toLowerCase()) return null
  const plusIdx = localpart.indexOf('+')
  if (plusIdx < 0) return null
  const base = localpart.slice(0, plusIdx)
  const tag = localpart.slice(plusIdx + 1)
  if (base.toLowerCase() !== FEEDBACK_INBOX_LOCALPART) return null
  if (!tag) return null
  return decodeTag(tag)
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
    from_email: normalizeEmail(input.fromEmail),
    body: input.body,
    via_email: true,
    created_at: ts,
    updated_at: ts,
  }
}
