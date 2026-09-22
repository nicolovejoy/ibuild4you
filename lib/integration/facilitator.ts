import Anthropic from '@anthropic-ai/sdk'
import { buildFacilitatorSystemPrompt } from '@/lib/agent/system-prompt'
import { cacheSystemPrompt } from '@/lib/agent/prompt-cache'
import { AGENT_MODEL, AGENT_TEMPERATURE } from '@/lib/agent/constants'
import { logAnthropicCall } from '@/lib/observability/anthropic'
import type { MessageRow } from './types'

// Facilitator turns are short by rule; cap output well under the product agent.
const FACILITATOR_MAX_TOKENS = 600

// Surviving history → Anthropic turns (08a §6). Participant turns carry the
// stored neutral label as a prefix, the only identity the model ever sees.
// The API requires alternating roles starting with user, so consecutive
// participant turns are merged and a leading facilitator turn is dropped.
export function buildFacilitatorTurns(history: MessageRow[]): Anthropic.MessageParam[] {
  const turns: Anthropic.MessageParam[] = []
  for (const m of history) {
    const role = m.kind === 'participant' ? 'user' : 'assistant'
    const text = m.kind === 'participant' ? `${m.author_label}: ${m.body}` : m.body
    if (turns.length === 0 && role === 'assistant') continue
    const last = turns[turns.length - 1]
    if (last && last.role === role) last.content = `${last.content}\n\n${text}`
    else turns.push({ role, content: text })
  }
  return turns
}

// Once the participant message is stored, every failure here becomes
// reply_pending (08a §4), so the result is only ok / not ok.
export async function generateFacilitatorReply(input: {
  groupId: string
  topicTitle: string
  topicPrompt: string
  history: MessageRow[]
  anthropic?: Anthropic
}): Promise<{ ok: true; body: string } | { ok: false }> {
  const anthropic = input.anthropic ?? new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  const system = cacheSystemPrompt(
    buildFacilitatorSystemPrompt({ topicTitle: input.topicTitle, topicPrompt: input.topicPrompt })
  )
  const messages = buildFacilitatorTurns(input.history)
  const started = Date.now()
  try {
    const result = await anthropic.messages.create({
      model: AGENT_MODEL,
      system,
      messages,
      max_tokens: FACILITATOR_MAX_TOKENS,
      temperature: AGENT_TEMPERATURE,
    })
    const body = result.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('')
      .trim()
    if (result.usage) {
      void logAnthropicCall({
        project_id: input.groupId,
        route: 'integration.chat',
        model: AGENT_MODEL,
        usage: {
          input_tokens: result.usage.input_tokens,
          output_tokens: result.usage.output_tokens,
          cache_read_input_tokens: result.usage.cache_read_input_tokens ?? 0,
          cache_creation_input_tokens: result.usage.cache_creation_input_tokens ?? 0,
        },
        duration_ms: Date.now() - started,
      })
    }
    return body ? { ok: true, body } : { ok: false }
  } catch (err) {
    // Class and status only — never the provider body, prompt or turns.
    const status = (err as { status?: number } | null)?.status
    console.error('integration_facilitator_error', {
      group_id: input.groupId,
      status,
      name: err instanceof Error ? err.name : typeof err,
    })
    return { ok: false }
  }
}
