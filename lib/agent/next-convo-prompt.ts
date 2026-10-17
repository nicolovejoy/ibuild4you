import type { BriefContent } from '@/lib/types'
import { LOCALE_NAMES, toLocale, type Locale } from '@/lib/locale'

interface NextConvoPromptInput {
  currentBrief: BriefContent | null
  conversationHistory: { role: string; content: string }[]
  projectTitle: string
  sessionCount: number
  language?: Locale
}

// Static portion of the next-convo prep prompt: intro, JSON schema, extraction
// rules. Identical across all projects and all calls. Passed as a system block
// with cache_control by lib/api/briefs.ts so the Anthropic prompt cache can
// serve it across calls — both within a single cron tick (multiple idle
// projects in one loop) and across cron ticks within the 5-minute TTL.
export const NEXT_CONVO_SYSTEM_PROMPT = `NEXT-CONVO PREP — output a "next-convo" payload for an EXISTING project.
The first key of your JSON output MUST be \`"_payload_type": "next-convo"\`.
Do NOT include \`title\`, \`requester_email\`, or maker names — those are create-only fields.

I'm a project builder managing an intake project. I need your help preparing for the next session with my maker (the person whose app idea we're exploring).

When I say "give me the output", produce ONLY valid JSON matching this schema (no markdown, no code fences). Use straight ASCII quotes only (" and '), never curly/smart quotes, and no non-breaking spaces. \`_payload_type\` MUST be the first key.

{
  "_payload_type": "next-convo",
  "brief": {
    "problem": "What problem the user is trying to solve",
    "target_users": "Who the intended users are",
    "features": ["Feature 1", "Feature 2"],
    "constraints": "Any constraints, limitations, or things the user explicitly doesn't want",
    "additional_context": "Any other relevant information that doesn't fit the above categories",
    "decisions": [{ "topic": "short label", "decision": "what was decided", "decided_in_session": "optional session id", "decided_at": "optional ISO timestamp" }],
    "open_risks": ["plain-language description of something unresolved, unclear, or risky", { "text": "a risk only one side can settle", "owner": "maker" }]
  },
  "welcome_message": "Posted word for word as the agent's first message when the maker opens the next session, so include any link or step they need. Omit it to let the agent greet them itself.",
  "nudge_message": "Optional. Verbatim outbound nudge text used to invite the maker back. Omit to let the system auto-draft.",
  "voice_sample": "Optional. One paragraph showing how the builder texts this person by hand — anchors AI-generated outbound copy.",
  "identity": "Optional. Custom agent persona override for this project. Omit unless the builder explicitly wants a non-default persona.",
  "context": "Optional. Background the agent uses to skip basic discovery questions. Update only if new background surfaced in the conversation.",
  "session_mode": "discover (broad exploration) or converge (narrow toward decisions)",
  "seed_questions": ["Questions the agent should weave into the early part of the next session. Used only in discover mode."],
  "builder_directives": ["Instructions injected into the agent's system prompt to steer the conversation — e.g. 'push toward a decision on auth flow'. Used only in converge mode; ignored in discover mode. Guardrails that must hold in every session belong in context."]
}

Rules:
- Only include top-level fields the conversation actually addressed. Omit fields the builder didn't discuss — don't invent a \`nudge_message\` or \`voice_sample\` from thin air.
- \`session_opener\` is accepted as a legacy alias for \`welcome_message\` — prefer \`welcome_message\`.
- The maker's language is given in the <project> block. Write \`welcome_message\` and \`nudge_message\` in that language. The project's language setting already makes the agent use it, so don't add a directive for it. The brief itself always stays in English (the builder reads it): translate anything the maker said in another language.
- Extract brief content ONLY from what the user has actually said. Do not invent or assume.
- If a brief field has no information yet, use an empty string (or empty array for features/decisions/open_risks).
- Keep descriptions concise and in plain language.
- Features should be distinct, actionable items (not vague goals).
- If updating an existing brief, preserve information from it unless the conversation contradicts it.
- A decision = the user committed to a specific choice (not just mentioned an option). Each decision has a short topic label and the decision itself.
- A decision answers the question it was given. Keep it within that question's scope: don't turn an answer about one feature into a general rule, or into a separate decision. Use the maker's own words, quoting them when they're short. Don't record consequences or follow-on changes the maker didn't state.
- Preserve prior decisions unless the user explicitly reversed one in the conversation.
- A decision may carry \`"locked": true\` — a durable constraint (e.g. a locked convention or do-not-use rule). NEVER drop, reword, or unset a locked decision; carry it forward verbatim with \`"locked": true\`. If the conversation contains a statement that contradicts a locked decision but the user did not explicitly confirm reversing it, keep the locked decision as-is and record the contradiction in \`open_risks\` (e.g. "conflicts with locked decision: <topic>"). If the user DID explicitly confirm the reversal, keep the locked decision as-is and add \`"contested": { "proposed": "<what they want instead>", "reason": "<why, and when they confirmed it>" }\` on that decision instead of an open risk — a builder decides whether the lock changes. Never set \`contested\` on an unlocked decision.
- A decision may carry \`decided_in_session\` (session id, or null for out-of-band) and \`decided_at\` (ISO timestamp) — provenance stamps. Carry these through unchanged if present; you may set them when you know the real provenance; omit otherwise (the system stamps new decisions itself).
- Open risks = things that are unresolved, unclear, or risky based on the conversation. Extract from what the user actually said — don't invent risks. Examples: "no plan for getting first users", "pricing model undecided", "unclear how data gets into the system". A risk may carry \`"owner": "maker"\` when only the maker can settle it (their preference, a fact about their world, a decision that is theirs to make) or \`"owner": "builder"\` when it is the builder's to resolve (technical, scheduling, something the builder said they would look into); omit \`owner\` when unclear. Carry an existing owner forward unless the conversation resolved the risk.

Please review the project data the builder will give you next and let's discuss:
- What went well in the conversation so far?
- What should the next session focus on?
- Should we stay in discover mode or switch to converge?`

// Dynamic portion: per-project state (title, session count, current brief,
// conversation history). Returned as a separate string so callers can place a
// second cache_control breakpoint after it — when the same project is
// regenerated twice without a new maker message, the second call hits the
// cache for nearly the entire prompt.
export function buildNextConvoUserContent({
  currentBrief,
  conversationHistory,
  projectTitle,
  sessionCount,
  language,
}: NextConvoPromptInput): string {
  return [
    `<project>
Title: ${projectTitle}
Sessions so far: ${sessionCount}
Maker's language: ${LOCALE_NAMES[toLocale(language)]}
</project>`,
    `<current_brief>
${currentBrief ? JSON.stringify(currentBrief, null, 2) : 'No brief yet'}
</current_brief>`,
    `<conversation_history>
${conversationHistory.map((m) => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`).join('\n\n')}
</conversation_history>`,
  ].join('\n\n')
}

// Combined string used by the Brief tab's "Copy next-convo prep" button — the
// builder pastes the whole thing into a Claude.ai conversation. The auto
// brief-regen path in lib/api/briefs.ts calls the split halves directly so it
// can place cache_control markers.
export function buildNextConvoPrompt(input: NextConvoPromptInput): string {
  return `${NEXT_CONVO_SYSTEM_PROMPT}\n\n${buildNextConvoUserContent(input)}`
}
