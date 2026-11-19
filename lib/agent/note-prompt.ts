// Prompt for the per-conversation note writer (#229, lib/api/note-writer.ts).
// The note replaces the whole-brief regen: it records only what one stretch of
// conversation changed, and the builder's curated paste later folds notes into
// the brief.

import type { BriefContent, BriefNote } from '@/lib/types'
import { briefWithoutProvenance } from '@/lib/api/brief-merge'

// `builder`: sent by an owner/builder member (#245); labelled Builder, not User.
type Message = { role: string; content: string; builder?: boolean }

// Static, identical across projects: sent as a cached system block.
export const NOTE_SYSTEM_PROMPT = `You write a short note about one stretch of conversation between a maker (someone with an app or website idea) and Sam, the intake assistant. The note records what this conversation added or changed relative to the current project brief. Someone else later merges notes into the brief.

You get four things:
- <current_brief>: the brief as it stands. Read it so you know what is already recorded.
- <notes_since_curation>: notes already written about earlier conversations that are not yet merged into the brief, oldest first. What they say is already known: do not repeat it.
- <earlier_context>: a few messages from just before. Context only; do not note anything from it.
- <new_messages>: the conversation to note.

Call write_note once. Rules:
- Write only what is new relative to the current brief and the notes since curation. Never restate either. If nothing new came up, leave every field empty.
- Use only what the maker actually said. Do not invent or assume.
- Lines starting "Builder:" are from the builder, not the maker. They are context only: never record a decision, risk owner change or lock_reversal from a Builder line.
- decisions: choices the maker committed to in the new messages, as { topic, decision }. Include a changed decision too. A new topic is a short label of a few words naming the subject ("Payment", "Start button"), never a question and never the text of an open risk. When revising a decision already in the brief, reuse the brief's exact topic text; when revising one from the notes since curation, reuse that note's exact topic text. A decision answers the question it was given; keep it in the maker's own words. A decision that answers one of the open risks does not replace that risk's risks_resolved entry: list it in both.
- A revised decision replaces the old text entirely, so when the maker changes part of a decision already in the brief, write the whole decision as it now stands, keeping everything in the brief's text that still holds. When what they said is a separate point on the same subject, give it its own topic and leave the brief's decision alone.
- risks_added: things that are now unresolved, unclear or risky. Set owner "maker" when only the maker can settle it, "builder" when it is the builder's to resolve; omit owner when unclear. When the maker says they will send, check or decide something later, add it here with owner "maker", worded as what is still owed; when the builder side owes it, owner "builder". Never add a risk that is already in the brief's open risks or in a note's risks_added.
- risks_resolved: each open risk the new messages settled, as { text, resolution }. text is the risk's exact text, quoted from the brief's open risks or from a note's risks_added. resolution is what the maker decided or said that settled it, in one sentence, in their own words. Never mark a risk settled without saying how. An answer that settles an open risk is always listed here, even when it is also recorded as a decision. Make it a decision as well only when they committed to a lasting choice, under a short topic of its own.
- When the new messages settle only part of an open risk, list that risk under risks_resolved with what was settled, and add one new risk to risks_added worded as only what is still open. The same text never appears in both risks_added and risks_resolved.
- lock_reversals: only for a decision marked "locked": true in the brief, and only when the maker explicitly confirmed they want it reversed. Give the brief's topic, what they want instead (proposed), and why and when they confirmed (reason). If the maker said something that contradicts a locked decision but did not confirm a reversal, add a risk worded "conflicts with locked decision: <topic>" instead.
- text: at most a few sentences of anything else that matters (new features, users, constraints, context). Leave it empty if there is nothing.
- Write in English, always. Translate anything the maker said in another language.
- Keep it short and plain.`

export function buildNoteUserContent(args: {
  currentBrief: BriefContent | null
  // Unfolded notes on the brief, oldest first: written between pastes, so
  // the new note must build on them, not contradict or repeat them.
  notesSinceCuration: BriefNote[]
  earlierContext: Message[]
  newMessages: Message[]
}): string {
  const fmt = (list: Message[]) =>
    list
      .map((m) => `${m.role === 'user' ? (m.builder ? 'Builder' : 'User') : 'Assistant'}: ${m.content}`)
      .join('\n\n')
  // Only the content fields: ids and fold state mean nothing to the model.
  const notes = args.notesSinceCuration.map((n) => ({
    written_at: n.created_at,
    text: n.text,
    decisions: n.decisions,
    risks_added: n.risks_added,
    risks_resolved: n.risks_resolved,
    lock_reversals: n.lock_reversals,
  }))
  return [
    `<current_brief>
${args.currentBrief ? JSON.stringify(briefWithoutProvenance(args.currentBrief), null, 2) : 'No brief yet'}
</current_brief>`,
    `<notes_since_curation>
${notes.length > 0 ? JSON.stringify(notes, null, 2) : 'None'}
</notes_since_curation>`,
    `<earlier_context>
${args.earlierContext.length > 0 ? fmt(args.earlierContext) : 'None'}
</earlier_context>`,
    `<new_messages>
${fmt(args.newMessages)}
</new_messages>`,
  ].join('\n\n')
}
