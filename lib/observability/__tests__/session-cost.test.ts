import { describe, it, expect } from 'vitest'
import { accumulateSessionUsage, formatCostUsd } from '../session-cost'

describe('accumulateSessionUsage', () => {
  it('seeds totals from a fresh session (no prior usage)', () => {
    const totals = accumulateSessionUsage(undefined, { input_tokens: 1000, output_tokens: 200 }, 'claude-sonnet-4-6')
    expect(totals.token_usage_input).toBe(1000)
    expect(totals.token_usage_output).toBe(200)
    // 1000*3 + 200*15 = 3000 + 3000 = 6000 / 1M
    expect(totals.token_cost_usd).toBeCloseTo(0.006, 6)
  })

  it('accumulates onto prior totals', () => {
    const prev = { token_usage_input: 1000, token_usage_output: 200, token_cost_usd: 0.006 }
    const totals = accumulateSessionUsage(prev, { input_tokens: 500, output_tokens: 100 }, 'claude-sonnet-4-6')
    expect(totals.token_usage_input).toBe(1500)
    expect(totals.token_usage_output).toBe(300)
    // prev 0.006 + (500*3 + 100*15)/1M = 0.006 + 0.0030 = 0.0090
    expect(totals.token_cost_usd).toBeCloseTo(0.009, 6)
  })

  it('counts cache tokens in cost but NOT in the displayed token totals', () => {
    // The displayed token totals are the uncached remainder; cost reflects cache too.
    const totals = accumulateSessionUsage(
      undefined,
      {
        input_tokens: 2000,
        output_tokens: 500,
        cache_read_input_tokens: 10_000,
        cache_creation_input_tokens: 5_000,
      },
      'claude-sonnet-4-6',
    )
    // token totals exclude cache reads/writes
    expect(totals.token_usage_input).toBe(2000)
    expect(totals.token_usage_output).toBe(500)
    // cost includes all four components: 2000*3 + 500*15 + 10000*0.3 + 5000*3.75 = 35250 / 1M
    expect(totals.token_cost_usd).toBeCloseTo(0.03525, 6)
  })

  it('treats a legacy session with no token_cost_usd as 0', () => {
    const prev = { token_usage_input: 100, token_usage_output: 50 } // pre-feature session
    const totals = accumulateSessionUsage(prev, { input_tokens: 100, output_tokens: 50 }, 'claude-sonnet-4-6')
    expect(totals.token_usage_input).toBe(200)
    // cost anchored from 0: (100*3 + 50*15)/1M = 0.00105
    expect(totals.token_cost_usd).toBeCloseTo(0.00105, 6)
  })

  it('unknown model contributes 0 cost (graceful, matches calculateCostUsd)', () => {
    const totals = accumulateSessionUsage(undefined, { input_tokens: 1_000_000, output_tokens: 1_000_000 }, 'claude-mystery-9-9')
    expect(totals.token_cost_usd).toBe(0)
  })
})

describe('formatCostUsd', () => {
  it('shows two decimals for normal amounts', () => {
    expect(formatCostUsd(0.04)).toBe('$0.04')
    expect(formatCostUsd(1.2)).toBe('$1.20')
  })

  it('floors tiny non-zero amounts to <$0.01 rather than showing $0.00', () => {
    expect(formatCostUsd(0.003)).toBe('<$0.01')
  })

  it('shows $0.00 only for exactly zero', () => {
    expect(formatCostUsd(0)).toBe('$0.00')
  })
})
