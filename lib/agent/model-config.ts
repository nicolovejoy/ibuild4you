// Server-only: which model the chat agent talks with, and the request
// options that model accepts (#184).
import { AGENT_MODEL, AGENT_TEMPERATURE, AGENT_MAX_TOKENS } from './constants'
import { isBriefModel } from './model-choices'

// Which model the chat and kickoff routes talk with. Precedence, first match wins:
//   1. the brief's own model (a valid id from model-choices; anything else is ignored)
//   2. CHAT_MODEL (trimmed, blank = unset)
//   3. AGENT_MODEL
// CHAT_MODEL overrides the model for the chat and kickoff routes only — the
// Sonnet 5.5 trial runs on preview first, then prod, without a code change.
// Brief regen, welcome and prep stay on AGENT_MODEL: they rely on forced
// tool_choice or a tuned temperature, both of which the newer models reject.
export function resolveChatModel(
  env: Record<string, string | undefined> = process.env,
  briefModel?: string | null,
): string {
  if (isBriefModel(briefModel)) return briefModel
  const v = env.CHAT_MODEL?.trim()
  return v || AGENT_MODEL
}

// The brief model a session should use, before validation (resolveChatModel
// checks it). A session snapshots its model at creation, so a session that
// has an `agent_model` field wins, even when that value is null (= Default).
// Only sessions created before the field existed fall through to the project.
export function resolveBriefModel(
  session: Record<string, unknown>,
  project: Record<string, unknown>,
): string | null {
  if ('agent_model' in session) {
    return typeof session.agent_model === 'string' ? session.agent_model : null
  }
  return typeof project.model === 'string' ? project.model : null
}

// Models that still take a tuned temperature: the 4.0–4.6 generation and
// anything older. Opus 4.7/4.8 and every 5.x id return a 400 on a non-default
// temperature and take `effort` instead. An id this does not recognise lands
// on the effort side — the newer request shape.
export function acceptsTemperature(model: string): boolean {
  return /^claude-(opus|sonnet|haiku)-4(-[0-6])?(-\d{8})?$/.test(model) || /^claude-3/.test(model)
}

// Thinking tokens bill as output and count toward max_tokens on the effort
// models, so a chat turn needs more headroom than the 2048 the 4.x agent uses
// or a long think ends on max_tokens with no text. Streamed, so no timeout risk.
export const EFFORT_MODEL_MAX_TOKENS = 8192

export type ChatModelOptions =
  | { temperature: number; max_tokens: number }
  | { output_config: { effort: 'low' }; max_tokens: number }

// Per-model request options for a chat turn. `low` effort keeps a
// conversational turn from spending output tokens on thinking — see
// docs/model-review-2026-10.md §5.
export function chatModelOptions(model: string): ChatModelOptions {
  if (acceptsTemperature(model)) return { temperature: AGENT_TEMPERATURE, max_tokens: AGENT_MAX_TOKENS }
  return { output_config: { effort: 'low' }, max_tokens: EFFORT_MODEL_MAX_TOKENS }
}
