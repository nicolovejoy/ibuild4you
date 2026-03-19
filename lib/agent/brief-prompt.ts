import type { BriefContent } from '@/lib/types'

interface BriefPromptInput {
  currentBrief: BriefContent | null
  conversationHistory: { role: string; content: string }[]
}

export function buildBriefPrompt({ currentBrief, conversationHistory }: BriefPromptInput): string {
  const parts: string[] = []

  parts.push(`You are a structured data extraction assistant. Your job is to read a conversation between a user and a project intake assistant, then produce a structured project brief.

Output ONLY valid JSON matching this exact schema (no markdown, no code fences):

{
  "problem": "What problem the user is trying to solve",
  "target_users": "Who the intended users are",
  "features": ["Feature 1", "Feature 2"],
  "constraints": "Any constraints, limitations, or things the user explicitly doesn't want",
  "additional_context": "Any other relevant information that doesn't fit the above categories"
}

Rules:
- Extract information ONLY from what the user has actually said. Do not invent or assume.
- If a field has no information yet, use an empty string (or empty array for features).
- Keep descriptions concise and in plain language.
- Features should be distinct, actionable items (not vague goals).
- If updating an existing brief, preserve information from it unless the conversation contradicts it.`)

  if (currentBrief) {
    parts.push(`
Current brief (update this based on the new conversation):
${JSON.stringify(currentBrief, null, 2)}`)
  }

  parts.push(`
Conversation:
${conversationHistory.map((m) => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`).join('\n\n')}`)

  return parts.join('\n\n')
}
