import { BRIEF_CHAR_BUDGET } from './brief-size'

// #229: how the comms agent curates a brief. Embedded in full in the
// next-convo prep (lib/agent/next-convo-prompt.ts) because the comms agent
// usually runs in claude.ai and cannot open repo files. docs/brief-curation-guide.md
// carries the same text for humans; a test pins the two equal, so edit both.
export const BRIEF_CURATION_GUIDE = `BRIEF CURATION GUIDE

Who reads the brief
- Sam, the intake agent, reads it at the start of every conversation with the maker: it is how Sam knows what is settled, what not to ask again, and where to steer.
- The comms agent (you, when you curate) reads it to prepare each next conversation.
- Claude Code reads it when the build starts.
No person reads it as a document. Write for those agents: terse, factual, no narrative.

Size
- Keep the brief JSON (the "brief" object, serialized) under ${BRIEF_CHAR_BUDGET.toLocaleString('en-US')} characters. Smaller is better: the whole brief goes into every chat turn.
- Near the budget, merge and drop before you add. In a patch, merge two features by dropping both and adding one, and drop before you add.

Patch or whole rewrite
- Normally send "brief_patch": only what this round changes. The app merges it into the brief, and everything you leave out stays as it is. Nothing leaves the brief unless the patch names it in "drop".
- Send the whole "brief" instead, rewritten and trimmed to fit, when the prep says the brief is over budget or has no content yet, or when the builder asks for a compaction in the chat. Never send both.
- Only a whole rewrite clears a text field or merges or removes shipped batches. A patch adds, replaces and drops by name; it merges two features or two risks by dropping both and adding one.
- To change a text field in a patch, start from the field's current text as shown in the brief, edit it, and send the whole new text, not only the new sentence.
- In a patch, a decision you revise is restated whole under its exact topic. A feature or a risk you reword is dropped by its old text and added with the new. A settled risk is dropped by its exact text, in the same patch that records its answer. A queued item that shipped, by a note or a build report, is dropped from "queued" by its text and added to "shipped" under the day it went live (the report's day, else the latest batch's date, else today).
- Copy each topic and text you drop from the brief as shown. A drop that matches nothing refuses the whole payload.
- A locked decision is not part of a patch: do not restate it, reword it or drop it. The app leaves it as it is.

Keep
- What Sam needs so it does not ask the maker again: facts about the maker's world, their preferences, every decision still in force.
- What Sam needs to steer: open risks, gaps, what the maker is unsure about.

Merge
- Duplicates and near-duplicates (the same feature or fact raised in different conversations) into one entry.
- A feature and its refinements into one feature.

Drop
(In a whole rewrite, leave these out. In a patch, a whole entry goes in "drop"; detail inside a decision or a text field goes by restating it without the detail; inside a feature or a risk, drop the old text and add the shorter one.)
- History: who said what and when, how a decision was reached, earlier wording. The app keeps every past version.
- Detail a later decision superseded.
- An open risk a note marks as settled, once its answer is recorded in the brief (as a decision when the maker committed to a choice, otherwise in the field that fits).

Decisions
- In a whole rewrite, a locked decision ("locked": true) is copied verbatim, every field. Never reword it, never drop it, never unset the lock. In a patch, leave it out entirely.
- When a note records that the maker asked to reverse a locked decision, the app has already put that on the brief as "contested". In a whole rewrite, carry "contested" and "contest_dismissed" exactly as they appear. In either form, do not change the decision, the lock or the contest yourself. The builder settles it.
- When a note revises a decision, keep that decision's "topic" text exactly as it is on the brief and change only "decision". The app matches decisions by topic; a reworded topic reads as a new decision and loses its history.
- Keep each decision within the question it answered, in the maker's own words.
- Leave out decided_in_session, decided_at, revised_in_session and revised_at. The app keeps each decision's history itself, matched by topic.

Open risks
- Every open risk is an object with "text" and "owner": "maker" when only the maker can settle it (their preference, a fact about their world, a choice that is theirs), "builder" when it is the builder's to resolve (technical, scheduling, something the builder said they would look into).
- Carry an existing owner forward. Give an ownerless risk the owner that fits. In a patch, an existing risk is sent only to set its owner: its text as shown in the brief, with the owner. The app keeps the brief's text.

Shipped and queued
- "shipped" is dated batches of things already built: { "date": "YYYY-MM-DD", "items": [...] }. Keep every batch; only when the size budget presses, merge or drop the oldest first (a whole rewrite does this; a patch cannot).
- A dated "we shipped X" passage in additional_context belongs in "shipped". Move it there.
- "queued" is a list of things planned but not built. When a queued item shipped, by a note or a build report, remove it from "queued" and add it to "shipped" (in a whole rewrite: the report's day for a report, else the latest batch; in a patch: see Patch or whole rewrite).
- In a whole rewrite, always carry "shipped" and "queued" forward: a brief written without them loses them. A patch leaves them as they are unless it adds or drops entries.

Language
- The brief is in English whatever language the maker speaks, because the agents that read it work in English. Translate the maker's words.`
