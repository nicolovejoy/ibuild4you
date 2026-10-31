import type { BriefContent, BriefNote, PrepStamp } from '@/lib/types'
import { LOCALE_NAMES, toLocale, type Locale } from '@/lib/locale'
import { riskOwner, riskText } from '@/lib/brief/risks'
import { BRIEF_CHAR_BUDGET } from './brief-size'
import { BRIEF_CURATION_GUIDE } from './curation-guide'

interface NextConvoPromptInput {
  currentBrief: BriefContent | null
  // #229: the unfolded per-conversation notes (oldest first) replace the full
  // transcript. The comms agent folds them into the brief.
  notes: BriefNote[]
  // Copied back unchanged as `_prep_stamp`; the paste guard checks it.
  stamp: PrepStamp
  projectTitle: string
  sessionCount: number
  language?: Locale
}

// Static portion of the next-convo prep prompt: task, JSON schema, rules and
// the curation guide. Identical across all projects and all calls.
export const NEXT_CONVO_SYSTEM_PROMPT = `NEXT-CONVO PREP — output a "next-convo" payload for an EXISTING project.
The first key of your JSON output MUST be \`"_payload_type": "next-convo"\`.
Do NOT include \`title\`, \`requester_email\`, or maker names — those are create-only fields.

I'm a project builder managing an intake project. I need your help preparing for the next session with my maker (the person whose app idea we're exploring), and curating the project's brief.

Your curation task: rewrite the brief whole, from the current brief plus every note below. After each conversation with the maker, the app writes a short note of what that conversation added (decisions, new open risks, risks settled, and any request to reverse a locked decision). Fold every note into the brief, so that the brief alone says everything the notes say. Be terse. You are free to merge entries and drop history and superseded detail. Keep the brief under ${BRIEF_CHAR_BUDGET.toLocaleString('en-US')} characters of JSON; its current size is given in the <current_brief> block. The brief's readers are agents, not people: Sam (the intake agent that talks to the maker), the comms agent (you), and Claude Code when the build starts. The curation guide at the end says how.

When I say "give me the output", produce ONLY valid JSON matching this schema (no markdown, no code fences). Use straight ASCII quotes only (" and '), never curly/smart quotes, and no non-breaking spaces. \`_payload_type\` MUST be the first key.

{
  "_payload_type": "next-convo",
  "_prep_stamp": { "brief_version": 0, "note_ids": [] },
  "brief": {
    "problem": "What problem the user is trying to solve",
    "target_users": "Who the intended users are",
    "features": ["Feature 1", "Feature 2"],
    "constraints": "Any constraints, limitations, or things the user explicitly doesn't want",
    "additional_context": "Any other relevant information that doesn't fit the above categories",
    "decisions": [{ "topic": "short label", "decision": "what was decided", "decided_in_session": "optional session id", "decided_at": "optional ISO timestamp", "revised_in_session": "optional session id", "revised_at": "optional ISO timestamp" }],
    "open_risks": [{ "text": "plain-language description of something unresolved, unclear, or risky", "owner": "maker" }],
    "shipped": [{ "date": "YYYY-MM-DD", "items": ["something built and available to the maker"] }],
    "queued": ["something planned but not built yet"]
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
- \`_prep_stamp\`: copy the JSON from the <prep_stamp> block exactly, unchanged, as a top-level key (the values in the schema above are placeholders). The app uses it to fold exactly the notes you were given and to warn if the brief moved on after this prep was made.
- Always include the whole \`brief\`, rewritten: every field, even unchanged ones. Anything you leave out of it is gone from the brief.
- For the other top-level fields, include only what our discussion actually addressed. Omit the rest — don't invent a \`nudge_message\` or \`voice_sample\` from thin air.
- \`session_opener\` is accepted as a legacy alias for \`welcome_message\` — prefer \`welcome_message\`.
- The maker's language is given in the <project> block. Write \`welcome_message\` and \`nudge_message\` in that language. The project's language setting already makes the agent use it, so don't add a directive for it. The brief itself always stays in English, because the agents that read it (Sam, the comms agent, Claude Code) work in English: translate anything the maker said in another language.
- Build the brief ONLY from the current brief and the notes. Do not invent or assume.
- If a brief field has no information yet, use an empty string (or empty array for features/decisions/open_risks). \`shipped\` and \`queued\` may be omitted when empty.
- Carry \`shipped\` and \`queued\` forward: they are part of the whole brief, so anything you leave out is gone. Move dated "we shipped X" history out of \`additional_context\` into \`shipped\` as \`{ "date", "items" }\` batches. When a note says a queued item shipped, remove it from \`queued\` and add it to the latest \`shipped\` batch.
- Features should be distinct, actionable items (not vague goals).
- A decision = the user committed to a specific choice (not just mentioned an option). Each decision has a short topic label and the decision itself.
- A decision answers the question it was given. Keep it within that question's scope: don't turn an answer about one feature into a general rule, or into a separate decision. Use the maker's own words, quoting them when they're short. Don't record consequences or follow-on changes the maker didn't state.
- Keep every decision still in force. A note's decision on a topic the brief already has is a revision: the decision keeps its \`topic\` text exactly as on the brief (the app matches provenance by topic) and only \`decision\` changes.
- A decision may carry \`"locked": true\` — a durable constraint (e.g. a locked convention or do-not-use rule). NEVER drop, reword, or unset a locked decision; carry it forward verbatim with \`"locked": true\`. When a note says the maker asked to reverse a locked decision, that request is already on the brief as \`contested\` (the app put it there when it wrote the note): carry \`contested\` and \`contest_dismissed\` exactly as they appear, and never add, change or remove them yourself. A builder decides whether the lock changes.
- A decision may carry \`decided_in_session\` / \`decided_at\` and \`revised_in_session\` / \`revised_at\` — provenance stamps. Carry them through unchanged; never invent them (the system stamps new and revised decisions itself).
- Open risks = things that are unresolved, unclear, or risky. Every open risk carries \`"owner": "maker"\` when only the maker can settle it (their preference, a fact about their world, a decision that is theirs to make) or \`"owner": "builder"\` when it is the builder's to resolve (technical, scheduling, something the builder said they would look into). Carry an existing owner forward. Drop a risk a note marks as settled.

${BRIEF_CURATION_GUIDE}

Please review the project data the builder will give you next and let's discuss before you produce the output:
- What went well in the conversations so far?
- What should the next session focus on?
- Should we stay in discover mode or switch to converge?`

