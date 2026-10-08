// Server-only: which model the chat agent talks with, and the sampling
// options that model accepts (#184).
import { AGENT_MODEL, AGENT_TEMPERATURE } from './constants'

// CHAT_MODEL overrides the model for the chat and kickoff routes only — the
// Sonnet 5.5 trial runs on preview first, then prod, without a code change.
// Brief regen, welcome and prep stay on AGENT_MODEL: they rely on forced
// tool_choice or a tuned temperature, both of which the 5.x models reject.
export function resolveChatModel(env: Record<string, string | undefined> = process.env): string {
  const v = env.CHAT_MODEL?.trim()
  return v || AGENT_MODEL
}

export function isClaude5Family(model: string): boolean {
  return /^claude-(sonnet|opus|haiku|fable)-5(-|$)/.test(model)
}

export type ChatSampling = { temperature: number } | { output_config: { effort: 'low' } }

// The 5.x models return a 400 on a non-default temperature; effort is the knob
// there, with adaptive thinking on by default. `low` keeps a conversational
// turn from spending output tokens (billed) on thinking — see
// docs/model-review-2026-10.md §5.
export function chatSampling(model: string): ChatSampling {
  if (isClaude5Family(model)) return { output_config: { effort: 'low' } }
  return { temperature: AGENT_TEMPERATURE }
}
