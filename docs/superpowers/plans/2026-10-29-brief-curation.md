# Brief curation (#229) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The app stops rewriting the brief; after each conversation it writes a short note, Sam reads brief + unfolded notes, the prep asks the comms agent to curate, and a paste guard stops a stale paste from silently dropping newer notes.

**Architecture:** Notes live in `briefs/{briefId}/notes`. A note writer (forced tool call, small output) replaces `regenerateBriefForProject` on the notify cron and behind a "Write note now" button. The chat/kickoff prompt adds a `## New since the brief was last curated` block to the stable system block. The prep (built client-side) carries the brief, the unfolded notes and a `_prep_stamp`; `PUT /api/briefs` folds the stamped notes or answers 409.

**Tech Stack:** Next.js App Router, Firestore Admin SDK, Anthropic SDK (forced `tool_choice`), vitest, React Query.

**Spec:** `docs/superpowers/specs/2026-10-29-brief-curation-design.md` (every [call] approved by Nico 2026-10-29).

## Global Constraints

- Note writer model `BRIEF_MODEL` (`claude-sonnet-4-6`), `BRIEF_TEMPERATURE` (0.3), new `NOTE_MAX_TOKENS = 1500`, forced tool `write_note`, usage route label `brief.note`.
- Brief size budget: `BRIEF_CHAR_BUDGET = 20000` chars of `JSON.stringify(content)`. Over budget saves and warns, never refuses.
- Note shape: `{ session_id: string | null, created_at: ISO, folded_at: ISO | null, text: string, decisions: {topic, decision}[], risks_added: (string | {text, owner})[], risks_resolved: string[], lock_reversals: {topic, proposed, reason}[] }`.
- Stamp shape (payload top-level key, copied back unchanged): `"_prep_stamp": { "brief_version": number, "note_ids": string[] }`.
- 409 body: `{ error: 'stale_prep', unlisted_notes: [{ id, created_at }], live_version: number, prep_version: number }`. `force: true` in the PUT body saves anyway; unlisted notes are never folded, forced or not.
- Folded notes are kept with `folded_at` set; never deleted except when the brief's project is deleted.
- Keep the project fields `brief_regen_failures`, `brief_regen_failures_since`, `brief_regen_last_error`, `brief_regen_last_error_at` (no rename); they now describe note failures. Breaker cap stays `BRIEF_REGEN_FAILURE_CAP = 3`.
- Timestamps UTC ISO at rest; any day shown to Nico is `America/Los_Angeles`.
- All reader-facing strings in `lib/copy.ts` (builder UI is English-only today; no French twin needed for builder copy).
- In the worktree run BOTH `npm run build` and `npm run type-check` before claiming clean (CLAUDE.md 🔴). Build needs dummy `NEXT_PUBLIC_FIREBASE_*` env in a worktree.
- The brief stays in English; the prep says its readers are agents (Sam, the comms agent, Claude Code), not the builder.

## Rulings made while planning (open to Nico's veto)

- **No brief yet:** the note writer creates an empty brief doc (all fields empty, `source: 'create'`) so notes have a parent. Most briefs start from a create payload, so this is rare.
- **Where the writer starts:** `projects.notes_through_at` = `created_at` of the newest message any note has covered. Absent → start at the live brief's `updated_at` (the old regen already covered everything before it); no brief → start at the beginning.
- **Empty note:** if the model returns nothing new (every field empty), no note doc is written, but `notes_through_at` still advances.
- **Lock reversals at note time** write a new brief version with a new `BriefSource` value `'note'`.
- **Guide location:** the comms agent usually runs in claude.ai and cannot open repo paths, so the guide text is a TS constant (`BRIEF_CURATION_GUIDE`) embedded in the prep; `docs/brief-curation-guide.md` holds the same text for humans, and a test pins them equal.
- **No composite index:** notes are read as the whole subcollection ordered by `created_at` and filtered in memory (about one note per conversation).
- **Unfolded-note count on the dashboard row:** not built (YAGNI).
- **No-stamp warning** is client-side only, on the Brief tab import path; the structured editor and Restore also PUT without a stamp and must not warn.
- **Lock behaviour on paste** stays as today (the Brief tab confirms before dropping a lock); no server-side lock re-injection on paste.
- **#228 part 2** (normalised comparison) is applied inside `stampDecisionProvenance` for every caller; after this branch the paste path is the main caller.

