# Brief curation: the comms agent curates, the app writes notes (#229) — design

**Status:** decisions by Nico 2026-10-28 (issue #229 comment). The seven open
questions were handed to the builder on 2026-10-29 ("do it yourself"); every
answer below marked **[call]** is the builder's, not Nico's, and is open to his
veto when he reads this.

## Intent

The brief is read by agents, not by Nico: Sam on every chat turn, the comms
agent through the next-convo prep, Claude Code when Nico brings it over. It has
to be skinny and lose nothing important. Today two writers rewrite it whole
every round (the automatic regen after each conversation, and the comms agent's
paste-back), nothing ever removes or merges, so briefs only grow. F4FC's is
~35k chars and its regen writes 10.8k of a 12k output-token cap. An older paste
once overwrote a newer brief silently (2026-10-24).

## Decided by Nico (2026-10-28)

1. **The comms agent curates the brief.** Each round it rewrites the brief
   whole: terse, within a size budget, free to drop and merge.
2. **The app stops rewriting the brief.** After each conversation it writes a
   short "new since the last curation" note from that conversation's messages
   only. Output is proportional to one conversation; input is new messages only.
3. **Sam still knows when a round is skipped.** Sam reads the curated brief
   plus every note not yet folded in.
4. **The prep may carry instructions for the comms agent,** including pointers
   to guidance files under `docs/`.

## Goals / non-goals / anti-goals

- Goal: per-conversation app cost and latency stay flat as a brief ages.
- Goal: a skipped paste round loses nothing; a stale paste cannot silently
  drop newer notes.
- Non-goal: #213 (builder-reviewed session rollup for the chat agent), #217.
- Anti-goal: the app rewriting brief content on its own after cutover. The
  only automatic brief edits allowed are the existing code-side guarantees
  (locks, provenance, contest state, risk owners), applied on the paste path.
- Anti-goal: a note that restates the brief. A note is only what is new.

## Shape

### Notes

- Stored in `briefs/{briefId}/notes/{noteId}`:
  `{ session_id, created_at, folded_at: null | ISO, text, decisions[], risks_added[], risks_resolved[], lock_reversals[] }`.
  `decisions` = `{ topic, decision }` new or changed in this conversation;
  `risks_added` = `{ text, owner? }`; `risks_resolved` = text of risks the
  conversation settled; `lock_reversals` = see Q2. `text` is a few sentences of
  anything else that matters. **[call]** Structured fields rather than free
  prose, so code can stamp provenance and contests and Sam's rendering stays
  compact.
- Written by the job that does regen today (cron after the maker goes idle,
  same breaker in `lib/api/brief-regen-gate.ts`), with a forced tool call and a
  small output cap (`NOTE_MAX_TOKENS`, ~1,500 **[call]**).
- Input: the live brief (for context and dedupe, so the note says only what is
  new), plus the messages since the previous note on this brief, plus the last
  ~6 messages before them for continuity. No other transcripts.
- One note per conversation-idle event. A second idle event in the same
  session writes a second note covering only the newer messages.
- A note is **folded** when a paste includes it (see paste guard). Folded notes
  are kept, marked `folded_at`, never shown to Sam again. **[call]** Keep them:
  they are cheap and they are the audit trail of what the comms agent saw.

### Sam (chat prompt)

`## Current brief` is followed by `## New since the brief was last curated`,
listing unfolded notes oldest first, each headed by its conversation date.
Notes change only at session end or on a paste, so they ride in the **stable**
system block (Q6).

### The prep (comms agent)

`buildNextConvoPrompt` changes from "rewrite the brief from the transcript" to
"curate": it carries the live brief, every unfolded note, and a stamp
`{ brief_version, note_ids }`; it no longer carries the full conversation
history **[call]** (the notes are the conversation's residue; the comms agent
can ask Nico for a transcript if it needs one). It points the comms agent at
`docs/brief-curation-guide.md` (new, committed), which states: who reads the
brief (Sam, the comms agent, Claude Code — not the builder; Q7), the size
budget, keep/drop/merge rules, locks verbatim, risk owners required, and that a
revised decision keeps its topic text so provenance matches.

The payload JSON gains `"_prep_stamp": { "brief_version": n, "note_ids": [...] }`,
which the comms agent copies back unchanged.

### Paste guard

`PUT /api/briefs` with `source: 'paste'` reads `_prep_stamp`:
- No stamp (old prep, or hand-written JSON): save, fold nothing, and the Brief
  tab warns "this paste was not made from a prep; notes were not folded".
- Stamp present: fold exactly the notes listed. If unfolded notes exist that
  the stamp does **not** list (written after the prep was copied), or the live
  brief version is newer than `brief_version`, answer `409` with what would be
  missed; the Brief tab shows it and offers **Save anyway** (sends
  `force: true`). Unlisted notes are never folded, so even a forced paste
  leaves them visible to Sam and the next prep.

## The seven open questions — answers

1. **Size budget [call].** 20,000 chars of brief JSON (`JSON.stringify`), about
   half of F4FC today. The prep states it; the guide tells the comms agent to
   stay under it by merging and dropping history. A paste over budget **saves
   and warns** (Brief tab + response field), never refuses: Nico is the
   authority and a refusal would block him mid-round. Reuse `briefSizeWarning`
   with the new budget; the regen-token-derived budget in `brief-size.ts` goes.
2. **Lock reversals [call].** The note writer records an explicit maker
   reversal of a locked decision as `lock_reversals: [{ topic, proposed, reason }]`.
   Code applies it at note time exactly as regen does today: sets `contested`
   on the matching locked decision of the live brief (text and lock untouched;
   skipped if `contest_dismissed` holds the same proposal). This is the one
   automatic brief edit kept, because the #197 Contested badge and Sam's
   "don't reopen" behaviour must not wait for a paste. A contradiction the
   maker did not confirm goes into `risks_added` as today's open-risk wording.
3. **Risk owners [call].** Both: the guide requires owners, and on paste code
   carries an existing owner forward by text match onto any ownerless risk
   (the helper regen uses for #220). Closes the "a paste does not carry owners"
   gap.
4. **#228 part 2 [call].** Whole-brief curation will reword decisions often, so
   fix it here: on the paste path a decision counts as revised only when its
   normalised text changed (lowercase, collapse whitespace, strip punctuation
   and quotes). Unchanged-after-normalising keeps its stamps as-is.
5. **Migration and the old machinery [call].**
   - Cutover per brief, not a flag day: the note writer replaces
     `regenerateBriefForProject` everywhere at once, but an existing brief is
     untouched until its first curated paste.
   - The cron and breaker are repurposed for notes (same idle trigger, same
     3-strike hold); `BRIEF_MAX_TOKENS` and the whole-brief regen path are
     deleted.
   - The Brief tab's **Regenerate** button becomes **Write note now** (runs the
     note writer for messages since the last note).
   - The "brief not updating" notice is reworded for note failures.
   - F4FC's first curation is a manual comms-agent pass with the budget in the
     prep. Nothing automatic shrinks an existing brief.
6. **Prompt caching [call].** Notes sit in the stable system block right after
   the brief. They change only when a note is written (session end) or folded
   (paste), the same moments the brief itself already changes, so the cached
   prefix is no less stable than today. Verify on prod `api_usage` as in the
   #178 notes.
7. **Who the prep says the readers are [call].** Agents: Sam, the comms agent,
   Claude Code. Drop "the builder reads it" from the prompt; the "brief stays in
   English" rule stays, justified by the agents rather than the builder.

## Kept guarantees on the paste path

Locked decisions survive verbatim (#71); `contested` / `contest_dismissed`
(#197); decision provenance (#121/#218) — new topics are stamped from the note
that introduced them (matched by trimmed, case-insensitive topic) when the
paste lacks stamps, else the paste's own; risk owners (Q3).

## Left to the builder

Firestore indexes for the notes subcollection; exact tool schema and prompt
text for the note writer; Brief-tab layout for notes, the 409 dialog and the
budget warning; whether the dashboard row shows an unfolded-note count; e2e
shape (follow `scripts/e2e-214-stale-greeting.mjs`).

## Sequencing

One plan, one branch. Suggested order: notes store + writer (behind the cron)
→ Sam's prompt block → prep + guide + stamp → paste guard + folding + Q2/Q3/Q4
code → retire whole-brief regen → docs. F4FC needs the prep changes before its
next round, so the prep work should not be last.
