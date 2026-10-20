import { excludeArchived } from '@/lib/sessions/active'
import type { BriefDecision } from '@/lib/types'

// Provenance display for brief decisions (#121). Decisions store a session doc
// id (stable); the conversation number is derived here from the loaded
// sessions, with the same rules as everywhere else: archived excluded, oldest
// first. Pure — unit-tested without React.

type SessionLite = { id: string; created_at?: string; status?: string | null }

// Map session id → conversation number (1-based, oldest first, archived skipped).
export function sessionNumberById(sessions: SessionLite[]): Map<string, number> {
  const ordered = excludeArchived(sessions).sort((a, b) =>
    (a.created_at || '').localeCompare(b.created_at || ''),
  )
  return new Map(ordered.map((s, i) => [s.id, i + 1]))
}

// Timestamps are stored in UTC; a calendar day shown to a human is Pacific
// (#228), so a decision stamped after 5pm PT does not read as tomorrow.
const TZ = 'America/Los_Angeles'

const shortDate = (iso: string) =>
  new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: TZ })

// YYYY-MM-DD in Pacific ('en-CA' formats as ISO year-month-day).
const isoDay = (iso: string) => new Date(iso).toLocaleDateString('en-CA', { timeZone: TZ })

// "conv 2 · Jul 11" when the session is known; "added Jul 11" when decided
// out-of-band or the session is gone (archived/deleted). A revision (#218)
// appends ", revised conv 4 · Oct 17" (or "revised Oct 17" out-of-band); a
// decision with a revision but no origin shows only the revision. Null when
// unstamped — old decisions render exactly as before.
export function decisionProvenanceSuffix(
  d: BriefDecision,
  numbers: Map<string, number>,
): string | null {
  const parts: string[] = []
  if (d.decided_at) {
    const n = d.decided_in_session ? numbers.get(d.decided_in_session) : undefined
    parts.push(n ? `conv ${n} · ${shortDate(d.decided_at)}` : `added ${shortDate(d.decided_at)}`)
  }
  if (d.revised_at) {
    const n = d.revised_in_session ? numbers.get(d.revised_in_session) : undefined
    parts.push(n ? `revised conv ${n} · ${shortDate(d.revised_at)}` : `revised ${shortDate(d.revised_at)}`)
  }
  return parts.length ? parts.join(', ') : null
}

// Markdown-export variant: " (decided conv 2, 2026-07-11)" / " (added 2026-07-11)",
// with "; revised conv 4, 2026-10-17" / "; revised 2026-10-17" appended for a
// revision. Empty string when unstamped so callers can append unconditionally.
export function decisionProvenanceMarkdown(
  d: BriefDecision,
  numbers: Map<string, number>,
): string {
  const parts: string[] = []
  if (d.decided_at) {
    const date = isoDay(d.decided_at)
    const n = d.decided_in_session ? numbers.get(d.decided_in_session) : undefined
    parts.push(n ? `decided conv ${n}, ${date}` : `added ${date}`)
  }
  if (d.revised_at) {
    const date = isoDay(d.revised_at)
    const n = d.revised_in_session ? numbers.get(d.revised_in_session) : undefined
    parts.push(n ? `revised conv ${n}, ${date}` : `revised ${date}`)
  }
  return parts.length ? ` (${parts.join('; ')})` : ''
}