## Review Focus

1. A prep copied, then the maker talks and a note is written, then the old prep is pasted → 409 listing that note; Save anyway keeps the note unfolded and visible to Sam. (Task 7 test `409 when an unfolded note is not in the stamp`.)
2. A brief that existed before cutover gets its first note → input starts at the brief's `updated_at`, not the whole history. (Task 3 test `starts after brief.updated_at when notes_through_at is absent`.)
3. Two idle events in one session → the second note covers only messages after the first. (Task 3 test `second run covers only newer messages`.)
4. The note writer hits `max_tokens` → typed error `write_note_max_tokens`, breaker counts it, `notes_through_at` does not move. (Task 3 test `max_tokens throws and does not advance notes_through_at`.)
5. A legacy payload with no `_prep_stamp` → saves, folds nothing, and the Brief tab shows the "not made from a prep" line. (Task 6 parse test + Task 7 route test `no stamp saves and folds nothing`.)

---

### Task 1: Notes store and types

**Files:**
- Create: `lib/api/brief-notes.ts`
- Modify: `lib/types/index.ts` (add `BriefNote`, `BriefNoteLockReversal`, `PrepStamp`; add `'note'` to `BriefSource`; add `notes_through_at?: string | null` to the project type near `brief_regen_*`)
- Modify: `lib/copy.ts:214` (source label `note: 'contest from conversation'`)
- Test: `lib/api/__tests__/brief-notes.test.ts`

**Interfaces:**
- Produces:
  - `interface BriefNote { id: string; session_id: string | null; created_at: string; folded_at: string | null; text: string; decisions: { topic: string; decision: string }[]; risks_added: Risk[]; risks_resolved: string[]; lock_reversals: BriefNoteLockReversal[] }`
  - `interface BriefNoteLockReversal { topic: string; proposed: string; reason: string }`
  - `interface PrepStamp { brief_version: number; note_ids: string[] }`
  - `listNotes(db, briefId: string): Promise<BriefNote[]>` (all, oldest first)
  - `listUnfoldedNotes(db, briefId: string): Promise<BriefNote[]>`
  - `addNote(db, briefId: string, note: Omit<BriefNote, 'id'>): Promise<string>`
  - `foldNotes(db, briefId: string, noteIds: string[], now: string): Promise<void>` (sets `folded_at` on each listed id that exists and is unfolded; ignores unknown ids)
  - `isEmptyNote(n: Pick<BriefNote, 'text'|'decisions'|'risks_added'|'risks_resolved'|'lock_reversals'>): boolean`
  - `parsePrepStamp(raw: unknown): PrepStamp | null` (null unless `brief_version` is a non-negative integer and `note_ids` an array of strings)

- [ ] **Step 1: Write failing tests** in `lib/api/__tests__/brief-notes.test.ts` with an in-memory fake in the style of `lib/api/__tests__/apps.test.ts` (fake supports `collection('briefs').doc(id).collection('notes')` with `orderBy('created_at','asc').get()`, `add`, `doc(id).update`):
  - `listUnfoldedNotes returns only notes with folded_at null, oldest first`
  - `foldNotes sets folded_at on listed unfolded ids and ignores unknown ids`
  - `foldNotes leaves an already-folded note's folded_at unchanged`
  - `isEmptyNote is true for blank text and empty arrays, false when any field has content`
  - `parsePrepStamp accepts {brief_version: 3, note_ids: ['a']}` and returns null for `{}`, `{brief_version: -1, note_ids: []}`, `{brief_version: 2, note_ids: [1]}`, `null`
- [ ] **Step 2:** `npx vitest run lib/api/__tests__/brief-notes.test.ts` → FAIL (module missing).
- [ ] **Step 3:** Implement `lib/api/brief-notes.ts` and the type additions.
- [ ] **Step 4:** Same command → PASS; `npm run type-check` clean.
- [ ] **Step 5: Commit** `feat(brief): notes store under briefs/{id}/notes and prep stamp parser`

