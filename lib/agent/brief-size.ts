import { copy } from '@/lib/copy'
import { BRIEF_MAX_TOKENS } from '@/lib/agent/constants'

// An automatic brief update (regenerateBriefForProject) has the model write the
// WHOLE brief back out as tool input, so the brief's size is capped by the
// output budget. Measured on F4FC 2026-10-16: a 25,040-char brief took 8,067
// output tokens, about 3.1 chars per token. 3 keeps a little margin.
const CHARS_PER_TOKEN = 3
// Warn the builder once a brief is past this share of the budget.
const WARN_SHARE = 0.8

export function briefRegenCharBudget(maxTokens: number = BRIEF_MAX_TOKENS): number {
  return maxTokens * CHARS_PER_TOKEN
}

// Shown after a paste: null while the brief comfortably fits.
export function briefSizeWarning(content: unknown, maxTokens: number = BRIEF_MAX_TOKENS): string | null {
  const chars = JSON.stringify(content ?? {}).length
  const budget = briefRegenCharBudget(maxTokens)
  if (chars > budget) return copy.brief.briefOverSizeLimit(chars, budget)
  if (chars >= budget * WARN_SHARE) return copy.brief.briefNearSizeLimit(chars, budget)
  return null
}

interface RegenState {
  brief_regen_last_error?: string | null
  brief_regen_last_error_at?: string | null
}

// The cron records a failed update on the project but nobody saw it (F4FC went
// two days stale). Show it on the Brief tab while it is still the latest word,
// i.e. no paste or successful update has refreshed the brief since.
export function regenFailureNotice(project: RegenState, briefUpdatedAt: string | null | undefined): string | null {
  const err = project.brief_regen_last_error
  const at = project.brief_regen_last_error_at
  if (!err || !at) return null
  if (briefUpdatedAt && briefUpdatedAt > at) return null
  const day = (iso: string) =>
    new Intl.DateTimeFormat('en-US', { timeZone: 'America/Los_Angeles', month: 'short', day: 'numeric' }).format(
      new Date(iso),
    )
  if (err === 'regenerate_brief_max_tokens') {
    return copy.brief.regenFailedTooLarge(briefUpdatedAt ? day(briefUpdatedAt) : 'it was created')
  }
  return copy.brief.regenFailed(day(at))
}
