import type { BriefContent } from '@/lib/types'

interface NextConvoPromptInput {
  currentBrief: BriefContent | null
  conversationHistory: { role: string; content: string }[]
  projectTitle: string
  sessionCount: number
}

// Builds the "next-convo" prep prompt.
//
// Used by the Brief tab's "Copy next-convo prep" button and by the
// auto brief-regen path in lib/api/briefs.ts. The receiving Claude
// returns a "next-convo" payload (PATCH /api/projects + new brief
// revision shape — no title, no requester_* fields).
export function buildNextConvoPrompt({ currentBrief, conversationHistory, projectTitle, sessionCount }: NextConvoPromptInput): string {
  const parts: string[] = []

  parts.push(`NEXT-CONVO PREP — output a "next-convo" payload for an EXISTING project.
The first key of your JSON output MUST be \`"_payload_type": "next-convo"\`.
Do NOT include \`title\`, \`requester_email\`, or maker names — those are create-only fields.

I'm a project builder managing an intake project. I need your help preparing for the next session with my maker (the person whose app idea we're exploring).

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

When I say "give me the output", produce ONLY valid JSON matching this schema (no markdown, no code fences). \`_payload_type\` MUST be the first key.

{
  "_payload_type": "next-convo",
  "brief": {
    "problem": "What problem the user is trying to solve",
    "target_users": "Who the intended users are",
    "features": ["Feature 1", "Feature 2"],
    "constraints": "Any constraints, limitations, or things the user explicitly doesn't want",
    "additional_context": "Any other relevant information that doesn't fit the above categories",
    "decisions": [{ "topic": "short label", "decision": "what was decided" }],
    "open_risks": ["plain-language description of something unresolved, unclear, or risky"]
  },
  "welcome_message": "The greeting the agent sends when the maker opens the next session — sets tone and picks up where we left off",
  "nudge_message": "Optional. Verbatim outbound nudge text used to invite the maker back. Omit to let the system auto-draft.",
  "voice_sample": "Optional. One paragraph showing how the builder texts this person by hand — anchors AI-generated outbound copy.",
  "identity": "Optional. Custom agent persona override for this project. Omit unless the builder explicitly wants a non-default persona.",
  "context": "Optional. Background the agent uses to skip basic discovery questions. Update only if new background surfaced in the conversation.",
  "session_mode": "discover (broad exploration) or converge (narrow toward decisions)",
  "seed_questions": ["Questions the agent should weave into the early part of the next session"],
  "builder_directives": ["Instructions injected into the agent's system prompt to steer the conversation — e.g. 'push toward a decision on auth flow'"],
  "layout_mockups": [
    {
      "title": "Strategy name — shown to the maker as a visual wireframe layout",
      "sections": [
        { "type": "hero|text|cta|gallery|form|signup|nav|footer|map|video", "label": "Section label", "description": "What this section does" }
      ]
    }
  ]
}

Rules:
- Only include top-level fields the conversation actually addressed. Omit fields the builder didn't discuss — don't invent a \`nudge_message\` or \`voice_sample\` from thin air.
- \`session_opener\` is accepted as a legacy alias for \`welcome_message\` — prefer \`welcome_message\`.
- Extract brief content ONLY from what the user has actually said. Do not invent or assume.
- If a brief field has no information yet, use an empty string (or empty array for features/decisions/open_risks).
- Keep descriptions concise and in plain language.
- Features should be distinct, actionable items (not vague goals).
- If updating an existing brief, preserve information from it unless the conversation contradicts it.
- A decision = the user committed to a specific choice (not just mentioned an option). Each decision has a short topic label and the decision itself.
- Preserve prior decisions unless the user explicitly reversed one in the conversation.
- Open risks = things that are unresolved, unclear, or risky based on the conversation. Extract from what the user actually said — don't invent risks. Examples: "no plan for getting first users", "pricing model undecided", "unclear how data gets into the system".`)

  return parts.join('\n\n')
}
