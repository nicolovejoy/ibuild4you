// Anthropic pricing per 1M tokens, USD. Update when prices change.
// Reference: https://www.anthropic.com/pricing
export const ANTHROPIC_PRICING: Record<
  string,
  { input: number; output: number; cache_read: number; cache_write: number }
> = {
  'claude-sonnet-4-6': { input: 3, output: 15, cache_read: 0.3, cache_write: 3.75 },
  'claude-haiku-4-5': { input: 1, output: 5, cache_read: 0.1, cache_write: 1.25 },
  // 5.x rows (#184, docs/model-review-2026-10.md §2). Cache reads are the
  // published rates; cache writes are derived as 1.25x input where the
  // reference gives no explicit figure.
  'claude-sonnet-5-5': { input: 2, output: 10, cache_read: 0.2, cache_write: 2.5 },
  'claude-sonnet-5': { input: 2, output: 10, cache_read: 0.2, cache_write: 2.5 },
  'claude-haiku-5-5': { input: 0.1, output: 0.5, cache_read: 0.01, cache_write: 0.125 },
  'claude-opus-5-5': { input: 4, output: 20, cache_read: 0.2, cache_write: 5 },
  'claude-opus-5': { input: 5, output: 25, cache_read: 0.5, cache_write: 6.25 },
  'claude-fable-5-1': { input: 10, output: 50, cache_read: 0.25, cache_write: 12.5 },
}

export type AnthropicUsage = {
  input_tokens: number
  output_tokens: number
  cache_read_input_tokens?: number
  cache_creation_input_tokens?: number
}

// Returns cost in USD. Falls back to 0 if model isn't in the table —
// safer than crashing and easier to spot in rollups than NaN.
export function calculateCostUsd(model: string, usage: AnthropicUsage): number {
  const price = ANTHROPIC_PRICING[model]
  if (!price) return 0

  const M = 1_000_000
  const cacheRead = usage.cache_read_input_tokens ?? 0
  const cacheWrite = usage.cache_creation_input_tokens ?? 0
  // input_tokens from Anthropic already excludes cached tokens — they're billed
  // separately at the cache_read / cache_write rates.
  const freshInput = usage.input_tokens

  return (
    (freshInput * price.input) / M +
    (usage.output_tokens * price.output) / M +
    (cacheRead * price.cache_read) / M +
    (cacheWrite * price.cache_write) / M
  )
}
