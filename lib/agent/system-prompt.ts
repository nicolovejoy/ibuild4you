import { latestShipped } from '@/lib/brief/shipped'
import { AGENT_BEHAVIOR_RULES, CONVERGE_BEHAVIOR_RULES, DEFAULT_IDENTITY, FACILITATOR_IDENTITY, FACILITATOR_RULES } from './constants'
import { briefRoleLabel } from '@/lib/roles/display'
import { renderPrototypeFeedbackBlock, type PrototypeFeedbackItem } from './prototype-feedback'
import { renderPrototypeContextBlock, type PrototypeContextItem } from './prototype-context'
import { renderArtifactContextBlock, type ArtifactContextItem } from './artifact-context'
import { renderSiblingDecisionsBlock, type SiblingDecision } from './sibling-decisions'
import { renderPreviousConversationsBlock, type PreviousConversation } from './previous-conversations'
import type { BriefContent, BriefDecision, BriefNote, BriefRole } from '@/lib/types'
import { riskText, riskOwner } from '@/lib/brief/risks'
import { LOCALE_NAMES, type Locale } from '@/lib/locale'

// Maker name and gap-since-last-message are read live per request (not
// snapshotted into the session like seed_questions / directives) so that
// name edits and real elapsed time are reflected on every turn. The gap and
// the prototype feedback/context are the live-read fields that change between
// turns, so they end up in the volatile block (see SystemPromptParts).
interface SystemPromptInput {
  briefContent: BriefContent | null
  projectContext: string | null
  sessionNumber: number
  seedQuestions?: string[]
  builderDirectives?: string[]
  sessionMode?: 'discover' | 'converge'
  identity?: string
  makerFirstName?: string
  makerLastName?: string
  gapSinceLastMakerMessageMs?: number
  // #214: the maker got the canned "nothing queued" greeting and the builder
  // still hasn't prepared anything, so the agent listens instead of running discovery.
  nothingQueued?: boolean
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
  // #142: locked decisions settled in sibling briefs (same product/github_repo)
  // so Sam doesn't re-ask about things already decided in a related conversation.
  siblingDecisions?: SiblingDecision[]
  // Earlier conversations on this brief as one-line summaries (dates, length,
  // how the agent left things) so Sam can place what the maker refers to
  // instead of guessing they used a different brief. Deterministic, so it
  // lives in the stable block.
  previousConversations?: PreviousConversation[]
  // #229: notes written after each conversation that are not yet folded into
  // the brief (oldest first). Deterministic, so they live in the stable block.
  unfoldedNotes?: BriefNote[]
  // The brief's language (projects.language). Non-English adds a block telling
  // Sam to use it from the very first message, before the maker has written.
  language?: Locale
}

const ONE_HOUR_MS = 60 * 60 * 1000

// #197: a contested lock is shown as still standing, with what the maker asked
// for, so the agent neither re-litigates it each session nor treats it as done.
function contestSuffix(d: BriefDecision): string {
  if (!d.contested) return ''
  return ` — contested: the maker confirmed they want "${d.contested.proposed}" (${d.contested.reason}). A builder will decide; don't reopen it and don't treat it as changed.`
}

function humanizeGap(ms: number): string {
  const hours = ms / (60 * 60 * 1000)
  if (hours < 18) return 'a few hours'
  if (hours < 36) return 'about a day'
  if (hours < 24 * 7) return 'a few days'
  return 'over a week'
}

const noteDayFormat = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Los_Angeles', month: 'short', day: 'numeric' })

// #229: per-conversation notes not yet folded into the brief. The day comes
// from each note's created_at (Pacific), never the clock, so the block is
// byte-stable between turns.
export function renderUnfoldedNotesBlock(notes: BriefNote[]): string | null {
  if (notes.length === 0) return null
  const sections = notes.map((n) => {
    const lines = [`### Conversation of ${noteDayFormat.format(new Date(n.created_at))}`, n.text]
    if (n.decisions.length > 0) {
      lines.push('Decisions:', ...n.decisions.map((d) => `- ${d.topic}: ${d.decision}`))
    }
    if (n.risks_added.length > 0) {
      lines.push(
        'New open questions:',
        ...n.risks_added.map((r) => {
          const owner = riskOwner(r)
          return `- ${riskText(r)}${owner ? ` (${owner})` : ''}`
        })
      )
    }
    if (n.risks_resolved.length > 0) {
      lines.push('Settled:', ...n.risks_resolved.map((t) => `- ${t}`))
    }
    if (n.lock_reversals.length > 0) {
      lines.push(
        'Maker asked to reverse a locked decision:',
        ...n.lock_reversals.map((l) => `- ${l.topic} → ${l.proposed}`)
      )
    }
    return lines.join('\n')
  })
  return `## New since the brief was last curated

These notes were written after each conversation and are not yet folded into the brief above. Treat them as part of what we know; where a note and the brief disagree, the note is newer, and later notes supersede earlier ones.

${sections.join('\n\n')}`
}

