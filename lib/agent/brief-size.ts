import { copy } from '@/lib/copy'
import { briefWithoutProvenance } from '@/lib/api/brief-merge'

// The comms agent curates the brief by hand (#229), so the brief is no longer
// capped by one model output. This is the size a curated brief should stay
// under so it stays cheap and quick to read into every chat turn.
export const BRIEF_CHAR_BUDGET = 20000
// Warn the builder once a brief is past this share of the budget.
const WARN_SHARE = 0.8
export const BRIEF_WARN_CHARS = BRIEF_CHAR_BUDGET * WARN_SHARE

// Shown on the Brief tab whenever the live brief is close to the budget, and
// after a paste: null while the brief comfortably fits. Warns, never refuses.
// The size the budget is checked against: compact JSON (spacing and line breaks
// in a pretty-printed copy do not count), without the decision provenance
// stamps. The app carries those itself and no agent reads them, so they are
// not something a curator can trim.
export function briefSizeChars(content: unknown): number {
  if (!content || typeof content !== 'object') return JSON.stringify({}).length
  return JSON.stringify(briefWithoutProvenance(content as { decisions?: unknown })).length
}

export function briefSizeWarning(content: unknown): string | null {
  const chars = briefSizeChars(content)
  if (chars > BRIEF_CHAR_BUDGET) return copy.brief.briefOverSizeLimit(chars, BRIEF_CHAR_BUDGET)
  if (chars >= BRIEF_WARN_CHARS) return copy.brief.briefNearSizeLimit(chars, BRIEF_CHAR_BUDGET)
  return null
}

interface RegenState {
  brief_regen_last_error?: string | null
  brief_regen_last_error_at?: string | null
}

// The cron records a failed note on the project but nobody saw it (F4FC went
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
  if (err === 'write_note_max_tokens') {
    return copy.brief.regenFailedTooLarge(day(at))
  }
  return copy.brief.regenFailed(day(at))
}
