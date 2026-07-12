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

// "conv 2 · Jul 11" when the session is known; "added Jul 11" when decided
// out-of-band or the session is gone (archived/deleted). Null when unstamped —
// old decisions render exactly as before.
export function decisionProvenanceSuffix(
  d: BriefDecision,
  numbers: Map<string, number>,
): string | null {
  if (!d.decided_at) return null
  const date = new Date(d.decided_at).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  })
  const n = d.decided_in_session ? numbers.get(d.decided_in_session) : undefined
  return n ? `conv ${n} · ${date}` : `added ${date}`
}

// Markdown-export variant: " (decided conv 2, 2026-07-11)" / " (added 2026-07-11)".
// Empty string when unstamped so callers can append unconditionally.
export function decisionProvenanceMarkdown(
  d: BriefDecision,
  numbers: Map<string, number>,
): string {
  if (!d.decided_at) return ''
  const date = d.decided_at.slice(0, 10)
  const n = d.decided_in_session ? numbers.get(d.decided_in_session) : undefined
  return n ? ` (decided conv ${n}, ${date})` : ` (added ${date})`
}
