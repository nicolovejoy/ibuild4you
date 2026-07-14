import type { FeedbackType } from '@/lib/types'

// =============================================================================
// Pure builder for the admin feedback-notification email (#143).
// No I/O — the route passes plain values and swaps in the returned subject/text.
// =============================================================================

export interface FeedbackEmailInput {
  type: FeedbackType
  projectTitle: string
  body: string
  /** Lowercased submitter email, or null when the widget isn't identity-aware. */
  submitterEmail: string | null
  pageUrl: string
  viewport: string
  userAgent: string
  feedbackId: string
  /** 1 for a lone note; 2+ for repeat notes on the same project within the burst window. */
  burstIndex: number
}

const SNIPPET_MAX = 60
const REVIEW_BASE = 'https://ibuild4you.com/admin/feedback?focus='

/** English ordinal: 1→1st, 2→2nd, 3→3rd, 4→4th, 11→11th, 21→21st. */
function ordinal(n: number): string {
  const rem100 = n % 100
  if (rem100 >= 11 && rem100 <= 13) return `${n}th`
  switch (n % 10) {
    case 1:
      return `${n}st`
    case 2:
      return `${n}nd`
    case 3:
      return `${n}rd`
    default:
      return `${n}th`
  }
}

export function buildFeedbackEmail(input: FeedbackEmailInput): { subject: string; text: string } {
  const { type, projectTitle, body, submitterEmail, pageUrl, viewport, userAgent, feedbackId } =
    input

  // Snippet: collapse all whitespace, then clamp to SNIPPET_MAX with an ellipsis.
  const collapsed = body.trim().replace(/\s+/g, ' ')
  const snippet =
    collapsed.length > SNIPPET_MAX ? `${collapsed.slice(0, SNIPPET_MAX)}…` : collapsed

  const burstSuffix =
    input.burstIndex >= 2 ? ` · ${ordinal(input.burstIndex)} note this session` : ''

  const subject = `[${type}] ${projectTitle}: ${snippet}${burstSuffix}`

  const fromLine = submitterEmail
    ? `From: ${submitterEmail}`
    : 'From: submitter not captured (widget not identity-aware yet)'

  const text = [
    body.trim(),
    '',
    `Page: ${pageUrl || 'n/a'}`,
    `Review: ${REVIEW_BASE}${feedbackId}`,
    '',
    fromLine,
    '',
    '—',
    `viewport: ${viewport || 'n/a'} · ua: ${userAgent || 'n/a'}`,
    `feedback id: ${feedbackId}`,
  ].join('\n')

  return { subject, text }
}
