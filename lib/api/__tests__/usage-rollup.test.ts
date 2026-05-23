import { describe, it, expect } from 'vitest'
import { rollUpUsage, type ApiUsageRow } from '../usage-rollup'

function row(overrides: Partial<ApiUsageRow> = {}): ApiUsageRow {
  return {
    project_id: 'p1',
    route: 'chat',
    model: 'claude-sonnet-4-6',
    input_tokens: 100,
    output_tokens: 50,
    cache_read_input_tokens: 0,
    cache_creation_input_tokens: 0,
    cost_usd: 0.01,
    duration_ms: 500,
    created_at: '2026-05-23T12:00:00.000Z',
    ...overrides,
  }
}

describe('rollUpUsage', () => {
  it('returns zero totals for an empty input', () => {
    const r = rollUpUsage([], 7, '2026-05-16T00:00:00Z')
    expect(r.total_calls).toBe(0)
    expect(r.total_cost).toBe(0)
    expect(r.by_route).toEqual([])
    expect(r.top_calls).toEqual([])
  })

  it('groups by route and sorts most expensive first', () => {
    const rows = [
      row({ route: 'chat', cost_usd: 0.05 }),
      row({ route: 'brief.generate', cost_usd: 1.0 }),
      row({ route: 'brief.generate', cost_usd: 2.0 }),
      row({ route: 'welcome', cost_usd: 0.01 }),
    ]
    const r = rollUpUsage(rows, 7, '2026-05-16T00:00:00Z')
    expect(r.by_route.map((g) => g.key)).toEqual(['brief.generate', 'chat', 'welcome'])
    expect(r.by_route[0].calls).toBe(2)
    expect(r.by_route[0].cost).toBeCloseTo(3.0)
  })

  it('groups by_day sorted chronologically (oldest first)', () => {
    const rows = [
      row({ created_at: '2026-05-23T01:00:00Z', cost_usd: 0.1 }),
      row({ created_at: '2026-05-21T01:00:00Z', cost_usd: 0.2 }),
      row({ created_at: '2026-05-22T01:00:00Z', cost_usd: 0.3 }),
    ]
    const r = rollUpUsage(rows, 7, '2026-05-16T00:00:00Z')
    expect(r.by_day.map((g) => g.key)).toEqual(['2026-05-21', '2026-05-22', '2026-05-23'])
  })

  it('groups by_project and counts each project once', () => {
    const rows = [
      row({ project_id: 'pA', cost_usd: 0.5 }),
      row({ project_id: 'pA', cost_usd: 0.5 }),
      row({ project_id: 'pB', cost_usd: 2.0 }),
    ]
    const r = rollUpUsage(rows, 7, '2026-05-16T00:00:00Z')
    expect(r.by_project).toHaveLength(2)
    // pB more expensive, comes first
    expect(r.by_project[0]).toMatchObject({ key: 'pB', calls: 1, cost: 2.0 })
    expect(r.by_project[1]).toMatchObject({ key: 'pA', calls: 2, cost: 1.0 })
  })

  it('coerces missing project_id to "(none)" so it does not throw', () => {
    const rows = [
      row({ project_id: '', cost_usd: 0.1 }),
      row({ project_id: undefined as unknown as string, cost_usd: 0.1 }),
    ]
    const r = rollUpUsage(rows, 7, '2026-05-16T00:00:00Z')
    expect(r.by_project.map((g) => g.key)).toContain('(none)')
  })

  it('top_calls is capped at 10 and sorted by cost desc', () => {
    const rows: ApiUsageRow[] = []
    for (let i = 0; i < 15; i++) rows.push(row({ cost_usd: i / 100 }))
    const r = rollUpUsage(rows, 7, '2026-05-16T00:00:00Z')
    expect(r.top_calls).toHaveLength(10)
    expect(r.top_calls[0].cost_usd).toBeCloseTo(0.14)
    expect(r.top_calls[9].cost_usd).toBeCloseTo(0.05)
  })

  it('totals match the sum of rows', () => {
    const rows = [row({ cost_usd: 0.1 }), row({ cost_usd: 0.2 }), row({ cost_usd: 0.3 })]
    const r = rollUpUsage(rows, 7, '2026-05-16T00:00:00Z')
    expect(r.total_calls).toBe(3)
    expect(r.total_cost).toBeCloseTo(0.6)
  })

  it('sums cache token columns', () => {
    const rows = [
      row({ cache_read_input_tokens: 100, cache_creation_input_tokens: 50 }),
      row({ cache_read_input_tokens: 200, cache_creation_input_tokens: 75 }),
    ]
    const r = rollUpUsage(rows, 7, '2026-05-16T00:00:00Z')
    expect(r.by_route[0].cache_read).toBe(300)
    expect(r.by_route[0].cache_create).toBe(125)
  })
})
