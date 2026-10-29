// Prompt for the per-conversation note writer (#229, lib/api/note-writer.ts).
// The note replaces the whole-brief regen: it records only what one stretch of
// conversation changed, and the builder's curated paste later folds notes into
// the brief.

import type { BriefContent } from '@/lib/types'

type Message = { role: string; content: string }

// Static, identical across projects: sent as a cached system block.
export const NOTE_SYSTEM_PROMPT = `You write a short note about one stretch of conversation between a maker (someone with an app or website idea) and Sam, the intake assistant. The note records what this conversation added or changed relative to the current project brief. Someone else later merges notes into the brief.

You get three things:
- <current_brief>: the brief as it stands. Read it so you know what is already recorded.
- <earlier_context>: a few messages from just before. Context only; do not note anything from it.
- <new_messages>: the conversation to note.

Call write_note once. Rules:
- Write only what is new relative to the current brief. Never restate the brief. If nothing new came up, leave every field empty.
- Use only what the maker actually said. Do not invent or assume.
- decisions: choices the maker committed to in the new messages, as { topic, decision }. Include a changed decision too. When revising a decision already in the brief, reuse the brief's exact topic text. A decision answers the question it was given; keep it in the maker's own words.
- risks_added: things that are now unresolved, unclear or risky. Set owner "maker" when only the maker can settle it, "builder" when it is the builder's to resolve; omit owner when unclear.
- risks_resolved: the exact text of open risks in the brief that the new messages settled.
- lock_reversals: only for a decision marked "locked": true in the brief, and only when the maker explicitly confirmed they want it reversed. Give the brief's topic, what they want instead (proposed), and why and when they confirmed (reason). If the maker said something that contradicts a locked decision but did not confirm a reversal, add a risk worded "conflicts with locked decision: <topic>" instead.
- text: at most a few sentences of anything else that matters (new features, users, constraints, context). Leave it empty if there is nothing.
- Write in English, always. Translate anything the maker said in another language.
- Keep it short and plain.`

export function buildNoteUserContent(args: {
  currentBrief: BriefContent | null
  earlierContext: Message[]
  newMessages: Message[]
}): string {
  const fmt = (list: Message[]) =>
    list.map((m) => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`).join('\n\n')
  return [
    `<current_brief>
${args.currentBrief ? JSON.stringify(args.currentBrief, null, 2) : 'No brief yet'}
</current_brief>`,
    `<earlier_context>
${args.earlierContext.length > 0 ? fmt(args.earlierContext) : 'None'}
</earlier_context>`,
    `<new_messages>
${fmt(args.newMessages)}
</new_messages>`,
  ].join('\n\n')
}
