// Pure labelling for the per-brief usage view (#185). Turns session ids into
// the "Conversation N" ordinals the builder view already uses (1 = oldest).
import { NO_SESSION_KEY, type ProjectUsageRollup, type SessionTotals } from './usage-rollup'

export interface LabelledSessionTotals extends SessionTotals {
  label: string
  number: number | null
  session_created_at: string | null
}

export interface ProjectUsageResponse extends Omit<ProjectUsageRollup, 'by_session'> {
  by_session: LabelledSessionTotals[]
  truncated: boolean
}

export function labelSessions(
  by_session: SessionTotals[],
  sessions: { id: string; created_at: string }[],
): LabelledSessionTotals[] {
  const ordered = [...sessions].sort((a, b) => a.created_at.localeCompare(b.created_at))
  const byId = new Map(ordered.map((s, i) => [s.id, { number: i + 1, created_at: s.created_at }]))

  return by_session.map((s) => {
    if (s.key === NO_SESSION_KEY) {
      return { ...s, label: 'Brief updates & other', number: null, session_created_at: null }
    }
    const hit = byId.get(s.key)
    if (!hit) {
      // Session doc gone (archived + purged, or a fixture reset). Keep the
      // cost visible rather than dropping it on the floor.
      return { ...s, label: 'Conversation (removed)', number: null, session_created_at: null }
    }
    return { ...s, label: `Conversation ${hit.number}`, number: hit.number, session_created_at: hit.created_at }
  })
}
