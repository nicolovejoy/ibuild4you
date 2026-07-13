import { AGENT_BEHAVIOR_RULES, CONVERGE_BEHAVIOR_RULES, DEFAULT_IDENTITY } from './constants'
import { briefRoleLabel } from '@/lib/roles/display'
import { renderPrototypeFeedbackBlock, type PrototypeFeedbackItem } from './prototype-feedback'
import { renderPrototypeContextBlock, type PrototypeContextItem } from './prototype-context'
import { renderArtifactContextBlock, type ArtifactContextItem } from './artifact-context'
import type { BriefContent, BriefRole, WireframeMockup } from '@/lib/types'

// Maker name and gap-since-last-message are read live per request (not
// snapshotted into the session like seed_questions / directives) so that
// name edits and real elapsed time are reflected on every turn.
interface SystemPromptInput {
  briefContent: BriefContent | null
  projectContext: string | null
  sessionNumber: number
  seedQuestions?: string[]
  builderDirectives?: string[]
  sessionMode?: 'discover' | 'converge'
  layoutMockups?: WireframeMockup[]
  identity?: string
  makerFirstName?: string
  makerLastName?: string
  gapSinceLastMakerMessageMs?: number
  // Multi-human brief: who has posted in this session, in speaking order.
  // When 2+, the prompt switches from single-maker framing to mediation.
  participants?: { name: string; brief_role: BriefRole | null }[]
  // #72: recent Loop feedback the maker submitted from the running prototype,
  // already summarized by the chat route. Grounds Sam in real captured signal.
  prototypeFeedback?: PrototypeFeedbackItem[]
  // #72 B2: structural page captures (route/title/headings/control labels)
  // taken from the maker's own browser via the Loop widget.
  prototypeContext?: PrototypeContextItem[]
  // #83 B: pinned artifacts (files + links) on this brief — names + descriptions
  // only, so Sam knows they exist without claiming to have read them.
  pinnedArtifacts?: ArtifactContextItem[]
}

const ONE_HOUR_MS = 60 * 60 * 1000

function humanizeGap(ms: number): string {
  const hours = ms / (60 * 60 * 1000)
  if (hours < 18) return 'a few hours'
  if (hours < 36) return 'about a day'
  if (hours < 24 * 7) return 'a few days'
  return 'over a week'
}

