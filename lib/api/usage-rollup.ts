// Shared rollup logic for api_usage records. Used by:
//   - scripts/api-usage-rollup.mjs (CLI, ad-hoc investigation)
//   - GET /api/admin/usage         (the admin dashboard at /admin/usage)
// Mirror the shape with the script so a future contributor can read one and
// understand the other.

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
