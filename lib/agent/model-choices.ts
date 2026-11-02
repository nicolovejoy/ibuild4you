// Client-safe: the models a builder can pick for a brief (#189). No imports
// on purpose, so the Setup UI and the server can both use it.

// The only model ids a brief may name. Anything else (including a blank or a
// retired id) is treated as "no choice" and falls back to the env default.
export const BRIEF_MODELS = ['claude-sonnet-4-6', 'claude-sonnet-5-5', 'claude-opus-5-5'] as const

export type BriefModel = (typeof BRIEF_MODELS)[number]

// Type guard: true only for an exact, allowed id. Case-sensitive on purpose,
// so a hand-edited 'CLAUDE-SONNET-5-5' is rejected rather than silently fixed.
export function isBriefModel(v: unknown): v is BriefModel {
  return typeof v === 'string' && (BRIEF_MODELS as readonly string[]).includes(v)
}