export function buildSystemPrompt({ briefContent, projectContext, sessionNumber, seedQuestions, builderDirectives, sessionMode, layoutMockups, identity, makerFirstName, makerLastName, gapSinceLastMakerMessageMs, participants, prototypeFeedback, prototypeContext, pinnedArtifacts }: SystemPromptInput): string {
  const parts: string[] = []

  parts.push(identity || DEFAULT_IDENTITY)
  parts.push(sessionMode === 'converge' ? CONVERGE_BEHAVIOR_RULES : AGENT_BEHAVIOR_RULES)

  if (projectContext) {
    parts.push(`
## Background

Here's some context about this person and their project that was provided before the conversation started. Use this as a starting point — you don't need to re-ask about things covered here, but you can dig deeper into them.

${projectContext}
`.trim())
  }

  const multiHuman = !!participants && participants.length > 1

  if (multiHuman) {
    const roster = participants!
      .map((p) => `- **${p.name}** — ${p.brief_role ? briefRoleLabel(p.brief_role) : 'Participant'}`)
      .join('\n')
    parts.push(`
## Who's in this conversation

More than one person is collaborating on this brief. Each user message is prefixed with the speaker's name (e.g. "Maria: ...") so you can tell them apart.

${roster}

Address people by their **first name only** (e.g. "Mara", not "Mara O") — a trailing last initial in a name above is only there to tell apart people who share a first name. Help them converge toward one shared brief: when they agree, reflect it back; when they differ, surface the difference gently and ask how they'd like to reconcile it — don't quietly pick a side. The most recent speaker doesn't necessarily speak for everyone, so check in with the others when a decision affects them.
`.trim())
  } else if (makerFirstName) {
    const fullName = makerLastName ? `${makerFirstName} ${makerLastName}` : makerFirstName
    parts.push(`
## Maker

**Name:** ${fullName}

Address them by their first name (${makerFirstName}). A trailing last initial, if shown, is only for disambiguation — don't say it back to them.
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

The builder has identified specific things to drive toward this session. Work these into the conversation when there's a natural opening — they're priorities, not a script. If the user steers somewhere else, follow them (see the Guardrails on maker direction).

${builderDirectives.map((d, i) => `${i + 1}. ${d}`).join('\n')}
`.trim())
  }

  if (layoutMockups && layoutMockups.length > 0) {
    parts.push(`
## Layout mockups

The builder has prepared layout ideas for this project. You can present these to the user using wireframe blocks. To show a wireframe, emit a fenced code block like this:

\`\`\`wireframe
{"title": "Page Layout", "sections": [{"type": "hero", "label": "Welcome", "description": "Main hero image and tagline"}]}
\`\`\`

The user will see a visual preview with labeled, colored blocks — not raw JSON. Available section types: hero, text, cta, gallery, form, signup, nav, footer, map, video.

When presenting layouts:
- Show the wireframe block, then explain it in plain language
- Use labels the user would understand (no jargon)
- If comparing options, show multiple wireframes with different titles
- When the user asks to change something ("move X above Y", "remove the signup"), respond with an updated wireframe block

Here are the mockups the builder prepared:

${layoutMockups.map((m) => '```wireframe\n' + JSON.stringify(m) + '\n```').join('\n\n')}
`.trim())
  } else {
    parts.push(`
## Layout visualization

When discussing page layout or site structure with the user, you can show a visual wireframe by emitting a fenced code block:

\`\`\`wireframe
{"title": "Page Layout", "sections": [{"type": "hero", "label": "Welcome", "description": "Main hero image and tagline"}]}
\`\`\`

The user will see a visual preview with labeled, colored blocks — not raw JSON. Available section types: hero, text, cta, gallery, form, signup, nav, footer, map, video.

Only use this when it would genuinely help the conversation — don't force it. When the user asks to change something in a layout, respond with an updated wireframe block.
`.trim())
  }

  const lockedDecisions = briefContent?.decisions?.filter((d) => d.locked) ?? []
  const openDecisions = briefContent?.decisions?.filter((d) => !d.locked) ?? []

  if (lockedDecisions.length > 0) {
    parts.push(`
## Locked decisions — reconcile against these

These are durable constraints for this project (locked conventions, do-not-use rules, settled choices the build depends on). They are NOT open for casual revisiting:

${lockedDecisions.map((d) => `- **${d.topic}:** ${d.decision}`).join('\n')}

Before accepting any new thing the user tells you, check it against these locked decisions. If something they say **contradicts** a locked decision (e.g. they ask for a tool that's on the do-not-use list, or a convention that conflicts with one above), do NOT silently go along with it. Surface the conflict plainly — name the locked decision and ask whether they really mean to reverse it. Only treat it as changed if they explicitly confirm the reversal. Otherwise the locked decision stands.
`.trim())
  }

  if (openDecisions.length > 0) {
    parts.push(`
## Decisions already made

These have been decided in prior sessions. Don't revisit them unless the user brings them up:

${openDecisions.map((d) => `- **${d.topic}:** ${d.decision}`).join('\n')}
`.trim())
  }

  if (briefContent?.open_risks && briefContent.open_risks.length > 0) {
    parts.push(`
## Open risks

These are unresolved or risky areas from prior sessions. Probe these when the opportunity arises — they're good candidates for Challenging or Deepening:

${briefContent.open_risks.map((r) => `- ${r}`).join('\n')}
`.trim())
  }

  if (briefContent && hasBriefContent(briefContent)) {
    parts.push(`
## Current brief

Here's what we know so far. Use this to avoid re-asking things they've already told us, and to ask deeper follow-up questions.

${formatBrief(briefContent)}
`.trim())
  }

  if (prototypeFeedback && prototypeFeedback.length > 0) {
    const block = renderPrototypeFeedbackBlock(prototypeFeedback)
    if (block) parts.push(block)
  }

  if (prototypeContext && prototypeContext.length > 0) {
    const block = renderPrototypeContextBlock(prototypeContext)
    if (block) parts.push(block)
  }

  if (pinnedArtifacts && pinnedArtifacts.length > 0) {
    const block = renderArtifactContextBlock(pinnedArtifacts)
    if (block) parts.push(block)
  }

  if (gapSinceLastMakerMessageMs !== undefined && gapSinceLastMakerMessageMs >= ONE_HOUR_MS) {
    parts.push(`
## Returning after a break

The user is coming back after a gap of ${humanizeGap(gapSinceLastMakerMessageMs)}. Before continuing, briefly recap where the conversation left off (1–2 sentences — what they were describing, what question was on the table), then ask what they want to focus on now. Don't recap the whole project, just the immediate thread.
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

This is the first session. Introduce yourself briefly — including that you capture their idea into a brief their developer will build from (you're not the one building it) — then ask the user to tell you about their idea. Keep it casual and welcoming.
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
    (brief.decisions && brief.decisions.length > 0) ||
    (brief.open_risks && brief.open_risks.length > 0)
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
