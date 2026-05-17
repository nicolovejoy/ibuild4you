import Anthropic from '@anthropic-ai/sdk'
import { AGENT_MODEL, AGENT_TEMPERATURE, DEFAULT_IDENTITY } from './constants'
import { logAnthropicCall } from '@/lib/observability/anthropic'

function buildWelcomeSystemPrompt(identity?: string | null): string {
  const who = identity || DEFAULT_IDENTITY
  return `${who}

Generate a warm, casual welcome message for a new user who just got access to their project.

Rules:
- 2-3 short paragraphs
- End with one simple, open-ended question to get the conversation started
- Plain language only — no jargon like "user journeys", "microservices", "tech stack", "MVP", etc.
- Be friendly and approachable, not corporate
- Don't over-explain the process — just welcome them and get things rolling`
}

export async function generateWelcomeMessage(
  projectTitle: string,
  projectContext?: string | null,
  identity?: string | null,
  observability?: { project_id: string }
): Promise<string> {
  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

  let userPrompt = `Generate a welcome message for a project called "${projectTitle}".`
  if (projectContext) {
    userPrompt += `\n\nBackground context about this project:\n${projectContext}`
  }

  const callStart = Date.now()
  const response = await anthropic.messages.create({
    model: AGENT_MODEL,
    system: buildWelcomeSystemPrompt(identity),
    messages: [{ role: 'user', content: userPrompt }],
    max_tokens: 512,
    temperature: AGENT_TEMPERATURE,
  })

  if (observability && response.usage) {
    void logAnthropicCall({
      project_id: observability.project_id,
      route: 'welcome',
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

  const textBlock = response.content.find((b) => b.type === 'text')
  return textBlock?.text || ''
}
