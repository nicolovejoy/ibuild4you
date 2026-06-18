import Anthropic from '@anthropic-ai/sdk'
import { AGENT_MODEL } from './constants'
import { logAnthropicCall } from '@/lib/observability/anthropic'
import type { BriefContent } from '@/lib/types'

// Slice 2 of the Builder Setup dispatch card: one Sonnet "prep" call that returns
// BOTH a maker-facing nudge body and a one-line builder-facing focus summary.
// Fired eagerly at config-set time so both are pre-warmed on the card. House tone
// is friendly + terse (see feedback_outbound_tone memory).

export interface PrepInput {
  projectTitle: string
  makerFirstName?: string | null
  brief?: BriefContent | null
  // Most recent session's conversation, oldest → newest. Used as "last session recap".
  lastSessionMessages?: { role: string; content: string }[]
  sessionMode?: 'discover' | 'converge'
  seedQuestions?: string[]
  builderDirectives?: string[]
  welcomeMessage?: string | null
  voiceSample?: string | null
}

export interface PrepResult {
  // One-line builder-facing summary of what the next session drives at (≤ ~10 words).
  focus: string
  // Maker-facing outbound nudge body (no share link — the caller appends it).
  nudge_message: string
}

// House tone, locked. Keep in sync with feedback_outbound_tone memory + slice-2 spec.
const PREP_SYSTEM_PROMPT = `You prepare the "next session" handoff for an iBuild4you brief — a living document a developer builds from. You produce two things in one shot:

1. nudge_message — a short message inviting the maker (the non-technical person with the idea) back for the next session. Tone: friendly, helpful, terse, on-point. 2-3 sentences MAX. Warm but not gushing. Reference where they left off and what this round will cover, concretely. End with a light, low-pressure ask (e.g. "~10 min whenever you've got a moment"). Do NOT include a link, sign-off, subject line, or placeholders — just the body. Address the maker by first name if one is given.

2. focus — a single short line (≤ 10 words, no trailing period) for the builder's dashboard summarizing what this next session drives at. Plain language.

Plain language only — never jargon like "user journeys", "MVP", "sprints", "wireframes". Use straight ASCII quotes. Mirror the builder's voice sample if one is provided.

Good nudge example:
"Hi Tom — ready for round 2 on the advisory board. Last time you landed on three names; this round we'll pin down the ask for each and who to approach first. ~10 min whenever you've got a moment."`

const PREP_TOOL: Anthropic.Tool = {
  name: 'emit_prep',
  description: 'Return the maker nudge body and the builder focus line.',
  input_schema: {
    type: 'object',
    properties: {
      nudge_message: {
        type: 'string',
        description: 'Maker-facing nudge body, 2-3 sentences, no link or sign-off.',
      },
      focus: {
        type: 'string',
        description: 'One short line (≤10 words) for the builder summarizing the next session.',
      },
    },
    required: ['nudge_message', 'focus'],
  },
}

function briefSummary(brief?: BriefContent | null): string {
  if (!brief) return '(no brief yet)'
  const parts: string[] = []
  if (brief.problem) parts.push(`Problem: ${brief.problem}`)
  if (brief.target_users) parts.push(`Users: ${brief.target_users}`)
  if (brief.features?.length) parts.push(`Features: ${brief.features.join('; ')}`)
  if (brief.decisions?.length)
    parts.push(`Decisions: ${brief.decisions.map((d) => `${d.topic} — ${d.decision}`).join('; ')}`)
  if (brief.constraints) parts.push(`Constraints: ${brief.constraints}`)
  return parts.length ? parts.join('\n') : '(brief is empty)'
}

function recapFromMessages(messages?: { role: string; content: string }[]): string {
  if (!messages?.length) return '(no prior session — this is the first invite)'
  // Last few exchanges are the most relevant "where we left off" signal.
  const tail = messages.slice(-8)
  return tail
    .map((m) => `${m.role === 'user' ? 'Maker' : 'Sam'}: ${m.content.replace(/\s+/g, ' ').trim()}`)
    .join('\n')
}