// The prompt is sent as two system blocks (lib/agent/prompt-cache.ts):
// `stable` is cache-marked and must be byte-identical from one turn to the
// next; `volatile` is sent uncached and holds the parts that legitimately
// change between back-to-back turns — the "Returning after a break" block
// (present on turn 1 of a return visit, gone on turn 2) and the prototype
// blocks (their "3 days ago" labels roll over daily). Keeping them out of the
// cached prefix is what makes turn 2 a cache read instead of a second write.
export type SystemPromptParts = { stable: string; volatile: string | null }

export function buildSystemPromptParts({ briefContent, projectContext, sessionNumber, seedQuestions, builderDirectives, sessionMode, identity, makerFirstName, makerLastName, gapSinceLastMakerMessageMs, nothingQueued, participants, prototypeFeedback, prototypeContext, pinnedArtifacts, siblingDecisions, previousConversations, unfoldedNotes, language }: SystemPromptInput): SystemPromptParts {
  const parts: string[] = []
  const volatileParts: string[] = []

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

  // #192: seed questions are a discover-mode tool and directives a
  // converge-mode tool — the dashboard Setup tab shows one or the other per
  // mode, and the prompt now matches. Both fields stay on the project doc so
  // flipping the mode never loses them; the hidden one is simply not sent.
  const converge = sessionMode === 'converge'

  // Seed questions and directives are written by the builder in the third
  // person ("his phone"); Sam once carried that straight into a message
  // ("His own spots live only on your phone"). Tell Sam who they're about.
  const aboutTheMaker = multiHuman
    ? `These were written by the builder about the people you're talking to, so they say "he", "she", "they" or a name. When you use them, address the person they're about by first name, and never carry the builder's third-person wording into a message.`
    : `These were written by the builder about the person you're talking to, so they say "he", "she", "they" or the person's name. When you use them, speak to that person as "you". Change every reference, and never carry the builder's third-person wording into a message.`

  if (!converge && seedQuestions && seedQuestions.length > 0) {
    parts.push(`
## Topics to explore

Here are some specific questions to weave into the conversation naturally. Don't ask them all at once — work them in when they fit. You don't need to ask them verbatim; adapt the phrasing to the flow of conversation.

${aboutTheMaker}

${seedQuestions.map((q, i) => `${i + 1}. ${q}`).join('\n')}
`.trim())
  }

  if (language && language !== 'en') {
    const name = LOCALE_NAMES[language]
    parts.push(`
## Language

Converse in ${name} from your very first message, even before the user has written anything. If they switch to another language, follow them.
`.trim())
  }

  if (converge && builderDirectives && builderDirectives.length > 0) {
    parts.push(`
## Directives

The builder has identified specific things to drive toward this session. Work these into the conversation when there's a natural opening — they're priorities, not a script. If the user steers somewhere else, follow them (see the Guardrails on maker direction).

${aboutTheMaker}

${builderDirectives.map((d, i) => `${i + 1}. ${d}`).join('\n')}
`.trim())
  }

  const lockedDecisions = briefContent?.decisions?.filter((d) => d.locked) ?? []
  const openDecisions = briefContent?.decisions?.filter((d) => !d.locked) ?? []

  if (lockedDecisions.length > 0) {
    parts.push(`
## Locked decisions — reconcile against these

These are durable constraints for this project (locked conventions, do-not-use rules, settled choices the build depends on). They are NOT open for casual revisiting:

${lockedDecisions.map((d) => `- **${d.topic}:** ${d.decision}${contestSuffix(d)}`).join('\n')}

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

${briefContent.open_risks.map(renderRisk).join('\n')}
`.trim())
  }

  // #219: what the maker can already try, and what is planned but not built.
  const recentShipped = latestShipped(briefContent?.shipped, 2)
  if (recentShipped.length > 0) {
    parts.push(`
## Shipped recently

These are built and available now. The maker can try them, and may have thoughts on them:

${recentShipped.map((s) => `- ${s.date}: ${s.items.join('; ')}`).join('\n')}
`.trim())
  }

  if (briefContent?.queued && briefContent.queued.length > 0) {
    parts.push(`
## Queued (not built yet)

These are planned but not built. Use them only to understand the project; never tell the maker a queued item exists or when it will ship. If the maker raises one themselves, take their input and make no promise about timing:

${briefContent.queued.map((q) => `- ${q}`).join('\n')}
`.trim())
  }

  if (briefContent && hasBriefContent(briefContent)) {
    parts.push(`
## Current brief

Here's what we know so far. Use this to avoid re-asking things they've already told us, and to ask deeper follow-up questions.

${formatBrief(briefContent)}
`.trim())
  }

  // #229: notes newer than the brief, right after it (also when the brief is empty).
  if (unfoldedNotes && unfoldedNotes.length > 0) {
    const block = renderUnfoldedNotesBlock(unfoldedNotes)
    if (block) parts.push(block)
  }

  // Earlier conversations, right after the brief they were folded into.
  if (previousConversations && previousConversations.length > 0) {
    const block = renderPreviousConversationsBlock(previousConversations)
    if (block) parts.push(block)
  }

  // #142: locked decisions from sibling briefs — qualifies this brief, so it
  // sits right after the brief content.
  if (siblingDecisions && siblingDecisions.length > 0) {
    const block = renderSiblingDecisionsBlock(siblingDecisions)
    if (block) parts.push(block)
  }

  if (prototypeFeedback && prototypeFeedback.length > 0) {
    const block = renderPrototypeFeedbackBlock(prototypeFeedback)
    if (block) volatileParts.push(block)
  }

  if (prototypeContext && prototypeContext.length > 0) {
    const block = renderPrototypeContextBlock(prototypeContext)
    if (block) volatileParts.push(block)
  }

  if (pinnedArtifacts && pinnedArtifacts.length > 0) {
    const block = renderArtifactContextBlock(pinnedArtifacts)
    if (block) parts.push(block)
  }

  if (gapSinceLastMakerMessageMs !== undefined && gapSinceLastMakerMessageMs >= ONE_HOUR_MS) {
    volatileParts.push(`
## Returning after a break

The user is coming back after a gap of ${humanizeGap(gapSinceLastMakerMessageMs)}. Before continuing, briefly recap where the conversation left off (1–2 sentences — what they were describing, what question was on the table), then ask what they want to focus on now. Don't recap the whole project, just the immediate thread.
`.trim())
  }

  if (nothingQueued) {
    volatileParts.push(`
## Nothing queued

The builder has not prepared this conversation yet. Do not run discovery or push toward decisions. Listen, take notes, reflect back what the maker says, and tell them it will be picked up. Keep it short.
`.trim())
  }

  if (sessionNumber > 1) {
    parts.push(`
## Context

This is session #${sessionNumber} with this user. They've chatted before, so greet them warmly but briefly and pick up where things left off. Don't re-introduce yourself.

Don't ask for feedback on the conversation unless a directive asks for it.
`.trim())
  } else {
    parts.push(`
## Context

This is the first session. Introduce yourself briefly — including that you capture their idea into a brief their developer will build from (you're not the one building it) — then ask the user to tell you about their idea. Keep it casual and welcoming.

When you close this session, mention that this is an early beta (a work in progress) and ask: "What could we do better here? Any feedback on how this conversation went?" If they give feedback, thank them genuinely.
`.trim())
  }

  return {
    stable: parts.join('\n\n'),
    volatile: volatileParts.length > 0 ? volatileParts.join('\n\n') : null,
  }
}

