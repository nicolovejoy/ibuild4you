import { describe, it, expect } from 'vitest'
import { calculateCostUsd } from '../anthropic-pricing'

describe('calculateCostUsd', () => {
  it('prices Sonnet input + output correctly', () => {
    // 1M input @ $3, 1M output @ $15 = $18
    const cost = calculateCostUsd('claude-sonnet-4-6', {
      input_tokens: 1_000_000,
      output_tokens: 1_000_000,
    })
    expect(cost).toBeCloseTo(18, 6)
  })

  it('prices Sonnet cache reads at $0.30/M', () => {
    const cost = calculateCostUsd('claude-sonnet-4-6', {
      input_tokens: 0,
      output_tokens: 0,
      cache_read_input_tokens: 1_000_000,
    })
    expect(cost).toBeCloseTo(0.3, 6)
  })

  it('prices Sonnet cache writes at $3.75/M', () => {
    const cost = calculateCostUsd('claude-sonnet-4-6', {
      input_tokens: 0,
      output_tokens: 0,
      cache_creation_input_tokens: 1_000_000,
    })
    expect(cost).toBeCloseTo(3.75, 6)
  })

  it('sums all four components for a realistic mixed call', () => {
    // 2k fresh input, 500 output, 10k cache read, 5k cache write on Sonnet
    const cost = calculateCostUsd('claude-sonnet-4-6', {
      input_tokens: 2000,
      output_tokens: 500,
      cache_read_input_tokens: 10_000,
      cache_creation_input_tokens: 5_000,
    })
    // 2000*3 + 500*15 + 10000*0.3 + 5000*3.75 = 6000 + 7500 + 3000 + 18750 = 35250 / 1M
    expect(cost).toBeCloseTo(0.03525, 6)
  })

  it('prices Haiku correctly', () => {
    // 1M input @ $1, 1M output @ $5 = $6
    const cost = calculateCostUsd('claude-haiku-4-5', {
      input_tokens: 1_000_000,
      output_tokens: 1_000_000,
    })
    expect(cost).toBeCloseTo(6, 6)
  })

  it('returns 0 for unknown model (graceful fallback)', () => {
    const cost = calculateCostUsd('claude-mystery-9-9', {
      input_tokens: 1_000_000,
      output_tokens: 1_000_000,
    })
    expect(cost).toBe(0)
  })

  it('handles missing cache fields', () => {
    const cost = calculateCostUsd('claude-sonnet-4-6', {
      input_tokens: 1000,
      output_tokens: 100,
    })
    // 1000*3 + 100*15 = 3000 + 1500 = 4500 / 1M = 0.0045
    expect(cost).toBeCloseTo(0.0045, 6)
  })
})