const noteDayFormat = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/Los_Angeles',
  month: 'short',
  day: 'numeric',
})

// One <note> per unfolded note: its id (the stamp lists it), the Pacific day
// it was written, and each non-empty field.
function renderNote(n: BriefNote): string {
  const lines = [`<note id="${n.id}" day="${noteDayFormat.format(new Date(n.created_at))}">`]
  if (n.text.trim()) lines.push(n.text.trim())
  if (n.decisions.length > 0) {
    lines.push('Decisions:', ...n.decisions.map((d) => `- ${d.topic}: ${d.decision}`))
  }
  if (n.risks_added.length > 0) {
    lines.push(
      'New open risks:',
      ...n.risks_added.map((r) => {
        const owner = riskOwner(r)
        return `- ${riskText(r)}${owner ? ` (owner: ${owner})` : ''}`
      })
    )
  }
  if (n.risks_resolved.length > 0) {
    lines.push('Risks settled:', ...n.risks_resolved.map((t) => `- ${t}`))
  }
  if (n.lock_reversals.length > 0) {
    lines.push(
      'Maker asked to reverse a locked decision (already on the brief as contested):',
      ...n.lock_reversals.map((l) => `- ${l.topic}: wants "${l.proposed}" (${l.reason})`)
    )
  }
  lines.push('</note>')
  return lines.join('\n')
}

// Dynamic portion: per-project state (title, session count, current brief
// and its size, unfolded notes, the stamp to copy back).
export function buildNextConvoUserContent({
  currentBrief,
  notes,
  stamp,
  projectTitle,
  sessionCount,
  language,
}: NextConvoPromptInput): string {
  const size = currentBrief ? JSON.stringify(currentBrief).length : 0
  return [
    `<project>
Title: ${projectTitle}
Sessions so far: ${sessionCount}
Maker's language: ${LOCALE_NAMES[toLocale(language)]}
</project>`,
    `<current_brief version="${stamp.brief_version}">
Current size: ${size.toLocaleString('en-US')} characters (budget ${BRIEF_CHAR_BUDGET.toLocaleString('en-US')})
${currentBrief ? JSON.stringify(currentBrief, null, 2) : 'No brief yet'}
</current_brief>`,
    `<notes>
${notes.length > 0 ? notes.map(renderNote).join('\n\n') : 'No new notes since the brief was last curated.'}
</notes>`,
    `<prep_stamp>
${JSON.stringify(stamp)}
</prep_stamp>`,
  ].join('\n\n')
}

// The whole prep, used by the Brief tab's "Copy next-convo prep" button: the
// builder pastes it into a comms-agent conversation (usually claude.ai).
export function buildNextConvoPrompt(input: NextConvoPromptInput): string {
  return `${NEXT_CONVO_SYSTEM_PROMPT}\n\n${buildNextConvoUserContent(input)}`
}
