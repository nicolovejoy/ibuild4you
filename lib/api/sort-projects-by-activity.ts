// Sort projects on the dashboard by most recent activity from either
// participant — newest first.
//
// Activity = the most recent of:
//   - last_message_at (any message in any session: maker, agent, or admin)
//   - last_builder_activity_at (explicit builder dashboard work — annotations,
//     sends, nudges)
//   - created_at (fallback so brand-new projects with no activity still sort
//     against each other reasonably)
//
// ISO-8601 timestamps sort lexicographically, so we compare strings directly.

interface ProjectActivity {
  created_at?: string | null
  last_message_at?: string | null
  last_builder_activity_at?: string | null
  [key: string]: unknown
}

export function projectActivityKey(p: ProjectActivity): string {
  const candidates = [p.last_message_at, p.last_builder_activity_at, p.created_at]
    .filter((t): t is string => typeof t === 'string' && t.length > 0)
  if (candidates.length === 0) return ''
  return candidates.reduce((latest, t) => (t > latest ? t : latest))
}

export function sortProjectsByActivity<T extends ProjectActivity>(projects: T[]): T[] {
  return [...projects].sort((a, b) => {
    const ka = projectActivityKey(a)
    const kb = projectActivityKey(b)
    if (ka !== kb) return kb.localeCompare(ka)
    // Tiebreaker: newer created_at first, so two same-activity projects still
    // have a stable, meaningful order.
    const ca = (a.created_at as string) || ''
    const cb = (b.created_at as string) || ''
    return cb.localeCompare(ca)
  })
}
