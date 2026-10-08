// Shared rollup logic for api_usage records. Used by:
//   - scripts/api-usage-rollup.mjs (CLI, ad-hoc investigation)
//   - GET /api/admin/usage         (the admin dashboard at /admin/usage)
// Mirror the shape with the script so a future contributor can read one and
// understand the other.

// stars-demo round-two facilitator calls log to api_usage too (route
// 'integration.chat') so the cost runbook and rollups see them, but their
// project_id is a group document ID ('stars-demo:r2:<topic>'), not a
// projects doc. The dashboard labels those rows here instead of looking up
// a project title that does not exist.
const INTEGRATION_PROJECT_PREFIX = 'stars-demo:'

export function integrationUsageLabel(projectId: string): string | null {
  if (!projectId.startsWith(INTEGRATION_PROJECT_PREFIX)) return null
  return `stars-demo integration (${projectId.slice(INTEGRATION_PROJECT_PREFIX.length)})`
}

export interface ApiUsageRow {
  project_id: string
  route: string
  model: string
  input_tokens: number
  output_tokens: number
  cache_read_input_tokens?: number
  cache_creation_input_tokens?: number
  cost_usd?: number
  duration_ms?: number
  session_id?: string | null
  created_at: string
}

export interface GroupTotals {
  key: string
  label?: string // hydrated by the API for by_project rows; project title lookup
  calls: number
  cost: number
  input: number
  output: number
  cache_read: number
  cache_create: number
}

export interface TopCall {
  route: string
  project_id: string
  project_label?: string // hydrated by the API: project title lookup
  cost_usd: number
  input_tokens: number
  output_tokens: number
  cache_read_input_tokens: number
  cache_creation_input_tokens: number
  created_at: string
}

export interface UsageRollup {
  days: number
  since: string
  total_calls: number
  total_cost: number
  by_route: GroupTotals[]
  by_model: GroupTotals[]
  by_day: GroupTotals[]
  by_project: GroupTotals[]
  top_calls: TopCall[]
}

function groupBy(rows: ApiUsageRow[], keyFn: (r: ApiUsageRow) => string): GroupTotals[] {
  const m = new Map<string, GroupTotals>()
  for (const r of rows) {
    const k = keyFn(r)
    const cur = m.get(k) || {
      key: k,
      calls: 0,
      cost: 0,
      input: 0,
      output: 0,
      cache_read: 0,
      cache_create: 0,
    }
    cur.calls += 1
    cur.cost += r.cost_usd || 0
    cur.input += r.input_tokens || 0
    cur.output += r.output_tokens || 0
    cur.cache_read += r.cache_read_input_tokens || 0
    cur.cache_create += r.cache_creation_input_tokens || 0
    m.set(k, cur)
  }
  return [...m.values()]
}

// Build a rollup from raw api_usage rows. Sort behavior:
//   - by_route/by_model/by_project: by cost desc (most expensive first)
//   - by_day: by date asc (chronological — easier to spot trends)
//   - top_calls: by cost_usd desc, capped at top 10
export function rollUpUsage(rows: ApiUsageRow[], days: number, since: string): UsageRollup {
  const by_route = groupBy(rows, (r) => r.route).sort((a, b) => b.cost - a.cost)
  const by_model = groupBy(rows, (r) => r.model).sort((a, b) => b.cost - a.cost)
  const by_project = groupBy(rows, (r) => r.project_id || '(none)').sort(
    (a, b) => b.cost - a.cost,
  )
  const by_day = groupBy(rows, (r) => (r.created_at || '').slice(0, 10)).sort((a, b) =>
    a.key.localeCompare(b.key),
  )

  const top_calls: TopCall[] = rows
    .map((r) => ({
      route: r.route,
      project_id: r.project_id,
      cost_usd: r.cost_usd || 0,
      input_tokens: r.input_tokens || 0,
      output_tokens: r.output_tokens || 0,
      cache_read_input_tokens: r.cache_read_input_tokens || 0,
      cache_creation_input_tokens: r.cache_creation_input_tokens || 0,
      created_at: r.created_at,
    }))
    .sort((a, b) => b.cost_usd - a.cost_usd)
    .slice(0, 10)

  return {
    days,
    since,
    total_calls: rows.length,
    total_cost: rows.reduce((s, r) => s + (r.cost_usd || 0), 0),
    by_route,
    by_model,
    by_day,
    by_project,
    top_calls,
  }
}

// --- Per-brief rollup (#185) ---------------------------------------------
// Used by GET /api/projects/[id]/usage. Groups one project's rows by
// conversation so the builder view can show "what did this brief cost, and
// which conversation cost what". Calls that aren't tied to a session (brief
// regen, welcome message, outbound prep) land in one NO_SESSION_KEY bucket so
// the total still adds up.

export const NO_SESSION_KEY = '(none)'

export interface SessionTotals extends GroupTotals {
  first_call_at: string
  last_call_at: string
}

export interface ProjectUsageRollup {
  total_calls: number
  total_cost: number
  by_route: GroupTotals[]
  by_session: SessionTotals[]
}

export function rollUpProjectUsage(rows: ApiUsageRow[]): ProjectUsageRollup {
  const by_route = groupBy(rows, (r) => r.route).sort((a, b) => b.cost - a.cost)

  const sessions = new Map<string, SessionTotals>()
  for (const r of rows) {
    const key = r.session_id || NO_SESSION_KEY
    const created = r.created_at || ''
    const cur = sessions.get(key) || {
      key,
      calls: 0,
      cost: 0,
      input: 0,
      output: 0,
      cache_read: 0,
      cache_create: 0,
      first_call_at: created,
      last_call_at: created,
    }
    cur.calls += 1
    cur.cost += r.cost_usd || 0
    cur.input += r.input_tokens || 0
    cur.output += r.output_tokens || 0
    cur.cache_read += r.cache_read_input_tokens || 0
    cur.cache_create += r.cache_creation_input_tokens || 0
    if (created && (!cur.first_call_at || created < cur.first_call_at)) cur.first_call_at = created
    if (created > cur.last_call_at) cur.last_call_at = created
    sessions.set(key, cur)
  }

  // Chronological by first call; the no-session bucket always last so the
  // conversation rows read 1, 2, 3… before the "other" line.
  const by_session = [...sessions.values()].sort((a, b) => {
    if (a.key === NO_SESSION_KEY) return 1
    if (b.key === NO_SESSION_KEY) return -1
    return a.first_call_at.localeCompare(b.first_call_at)
  })

  return {
    total_calls: rows.length,
    total_cost: rows.reduce((s, r) => s + (r.cost_usd || 0), 0),
    by_route,
    by_session,
  }
}
