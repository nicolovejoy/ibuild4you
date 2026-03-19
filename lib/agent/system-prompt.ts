import { AGENT_BEHAVIOR_RULES } from './constants'
import type { BriefContent } from '@/lib/types'

interface SystemPromptInput {
  briefContent: BriefContent | null
  sessionNumber: number
}

export function buildSystemPrompt({ briefContent, sessionNumber }: SystemPromptInput): string {
  const parts: string[] = []

  parts.push('You are the iBuild4you project intake assistant.')
  parts.push(AGENT_BEHAVIOR_RULES)

  if (briefContent && hasBriefContent(briefContent)) {
    parts.push(`
## Current project brief

Here's what we know about the user's project so far. Use this to avoid re-asking things they've already told us, and to ask deeper follow-up questions.

${formatBrief(briefContent)}
`.trim())
  }

  if (sessionNumber > 1) {
    parts.push(`
## Context

This is session #${sessionNumber} with this user. They've chatted before, so greet them warmly but briefly and pick up where things left off. Don't re-introduce yourself.
`.trim())
  } else {
    parts.push(`
## Context

This is the first session. Introduce yourself briefly and ask the user to tell you about their idea. Keep it casual and welcoming.
`.trim())
  }

  return parts.join('\n\n')
}

function hasBriefContent(brief: BriefContent): boolean {
  return !!(
    brief.problem ||
    brief.target_users ||
    brief.features.length > 0 ||
    brief.constraints ||
    brief.additional_context
  )
}

function formatBrief(brief: BriefContent): string {
  const sections: string[] = []

  if (brief.problem) sections.push(`**Problem:** ${brief.problem}`)
  if (brief.target_users) sections.push(`**Target users:** ${brief.target_users}`)
  if (brief.features.length > 0) {
    sections.push(`**Features:**\n${brief.features.map((f) => `- ${f}`).join('\n')}`)
  }
  if (brief.constraints) sections.push(`**Constraints:** ${brief.constraints}`)
  if (brief.additional_context) sections.push(`**Additional context:** ${brief.additional_context}`)

  return sections.join('\n\n')
}
