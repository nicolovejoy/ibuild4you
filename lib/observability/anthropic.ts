import { getAdminDb } from '@/lib/firebase/admin'
import { calculateCostUsd, type AnthropicUsage } from './anthropic-pricing'

export type AnthropicRoute =
  | 'chat'
  | 'brief.generate'
  | 'welcome'
  | 'outbound.invite'
  | 'outbound.nudge'
  | 'outbound.reminder'

export interface LogAnthropicCallParams {
  project_id: string
  route: AnthropicRoute
  model: string
  usage: AnthropicUsage
  duration_ms: number
  session_id?: string
}

// Records one Anthropic API call to the `api_usage` Firestore collection and
// logs the same event to stdout for runtime-log fallback. Fire-and-forget —
// callers should `void` the returned promise so a slow/failed write never
// blocks the user-facing response. All errors are swallowed.
export async function logAnthropicCall(params: LogAnthropicCallParams): Promise<void> {
  const cost_usd = calculateCostUsd(params.model, params.usage)
  const event = {
    event: 'anthropic_call',
    ...params,
    cost_usd,
    ts: new Date().toISOString(),
  }
  console.log(JSON.stringify(event))

  try {
    await getAdminDb().collection('api_usage').add({
      project_id: params.project_id,
      route: params.route,
      model: params.model,
      input_tokens: params.usage.input_tokens,
      output_tokens: params.usage.output_tokens,
      cache_read_input_tokens: params.usage.cache_read_input_tokens ?? 0,
      cache_creation_input_tokens: params.usage.cache_creation_input_tokens ?? 0,
      cost_usd,
      duration_ms: params.duration_ms,
      session_id: params.session_id ?? null,
      created_at: new Date().toISOString(),
    })
  } catch (err) {
    console.error('api_usage_write_failed', {
      route: params.route,
      project_id: params.project_id,
      err: err instanceof Error ? err.message : String(err),
    })
  }
}
