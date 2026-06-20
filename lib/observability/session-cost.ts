import { calculateCostUsd, type AnthropicUsage } from './anthropic-pricing'

export interface SessionUsageTotals {
  token_usage_input: number
  token_usage_output: number
  token_cost_usd: number
}

// Accumulate one Anthropic call's usage into a session's running totals.
//
// Cost is computed from the FULL usage (including cache read/write tokens), so
// the dollar figure stays accurate even though the displayed token totals
// (`token_usage_input`) are the uncached input remainder only — Anthropic's
// `input_tokens` excludes cached tokens, which are billed separately. Legacy
// sessions predating this field count from 0.
export function accumulateSessionUsage(
  prev: Partial<SessionUsageTotals> | undefined,
  usage: AnthropicUsage,
  model: string,
): SessionUsageTotals {
  return {
    token_usage_input: (prev?.token_usage_input ?? 0) + usage.input_tokens,
    token_usage_output: (prev?.token_usage_output ?? 0) + usage.output_tokens,
    token_cost_usd: (prev?.token_cost_usd ?? 0) + calculateCostUsd(model, usage),
  }
}

// Human-facing cost label. Tilde-prefix it at the call site ("~$0.04") to signal
// list-price estimate, not billed. Floors tiny non-zero amounts so a real cost
// never renders as a misleading "$0.00".
export function formatCostUsd(usd: number): string {
  if (usd > 0 && usd < 0.01) return '<$0.01'
  return `$${usd.toFixed(2)}`
}
