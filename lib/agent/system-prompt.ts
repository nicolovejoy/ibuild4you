import { AGENT_BEHAVIOR_RULES, CONVERGE_BEHAVIOR_RULES } from './constants'
import type { BriefContent } from '@/lib/types'

interface SystemPromptInput {
  briefContent: BriefContent | null
  projectContext: string | null
  sessionNumber: number
  seedQuestions?: string[]
  styleGuide?: string
  builderDirectives?: string[]
  sessionMode?: 'discover' | 'converge'
}

export function buildSystemPrompt({ briefContent, projectContext, sessionNumber, seedQuestions, styleGuide, builderDirectives, sessionMode }: SystemPromptInput): string {
  const parts: string[] = []

  parts.push('You are the iBuild4you project intake assistant.')
  parts.push(sessionMode === 'converge' ? CONVERGE_BEHAVIOR_RULES : AGENT_BEHAVIOR_RULES)

  if (styleGuide) {
    parts.push(`
## Style guide for this maker

The following notes describe how to communicate with this particular person. Adapt your tone and approach accordingly.

${styleGuide}
`.trim())
  }

  if (projectContext) {
    parts.push(`
## Background

Here's some context about this person and their project that was provided before the conversation started. Use this as a starting point — you don't need to re-ask about things covered here, but you can dig deeper into them.

${projectContext}
`.trim())
  }

  if (seedQuestions && seedQuestions.length > 0) {
    parts.push(`
## Topics to explore

Here are some specific questions to weave into the conversation naturally. Don't ask them all at once — work them in when they fit. You don't need to ask them verbatim; adapt the phrasing to the flow of conversation.

${seedQuestions.map((q, i) => `${i + 1}. ${q}`).join('\n')}
`.trim())
  }

  if (builderDirectives && builderDirectives.length > 0) {
    parts.push(`
## Directives

The builder has identified specific things to drive toward this session. Actively steer the conversation to address these — don't leave the session without covering them:

${builderDirectives.map((d, i) => `${i + 1}. ${d}`).join('\n')}
`.trim())
  }

  if (briefContent?.decisions && briefContent.decisions.length > 0) {
    parts.push(`
## Decisions already made

These have been decided in prior sessions. Don't revisit them unless the user brings them up:

${briefContent.decisions.map((d) => `- **${d.topic}:** ${d.decision}`).join('\n')}
`.trim())
  }

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
    brief.additional_context ||
    (brief.decisions && brief.decisions.length > 0)
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
