import type { BriefContent } from '@/lib/types'

interface PrepPromptInput {
  currentBrief: BriefContent | null
  conversationHistory: { role: string; content: string }[]
  projectTitle: string
  sessionCount: number
}

export function buildPrepPrompt({ currentBrief, conversationHistory, projectTitle, sessionCount }: PrepPromptInput): string {
  const parts: string[] = []

  parts.push(`I'm a project builder managing an intake project. I need your help preparing for the next session with my maker (the person whose app idea we're exploring).

<project>
Title: ${projectTitle}
Sessions so far: ${sessionCount}
</project>`)

  parts.push(`<current_brief>
${currentBrief ? JSON.stringify(currentBrief, null, 2) : 'No brief yet'}
</current_brief>`)

  parts.push(`<conversation_history>
${conversationHistory.map((m) => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`).join('\n\n')}
</conversation_history>

Please review this project and let's discuss:
- What went well in the conversation so far?
- What should the next session focus on?
- Should we stay in discover mode or switch to converge?

When I say "give me the output", produce ONLY valid JSON matching this schema (no markdown, no code fences):

{
  "brief": {
    "problem": "What problem the user is trying to solve",
    "target_users": "Who the intended users are",
    "features": ["Feature 1", "Feature 2"],
    "constraints": "Any constraints, limitations, or things the user explicitly doesn't want",
    "additional_context": "Any other relevant information that doesn't fit the above categories",
    "decisions": [{ "topic": "short label", "decision": "what was decided" }]
  },
  "session_opener": "The message the agent sends to start the next session",
  "builder_directives": ["Things the agent should push toward"],
  "session_mode": "discover or converge"
}

Rules for the brief:
- Extract information ONLY from what the user has actually said. Do not invent or assume.
- If a field has no information yet, use an empty string (or empty array for features/decisions).
- Keep descriptions concise and in plain language.
- Features should be distinct, actionable items (not vague goals).
- If updating an existing brief, preserve information from it unless the conversation contradicts it.
- A decision = the user committed to a specific choice (not just mentioned an option). Each decision has a short topic label and the decision itself.
- Preserve prior decisions unless the user explicitly reversed one in the conversation.`)

  return parts.join('\n\n')
}