// Pure: assemble the user-content prompt. Exported for testing.
export function buildPrepUserContent(input: PrepInput): string {
  const intent: string[] = []
  intent.push(`Mode: ${input.sessionMode || 'discover'}`)
  if (input.sessionMode === 'converge' && input.builderDirectives?.length)
    intent.push(`Builder wants to drive toward: ${input.builderDirectives.join('; ')}`)
  if (input.sessionMode !== 'converge' && input.seedQuestions?.length)
    intent.push(`Questions to explore next: ${input.seedQuestions.join('; ')}`)
  if (input.welcomeMessage?.trim())
    intent.push(`Agent will open with: ${input.welcomeMessage.replace(/\s+/g, ' ').trim()}`)

  const sections = [
    `Brief title: ${input.projectTitle}`,
    `Maker first name: ${input.makerFirstName?.trim() || '(unknown — keep it general)'}`,
    `\nBrief so far:\n${briefSummary(input.brief)}`,
    `\nWhere the last session left off:\n${recapFromMessages(input.lastSessionMessages)}`,
    `\nWhat the next session is set up to do:\n${intent.join('\n')}`,
  ]
  if (input.voiceSample?.trim())
    sections.push(`\nMatch this builder's texting voice:\n${input.voiceSample.trim()}`)
  sections.push('\nCall emit_prep with the nudge_message and focus.')
  return sections.join('\n')
}

// Pure: stable fingerprint of the inputs that should trigger regeneration. When
// this is unchanged the route serves the stored prep instead of paying for a new
// Sonnet call (guards against the brief-regen cost runaway lesson).
export function prepConfigHash(
  input: Pick<
    PrepInput,
    'sessionMode' | 'seedQuestions' | 'builderDirectives' | 'welcomeMessage' | 'voiceSample' | 'makerFirstName'
  > & { briefSignal?: string | number | null },
): string {
  const payload = JSON.stringify({
    m: input.sessionMode || 'discover',
    s: input.seedQuestions || [],
    d: input.builderDirectives || [],
    w: (input.welcomeMessage || '').trim(),
    v: (input.voiceSample || '').trim(),
    n: (input.makerFirstName || '').trim(),
    b: input.briefSignal ?? '',
  })
  // djb2 — small, stable, no crypto dependency.
  let h = 5381
  for (let i = 0; i < payload.length; i++) h = (h * 33) ^ payload.charCodeAt(i)
  return (h >>> 0).toString(36)
}

// The Anthropic call. Throws on error or a malformed tool response — the route
// catches and falls back to the static template.
export async function generatePrepOutbound(
  input: PrepInput,
  observability?: { project_id: string },
): Promise<PrepResult> {
  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

  const callStart = Date.now()
  const response = await anthropic.messages.create({
    model: AGENT_MODEL,
    max_tokens: 512,
    temperature: 0.6,
    system: PREP_SYSTEM_PROMPT,
    messages: [{ role: 'user', content: buildPrepUserContent(input) }],
    tools: [PREP_TOOL],
    tool_choice: { type: 'tool', name: 'emit_prep' },
  })

  if (observability && response.usage) {
    void logAnthropicCall({
      project_id: observability.project_id,
      route: 'prep.generate',
      model: AGENT_MODEL,
      usage: {
        input_tokens: response.usage.input_tokens,
        output_tokens: response.usage.output_tokens,
        cache_read_input_tokens: response.usage.cache_read_input_tokens ?? 0,
        cache_creation_input_tokens: response.usage.cache_creation_input_tokens ?? 0,
      },
      duration_ms: Date.now() - callStart,
    })
  }

  const toolUse = response.content.find((b) => b.type === 'tool_use')
  if (!toolUse || toolUse.type !== 'tool_use') {
    throw new Error('prep_generate_no_tool_use')
  }
  const out = toolUse.input as { focus?: unknown; nudge_message?: unknown }
  const focus = typeof out.focus === 'string' ? out.focus.trim() : ''
  const nudge_message = typeof out.nudge_message === 'string' ? out.nudge_message.trim() : ''
  if (!focus || !nudge_message) {
    throw new Error('prep_generate_empty_fields')
  }
  return { focus, nudge_message }
}
