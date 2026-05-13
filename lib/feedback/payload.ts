import type { FeedbackType } from '@/lib/types'

// Mirror server-side cap (app/api/feedback/route.ts). Kept as a constant the
// widget and tests can both import so a future bump only happens in two places.
export const MAX_FEEDBACK_BODY_CHARS = 5000

const ALLOWED_TYPES: ReadonlyArray<FeedbackType> = ['bug', 'idea', 'other']

// Loose email shape — server is the source of truth, this is just to catch
// the obvious "missed the @" mistake before the round-trip.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export interface FeedbackInput {
  projectId: string
  type: FeedbackType
  body: string
  submitterEmail?: string
}

export interface FeedbackContext {
  pageUrl: string
  userAgent: string
  viewport: string
  renderedAt: number
}

export interface FeedbackPayload {
  projectId: string
  type: FeedbackType
  body: string
  submitterEmail?: string
  pageUrl: string
  userAgent: string
  viewport: string
  website: '' // honeypot — must stay empty; bots fill it
  _ts: number // render time; server checks min/max age
}

export type ValidationResult =
  | { ok: true }
  | { ok: false; field: 'projectId' | 'type' | 'body' | 'submitterEmail'; message: string }

export function validateFeedbackInput(input: FeedbackInput): ValidationResult {
  if (!input.projectId || !input.projectId.trim()) {
    return { ok: false, field: 'projectId', message: 'Project is required' }
  }
  if (!ALLOWED_TYPES.includes(input.type)) {
    return { ok: false, field: 'type', message: 'Type must be bug, idea, or other' }
  }
  const trimmed = (input.body ?? '').trim()
  if (!trimmed) {
    return { ok: false, field: 'body', message: 'Please describe your feedback' }
  }
  if (trimmed.length > MAX_FEEDBACK_BODY_CHARS) {
    return {
      ok: false,
      field: 'body',
      message: `Please keep feedback under ${MAX_FEEDBACK_BODY_CHARS} characters`,
    }
  }
  if (input.submitterEmail && input.submitterEmail.trim()) {
    if (!EMAIL_RE.test(input.submitterEmail.trim())) {
      return { ok: false, field: 'submitterEmail', message: 'Email looks invalid' }
    }
  }
  return { ok: true }
}

export function buildFeedbackPayload(
  input: FeedbackInput,
  ctx: FeedbackContext
): FeedbackPayload {
  const submitterEmail = input.submitterEmail?.trim().toLowerCase()
  return {
    projectId: input.projectId.trim(),
    type: input.type,
    body: input.body.trim(),
    ...(submitterEmail ? { submitterEmail } : {}),
    pageUrl: ctx.pageUrl,
    userAgent: ctx.userAgent,
    viewport: ctx.viewport,
    website: '',
    _ts: ctx.renderedAt,
  }
}