### Task 2: Provenance — normalised comparison and origin from notes

**Files:**
- Modify: `lib/api/brief-merge.ts` (`stampDecisionProvenance`)
- Test: `lib/api/__tests__/brief-merge.test.ts`

**Interfaces:**
- Produces: `normalizeDecisionText(s: string): string` (lowercase, strip `"'“”‘’` and punctuation `.,;:!?()[]-`, collapse whitespace, trim); `stampDecisionProvenance(args)` gains optional `originByTopic?: Map<string, { session_id: string | null; at: string }>` keyed by the existing `topicKey` (trimmed, lowercased topic).

- [ ] **Step 1: Failing tests:**
  - `a reworded decision whose normalised text matches keeps prev stamps and gains no revised_*` (prev `"Use Stripe only."`, next `"use stripe only"`)
  - `a real change still stamps revised_*` (existing #218 tests keep passing unchanged)
  - `a new topic with no explicit provenance takes its origin from originByTopic` → `decided_in_session` = note's `session_id`, `decided_at` = note's `at`
  - `explicit provenance on the incoming decision still wins over originByTopic`
  - `normalizeDecisionText("  Stripe — ONLY! ") === "stripe only"`
- [ ] **Step 2:** `npx vitest run lib/api/__tests__/brief-merge.test.ts` → new tests FAIL.
- [ ] **Step 3:** Rule 2's `p.decision === n.decision` becomes `normalizeDecisionText(p.decision) === normalizeDecisionText(n.decision)`; Rule 1 consults `originByTopic` before falling back to `sessionId`/`now`. Update the function's comment block to say so.
- [ ] **Step 4:** Tests PASS (whole file).
- [ ] **Step 5: Commit** `feat(brief): provenance ignores trivial rewording (#228 pt2) and can take a new topic's origin from a note`

### Task 3: Note writer

**Files:**
- Create: `lib/api/note-writer.ts`
- Modify: `lib/agent/constants.ts` (add `NOTE_MAX_TOKENS = 1500`)
- Create: `lib/agent/note-prompt.ts` (`NOTE_SYSTEM_PROMPT` constant, `buildNoteUserContent(...)`)
- Test: `lib/api/__tests__/note-writer.test.ts`

**Interfaces:**
- Consumes: Task 1 (`addNote`, `isEmptyNote`, `BriefNote`), `upsertBrief` from `lib/api/briefs.ts`, `contestFor` + `topicKey`-style matching from `lib/api/brief-merge.ts`, `normalizeRisks` from `lib/brief/risks.ts`, `isArchivedSession`.
- Produces: `writeNoteForProject(db, projectId: string): Promise<{ note_id: string | null; covered: number; through: string }>`. Throws `Error('write_note_no_messages')` when there are no messages after the start point, `Error('write_note_max_tokens')`, `Error('write_note_no_tool_use')`.

Behaviour (the decisions the implementer cannot make alone):
- Start point: `projects.notes_through_at`, else live brief `updated_at`, else none. New messages = every message on the project (all sessions, `created_at` asc) with `created_at > start`. Continuity = the 6 messages immediately before the first new one, labelled as context.
- No brief doc → `upsertBrief(db, projectId, EMPTY_BRIEF, 'create')` first.
- User content: `<current_brief>` (JSON) + `<earlier_context>` (6 messages) + `<new_messages>`; role labels `User:` / `Assistant:` as `buildNextConvoUserContent` does today.
- `NOTE_SYSTEM_PROMPT` says: write only what is new relative to the current brief; never restate the brief; `decisions` = new or changed `{topic, decision}`, reuse the brief's exact topic text when revising; `risks_added` with `owner` maker/builder when clear; `risks_resolved` = exact text of brief risks the conversation settled; `lock_reversals` only when the maker explicitly confirmed reversing a **locked** decision (else describe the contradiction as a `risks_added` entry worded `conflicts with locked decision: <topic>`); `text` = at most a few sentences of anything else that matters; English always. Cache-mark the system block as `lib/api/briefs.ts` does today.
- `session_id` on the note = latest non-archived session among the covered messages.
- Lock reversals: for each, find a locked decision on the live brief whose `topicKey` matches; set `contested: { proposed, reason }` unless `contest_dismissed.proposed` normalises equal to `proposed` or `proposed` normalises equal to the decision; if anything changed, `upsertBrief(..., 'note')`. Unmatched reversals stay on the note only.
- Persist order: note doc (if not empty) → brief contest update (if any) → `projects.notes_through_at = <created_at of last new message>`. On any throw, `notes_through_at` is untouched.
- Log usage with `logAnthropicCall` route `brief.note`.

- [ ] **Step 1: Failing tests** (mock `@anthropic-ai/sdk` as `lib/api/__tests__/briefs.test.ts` does; in-memory Firestore fake):
  - `writes a note from messages after notes_through_at and advances it to the last message's created_at`
  - `starts after brief.updated_at when notes_through_at is absent`
  - `second run covers only newer messages` (run twice with a message added between)
  - `sends the 6 messages before the first new one as earlier context` (assert on the user content passed to `messages.create`)
  - `creates an empty brief when none exists`
  - `empty model output writes no note but advances notes_through_at`
  - `max_tokens throws write_note_max_tokens and does not advance notes_through_at`
  - `a lock reversal on a locked topic sets contested and writes a brief version with source note`
  - `a lock reversal matching contest_dismissed is ignored`
  - `throws write_note_no_messages when nothing is new`
  - `uses max_tokens 1500 and tool_choice write_note`
- [ ] **Step 2:** `npx vitest run lib/api/__tests__/note-writer.test.ts` → FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** PASS; `npm run type-check`.
- [ ] **Step 5: Commit** `feat(brief): note writer — per-conversation note instead of a whole-brief rewrite`

### Task 4: Cut over the cron and button; retire whole-brief regen

**Files:**
- Modify: `app/api/cron/notify/route.ts` (call `writeNoteForProject`; freshness check becomes `notes_through_at >= last_maker_message_at` → skip; for a project with no `notes_through_at`, fall back to today's `brief.updated_at >= lastMakerAt` skip; response key `notes_written` replaces `regenerated`)
- Create: `app/api/briefs/notes/route.ts` — `GET ?project_id=` (builder+) → `{ brief_id, brief_version, notes: BriefNote[] /* unfolded */ }` (`brief_version` 0 and `notes: []` when no brief); `POST {project_id}` (builder+) runs `writeNoteForProject`, clears the breaker fields like `clearBriefRegenFailures` does today; `write_note_no_messages` → 400 `{ error: 'Nothing new since the last note' }`.
- Delete: `app/api/briefs/generate/route.ts` and its test.
- Modify: `lib/api/briefs.ts` (delete `UPDATE_BRIEF_TOOL` and `regenerateBriefForProject`; keep `upsertBrief`); `lib/agent/constants.ts` (delete `BRIEF_MAX_TOKENS`); `lib/agent/brief-size.ts` (`BRIEF_CHAR_BUDGET = 20000`; `briefSizeWarning(content)` warns at ≥ 80% and over; delete `briefRegenCharBudget`/`CHARS_PER_TOKEN`; `regenFailureNotice` maps `write_note_max_tokens` to a new copy line, others to `regenFailed`)
- Modify: `lib/copy.ts` (reword `briefNearSizeLimit`/`briefOverSizeLimit` to talk about the 20,000-char curation budget, not automatic updates; `regenFailed`/`regenFailedTooLarge` → note wording, e.g. "The note from the last conversation failed on <day>"; `detailsHint` → `'brief · history · write note · attachments'`; `historyEmpty` drops "regen")
- Modify: `app/api/projects/route.ts` DELETE (also delete each brief's `notes` subcollection, next to the `versions` loop)
- Modify: `lib/api/brief-regen-gate.ts` comments only (breaker now guards the note writer)
- Tests: `app/api/cron/notify/__tests__/notify.test.ts`, `app/api/briefs/notes/__tests__/route.test.ts`, `lib/agent/__tests__/brief-size.test.ts`, `lib/api/__tests__/briefs.test.ts` (drop regen tests, keep `upsertBrief`), `app/api/projects/__tests__/update-delete-project.test.ts`

**Interfaces:**
- Consumes: Task 3 `writeNoteForProject`; Task 1 `listUnfoldedNotes`.
- Produces: `GET/POST /api/briefs/notes` as above; `BRIEF_CHAR_BUDGET` export.

- [ ] **Step 1: Failing tests:**
  - notify: `calls writeNoteForProject for an idle project`, `skips when notes_through_at >= last_maker_message_at`, `breaker still holds after 3 failures` (existing breaker tests re-pointed), `records write_note_max_tokens in brief_regen_last_error`
  - notes route: `GET returns unfolded notes and the live brief version`, `GET returns version 0 and [] with no brief`, `POST 403 for a maker`, `POST 400 when nothing is new`, `POST clears breaker fields on success`
  - brief-size: `warns at 16000 chars`, `over-budget line above 20000`, `null below 16000`
  - project delete: `deletes the notes subcollection`
- [ ] **Step 2:** run those files → FAIL.
- [ ] **Step 3:** Implement; `grep -rn "regenerateBriefForProject\|BRIEF_MAX_TOKENS\|briefs/generate" app lib components` must return nothing.
- [ ] **Step 4:** `npm test` all green.
- [ ] **Step 5: Commit** `feat(brief): cron and builder write notes; whole-brief regen and BRIEF_MAX_TOKENS removed`

### Task 5: Sam reads the unfolded notes

**Files:**
- Modify: `lib/agent/system-prompt.ts` (input `unfoldedNotes?: BriefNote[]`; render right after `## Current brief`, inside the **stable** parts)
- Modify: `app/api/chat/route.ts`, `app/api/chat/kickoff/route.ts` (after loading the brief snapshot, `listUnfoldedNotes(db, briefSnap.docs[0].id)` inside the existing `Promise.all`; `[]` with no brief)
- Test: `lib/agent/__tests__/system-prompt.test.ts`; update `lib/agent/__tests__/__snapshots__` only if a snapshot covers this

**Interfaces:**
- Consumes: Task 1 `BriefNote`, `listUnfoldedNotes`.
- Produces: `renderUnfoldedNotesBlock(notes: BriefNote[]): string | null` (exported for tests).

Block shape:
```
## New since the brief was last curated

These notes were written after each conversation and are not yet folded into the brief above. Treat them as part of what we know; where a note and the brief disagree, the note is newer.

### Conversation of Oct 28
<text>
Decisions: - <topic>: <decision>
New open questions: - <text> (maker)
Settled: - <text>
Maker asked to reverse a locked decision: - <topic> → <proposed>
```
Day = `America/Los_Angeles`, `month: 'short', day: 'numeric'`. Omit empty sub-lists.

- [ ] **Step 1: Failing tests:** `renders notes oldest first under the brief, in the stable part`, `omits the block when there are no notes`, `omits empty sub-lists`, `heads each note with its Pacific day` (a note at `2026-10-29T05:00:00Z` reads `Oct 28`), `the stable part is byte-identical for the same notes across two calls`.
- [ ] **Step 2:** `npx vitest run lib/agent/__tests__/system-prompt.test.ts` → FAIL.
- [ ] **Step 3:** Implement and wire both routes.
- [ ] **Step 4:** PASS; route tests for chat/kickoff still pass (`npm test`).
- [ ] **Step 5: Commit** `feat(agent): Sam reads the notes not yet folded into the brief`

### Task 6: The prep curates, with a guide and a stamp

**Files:**
- Modify: `lib/agent/next-convo-prompt.ts` (rewrite `NEXT_CONVO_SYSTEM_PROMPT` as the curation prompt; `buildNextConvoUserContent` input drops `conversationHistory`, gains `notes: BriefNote[]` and `stamp: PrepStamp`; `buildNextConvoPrompt` keeps its name)
- Create: `lib/agent/curation-guide.ts` (`BRIEF_CURATION_GUIDE` string) and `docs/brief-curation-guide.md` (same text under a one-line header saying the canonical copy is the TS constant)
- Modify: `lib/api/import-payload.ts` (`parseNextConvoPayload` extracts `_prep_stamp` via `parsePrepStamp`, deletes the key from the object in both modes, returns it as `stamp: PrepStamp | null` on the value)
- Modify: `components/builder/BuilderProjectView.tsx` `handleCopyPayload` (fetch `GET /api/briefs/notes`, no longer fetch sessions/messages; pass notes + `{ brief_version, note_ids }`)
- Tests: `lib/agent/__tests__/next-convo-prompt.test.ts`, `lib/agent/__tests__/prep-prompts-snapshot.test.ts` (update snapshot deliberately), `lib/api/__tests__/import-payload.test.ts`, new `lib/agent/__tests__/curation-guide.test.ts`

**Interfaces:**
- Consumes: Task 1 `BriefNote`, `PrepStamp`, `parsePrepStamp`; Task 4 `GET /api/briefs/notes`, `BRIEF_CHAR_BUDGET`.
- Produces: `NextConvoPayload` gains `stamp: PrepStamp | null` (both `multi` and `brief-only` modes).

Prompt content the implementer must include (wording is theirs, facts are fixed):
- Task: rewrite the brief whole, folding in every note; terse; free to drop and merge history; stay under `BRIEF_CHAR_BUDGET` chars of brief JSON (state the number and the current size).
- The JSON schema as today, plus `"_prep_stamp"` with the exact values from the user content, to be copied back unchanged as a top-level key.
- Readers are agents (Sam, the comms agent, Claude Code); the brief stays in English because those agents read it and makers' words get translated.
- Locked decisions verbatim with `"locked": true`; a note's lock reversal is already on the brief as `contested` and must be carried as is.
- A revised decision keeps its topic text exactly so provenance matches.
- Every open risk carries `owner` (`maker` | `builder`).
- Keep the existing rules for welcome/nudge/mode fields and the discuss-first questions.
- `BRIEF_CURATION_GUIDE` embedded in full.
- User content blocks: `<project>`, `<current_brief>` (with `version`), `<notes>` (each note with id, Pacific day, its fields), `<prep_stamp>` (the JSON to copy back).

- [ ] **Step 1: Failing tests:**
  - `prep carries the brief, every unfolded note and the stamp JSON`
  - `prep no longer carries conversation history`
  - `prep states the 20000 char budget and the current brief size`
  - `prep says the readers are agents, not the builder`
  - `curation guide in docs matches BRIEF_CURATION_GUIDE` (read `docs/brief-curation-guide.md` with `fs`, assert it contains the constant verbatim)
  - `parseNextConvoPayload returns the stamp and strips _prep_stamp from the brief` (both modes); `returns stamp null when absent or malformed`
- [ ] **Step 2:** run those files → FAIL.
- [ ] **Step 3:** Implement; update the snapshot with `-u` only after reading the new prompt once end to end.
- [ ] **Step 4:** PASS; `npm run type-check`.
- [ ] **Step 5: Commit** `feat(prep): the comms agent curates from brief + notes, with a size budget, a guide and a prep stamp`

### Task 7: Paste guard, folding, and the Brief tab

**Files:**
- Modify: `app/api/briefs/route.ts` PUT (read `prep_stamp`, `force`; guard; fold; risk owners; provenance origin from notes)
- Modify: `lib/query/hooks.ts` `useUpdateBrief` (accept `prep_stamp?: PrepStamp`, `force?: boolean`; on 409 throw a `StalePrepError` carrying the body)
- Modify: `components/builder/BuilderProjectView.tsx` (import path passes `stamp`; on `StalePrepError` show the missed notes and a **Save anyway** button that resends with `force: true`; no-stamp import adds the warning line; "Update brief from conversation" modal/button becomes **Write note now** calling `POST /api/briefs/notes`; a read-only "New since last curation (N)" list of unfolded notes under the brief, from `GET /api/briefs/notes`)
- Modify: `lib/copy.ts` (`pasteNotFromPrep`, `stalePrepTitle`, `stalePrepNote(count, liveVersion, prepVersion)`, `saveAnyway`, `writeNoteNow`, `writeNoteConfirm`, `newSinceCuration(n)`)
- Tests: `app/api/briefs/__tests__/route.test.ts` (extend), `components/builder/__tests__/FerryDesk.test.tsx` or a new BriefTab test if the 409 UI lives outside FerryDesk

**Interfaces:**
- Consumes: Task 1 (`listUnfoldedNotes`, `foldNotes`, `parsePrepStamp`), Task 2 (`originByTopic`), `carryRiskOwners`.
- Produces: PUT body `{ project_id, content, source?, prep_stamp?, force? }`; 409 body per Global Constraints.

Server rules:
- Stamp only matters when `source` is `paste` (not `restore`).
- No stamp → save as today, fold nothing.
- Stamp → `unlisted` = unfolded notes whose id is not in `note_ids`; stale = `unlisted.length > 0 || liveVersion > stamp.brief_version`. Stale and not `force` → 409, nothing written. Otherwise save, then `foldNotes(note_ids)` (listed ones only).
- `originByTopic` from the listed notes' `decisions` (later note wins), `session_id` and `created_at`.
- Risk owners: `content.open_risks = carryRiskOwners(prev.open_risks plus listed notes' risks_added, content.open_risks)` (works for any paste, stamp or not, prev only when no stamp).
- Response adds `folded: string[]` and `size_warning: string | null` (`briefSizeWarning`).

- [ ] **Step 1: Failing route tests:**
  - `no stamp saves and folds nothing`
  - `stamp listing every unfolded note at the live version saves and folds them`
  - `409 when an unfolded note is not in the stamp` (body lists it; nothing written)
  - `409 when the live version is newer than the stamp`
  - `force saves, folds only listed notes, leaves the unlisted one unfolded`
  - `a new topic with no provenance takes its origin from the note that introduced it`
  - `an ownerless risk gets its owner from a folded note's risks_added`
  - `restore ignores any stamp`
- [ ] **Step 2:** `npx vitest run app/api/briefs/__tests__/route.test.ts` → FAIL.
- [ ] **Step 3:** Implement server, hook and UI.
- [ ] **Step 4:** UI test: `a 409 shows the missed notes and Save anyway resends with force`; `npm test`, `npm run build`, `npm run type-check`, `npm run lint` all clean.
- [ ] **Step 5: Commit** `feat(brief): paste guard folds stamped notes, 409 on a stale prep, Write note now`

### Task 8: Docs and preview e2e

**Files:**
- Create: `scripts/e2e-229-notes.mjs` (follow `scripts/e2e-214-stale-greeting.mjs`; `launchLoggedIn()`; API calls with the page's token)
- Modify: `CLAUDE.md` (Data Model `briefs` entry: notes subcollection, `source: 'note'`; `projects.notes_through_at`; Agent Behavior: Sam reads unfolded notes; brief-regen runbook now about the note writer; remove the F4FC `BRIEF_MAX_TOKENS` headroom paragraph's "next thing to build" line; Next Steps: #229 built on branch)
- Modify: `docs/changelog.md` (prepend entry)
- Modify: `scripts/inspect-brief-health.mjs`, `scripts/stop-regen-loop.mjs` (comments and printed labels say "note writer"; no logic change unless they import removed code)

e2e flow on preview: create a throwaway brief via `POST /api/projects` with a small `brief`; post one user message into its session through `/api/chat` (or seed via the existing fixture helper if chat as admin is refused); `POST /api/briefs/notes` → 200 and a note; `GET /api/briefs/notes` → 1 unfolded; PUT with a stamp missing that note → 409; PUT with `force` → 200, note still unfolded; PUT with a full stamp at the new live version → 200, note folded; `GET` → 0 unfolded; delete the brief. PASS/FAIL per step like the 214 script.

- [ ] **Step 1:** Write the script; `node --check scripts/e2e-229-notes.mjs`.
- [ ] **Step 2:** Docs edits.
- [ ] **Step 3:** `npm test`, `npm run build`, `npm run type-check`, `npm run lint`.
- [ ] **Step 4: Commit** `docs(brief): notes, curation prep and paste guard; e2e-229 script`
- [ ] **Step 5:** Preview run is Nico's (needs `.ibuild4you-bypass` + `.test-admin-password`); controller prints the command.