// Single-string form, used by tests and anywhere caching doesn't matter.
export function buildSystemPrompt(input: SystemPromptInput): string {
  const { stable, volatile } = buildSystemPromptParts(input)
  return volatile ? `${stable}\n\n${volatile}` : stable
}

function hasBriefContent(brief: BriefContent): boolean {
  return !!(
    brief.problem ||
    brief.target_users ||
    brief.features.length > 0 ||
    brief.constraints ||
    brief.additional_context ||
    (brief.decisions && brief.decisions.length > 0) ||
    (brief.open_risks && brief.open_risks.length > 0) ||
    (brief.shipped && brief.shipped.length > 0) ||
    (brief.queued && brief.queued.length > 0)
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

// Round-two facilitator (spec 08 / contract 08a §6). Deliberately NOT a mode
// of buildSystemPrompt: that function's inputs are all product-brief context
// the facilitator must never see. Title and prompt arrive on every send from
// stars-demo's lib/copy.ts and are never stored here; the output is a fixed
// string per topic so Anthropic prompt caching hits on every turn in a group.
export function buildFacilitatorSystemPrompt({ topicTitle, topicPrompt }: { topicTitle: string; topicPrompt: string }): string {
  return [
    FACILITATOR_IDENTITY,
    `## Topic\n\n**${topicTitle}**\n\n${topicPrompt}`,
    FACILITATOR_RULES,
  ].join('\n\n')
}

// One open-risk line. Owned risks get a hint so the agent asks the maker
// about theirs and leaves the builder's alone (#220).
function renderRisk(r: NonNullable<BriefContent['open_risks']>[number]): string {
  const owner = riskOwner(r)
  const suffix =
    owner === 'maker'
      ? ' (the maker owes an answer — ask them when it fits)'
      : owner === 'builder'
        ? " (the builder's to resolve — don't push the maker on it)"
        : ''
  return `- ${riskText(r)}${suffix}`
}
