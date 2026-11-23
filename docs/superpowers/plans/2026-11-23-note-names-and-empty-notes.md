# Note names and empty notes (#276) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A brief note is headed by what it was made from ("Conversation of Nov 21", "Email of Nov 21", "Conversation and email of Nov 21"), and a stretch with nothing relevant to the brief writes no visible note.

**Architecture:** The note writer stamps a new `made_from` field on each note, from the window it read (code, never the model). One pure helper, `noteSource()`, reads that field (with a fallback for notes written before it) and both headings use it: the Brief tab (`copy.brief.noteHeading`) and Sam's system prompt (`renderUnfoldedNotesBlock`). For the empty case, nothing is stored: the writer already advances `projects.notes_through_at` without a note when every field is empty (`lib/api/note-writer.ts:559-584`). What is missing is a reliable way for the model to say "nothing relevant": a `nothing_new` boolean on the `write_note` tool, which lets code drop a text-only "nothing relevant was said" note.

**Tech Stack:** Next.js App Router, Firestore (Admin SDK), Anthropic SDK (tool use), vitest + Testing Library.

**Spec:** GitHub issue #276 (`gh issue view 276`), agreed with Nico 2026-11-21. No comments on the issue as of 2026-11-23.

## What the code does today (read before starting)

- The cursor is `projects.notes_through_at`, not the notes. The writer starts after it (`lib/api/note-writer.ts:388-398`, `450`) and the notify cron skips a project when `notes_through_at >= activity` (`app/api/cron/notify/route.ts:84-89`). Nothing reads the notes to decide whether a stretch was processed.
- An all-empty model result already writes no note and still moves the cursor: `isEmptyNote(body)` (`lib/api/brief-notes.ts:70-81`) guards `addNote` at `lib/api/note-writer.ts:560`, and `notes_through_at` is updated at `584` either way. A window of fully seen emails makes no model call and moves the cursor (`462-465`). Test: `lib/api/__tests__/note-writer.test.ts:390` ("empty model output writes no note but advances notes_through_at").
- The smoke note of 2026-11-21 was not empty: the model wrote text saying nothing relevant was said, so `isEmptyNote` was false. The prompt already says "If nothing new came up, leave every field empty" (`lib/agent/note-prompt.ts:127`), but the email rule at `note-prompt.ts:147` ("Say in text that it came by email, who said it and the date") pulls the other way.
- Headings: `copy.brief.noteHeading` (`lib/copy.ts:336`) rendered at `components/builder/BriefNotes.tsx:98`; `### Conversation of …` built at `lib/agent/system-prompt.ts:87`. The prep's `<note id day>` (`lib/agent/next-convo-prompt.ts:117-118`) and the stale-prep line "Note from {day}" (`lib/copy.ts:305`) carry no heading word and are not changed by this plan.
- A note today records email involvement in `email_sources` (only emails that still had text, `note-writer.ts:573`), but nothing records chat involvement. `session_id` is null for an email-only window, and also when every covered chat message sits in an archived session (`note-writer.ts:467-475`), so it cannot tell "email only" from "both" reliably. Hence the new field.

## Decision: how "no visible note" is represented

Nothing is stored. The stretch is marked read by `notes_through_at` alone, as the empty path already does. No hidden note document, no new flag on the project. Every consumer of notes (Brief tab list, Sam's prompt block, the prep, the stale-prep check in `PUT /api/briefs`, fold on paste) simply never sees one. The cron and the writer never reread the stretch because they read only the cursor. Each empty run logs one line, `{"event":"brief.note_empty", project_id, covered}`, so production can confirm it (the name is chosen to match the existing `brief.note` log filter; inferred, not a rule in the code).

The model signals "nothing relevant" with a required boolean `nothing_new` on `write_note`. Code honours it only when the model also returned no decisions, no risks added or settled and no lock reversals; then it drops the text. Structured content always wins over the flag, so a wrong `true` can only cost a few sentences of text, never a decision or risk. A note that has a code-stamped 👎 (`thumbs_down`) is still written, with empty text, because `isEmptyNote` counts `thumbs_down`. This is a recommendation: the issue left the choice open (Open question 1).

## Global Constraints

- Heading wording, verbatim from the issue: chat only "Conversation of Nov 21"; email only "Email of Nov 21"; both "Conversation and email of Nov 21". The day stays the note's `created_at` in Pacific, formatted `en-US` `{ month: 'short', day: 'numeric' }` as today.
- Builder-facing text lives in `lib/copy.ts` (`copy.brief`). It has no French twin (French is only in `lib/copy-public.ts` / `lib/copy-maker.ts`). The model-facing heading in `lib/agent/system-prompt.ts` stays in that file, as now.
- `made_from` is stamped by code from the window, never by the model, like `email_ids` and `email_sources`.
- `renderUnfoldedNotesBlock` is in the cached stable block: its output must stay byte-identical for the same notes (no clock reads).
- Changing `WRITE_NOTE_TOOL` invalidates the note writer's prompt cache once (`note-writer.ts:71-72`). Accepted for this change; do not touch the schema anywhere else.
- In a worktree, run both `npm run build` and `npm run type-check` before claiming clean (CLAUDE.md). The build needs dummy `NEXT_PUBLIC_FIREBASE_*` values in a worktree (memory note).

## Review Focus

1. An old note with no `made_from` but with `email_sources` and a null `session_id` (the 2026-11-21 smoke note): must head "Email of …", not "Conversation of …". Pinned in Task 1.
2. A window with emails that had no text left (fully seen) plus chat: the note is "Conversation", not "Conversation and email", matching the "From email" line, which also lists only emails with text. Pinned in Task 2.
3. `nothing_new: true` returned alongside a real decision or risk: the note must be written whole, text included. Pinned in Task 5.
4. `nothing_new: true` on a stretch with a 👎: the note is still written, text empty, 👎 kept. Pinned in Task 5.
5. A run of empty stretches must not loop: after an empty run, `notes_through_at` equals the last item's time and a second call throws `write_note_no_messages` with no model call. Pinned in Task 5.

---

### Task 1: `noteSource()` helper and the `made_from` field

**Files:**
- Modify: `lib/types/index.ts:456-477` (interface `BriefNote`)
- Create: `lib/brief/note-source.ts`
- Test: `lib/brief/__tests__/note-source.test.ts` (copy the import and `describe` style of `lib/brief/__tests__/risks.test.ts`)

**Interfaces:**
- Produces: `export type BriefNoteSource = 'chat' | 'email' | 'both'` in `lib/types/index.ts`; optional `made_from?: BriefNoteSource` on `BriefNote`, with a comment: stamped by code, absent on notes written before #276.
- Produces: `export function noteSource(n: Pick<BriefNote, 'made_from' | 'email_sources' | 'session_id'>): BriefNoteSource` in `lib/brief/note-source.ts`. Rule: `made_from` when present; else, when `email_sources` has at least one entry, `'both'` if `session_id` is non-null and `'email'` if null; else `'chat'`. The file comment says the fallback is for notes written before the field existed and can misread "both" as "email" when the chat was in an archived session.

- [ ] **Step 1: Write the failing test.** Cases, each `expect(noteSource(...)).toBe(...)`:
  1. `{ made_from: 'email', session_id: 's1', email_sources: [] }` → `'email'` (the field wins).
  2. `{ session_id: null, email_sources: [one source] }` → `'email'`.
  3. `{ session_id: 's1', email_sources: [one source] }` → `'both'`.
  4. `{ session_id: 's1' }` (no email fields) → `'chat'`.
  5. `{ session_id: null, email_sources: [] }` → `'chat'`.
- [ ] **Step 2: Run** `npx vitest run lib/brief/__tests__/note-source.test.ts`. Expected: FAIL, module not found.
- [ ] **Step 3: Implement** the type, the field and `noteSource` as described.
- [ ] **Step 4: Run** the same command. Expected: PASS. Then `npm run type-check`.
- [ ] **Step 5: Commit** `git add lib/types/index.ts lib/brief/note-source.ts lib/brief/__tests__/note-source.test.ts && git commit -m "Notes: noteSource() and the made_from field (#276)"`

### Task 2: The note writer stamps `made_from`

**Files:**
- Modify: `lib/api/note-writer.ts:565-580` (the `note` object in `writeNoteForProject`)
- Test: `lib/api/__tests__/note-writer.test.ts` (add to the `describe('emails')` block at line 711; copy the setup of the tests at lines 768, 810 and 1470, which use `seedProject`, `seedSession`, `seedMessage`, `seedEmail`, `noteResponse(someNote)` and `notes()`)

**Interfaces:**
- Consumes: `BriefNoteSource` from Task 1.
- Produces: every note written from now on carries `made_from`.

- [ ] **Step 1: Write the failing tests.**
  1. "stamps made_from email on a note from emails only": same seeding as the test at line 768; `expect(notes()[0].made_from).toBe('email')`.
  2. "stamps made_from both on a note from chat and email": same seeding as line 810; `toBe('both')`.
  3. "stamps made_from chat on a note from chat only": same seeding as line 1470; `toBe('chat')`.
  4. "an email with nothing new left does not count as email": seed a chat message and an email whose text is fully seen, so it has no text left (copy the fully-seen setup from the test that expects `{ note_id: null, covered: 1, through: '2026-11-19T11:00:00.000Z' }` at line 1026, then add a chat message after it in a session so the model is called); `expect(notes()[0].made_from).toBe('chat')` and `expect(notes()[0].email_sources).toEqual([])`.
- [ ] **Step 2: Run** `npx vitest run lib/api/__tests__/note-writer.test.ts -t made_from` (and `-t "nothing new left"`). Expected: FAIL, `made_from` undefined.
- [ ] **Step 3: Implement.** In the `note` object, add `made_from` computed from the window, next to `session_id`: chat is `newMessages.length > 0` (`newMessages` at line 456, any role); email is `newEmails.some(hasText)` (`newEmails` at 457, `hasText` at 188). Both → `'both'`, email alone → `'email'`, else `'chat'`. Comment: stamped by code from the window, never the model; an email with no text left does not count, the same rule as `email_sources`.
- [ ] **Step 4: Run** `npx vitest run lib/api/__tests__/note-writer.test.ts`. Expected: all PASS (existing `toMatchObject` tests are unaffected by an added field).
- [ ] **Step 5: Commit** `git commit -am "Note writer: stamp made_from from the window (#276)"`

### Task 3: Brief tab heading

**Files:**
- Modify: `lib/copy.ts:336` (`copy.brief.noteHeading`)
- Modify: `components/builder/BriefNotes.tsx:98`
- Test: `components/builder/__tests__/BriefNotes.test.tsx` (in `describe('UnfoldedNotesList')`, reuse the `note` fixture at line 50 and the open-the-list click at line 70)

**Interfaces:**
- Consumes: `noteSource` (Task 1), `noteDay` (`BriefNotes.tsx:22`).
- Produces: `noteHeading: (day: string, from: BriefNoteSource) => string` returning exactly `Conversation of ${day}`, `Email of ${day}` or `Conversation and email of ${day}`.

- [ ] **Step 1: Write the failing tests.**
  1. "heads an email-only note Email of": `{ ...note, session_id: null, made_from: 'email' }` → `screen.getByText('Email of Oct 28')`.
  2. "heads a chat and email note Conversation and email of": `made_from: 'both'` → `getByText('Conversation and email of Oct 28')`.
  3. "heads an older email-only note by its email sources": `{ ...note, session_id: null, email_sources: [{ from_name: 'Bill Duris', from_role: 'maker', received_at: '2026-10-28T18:00:00.000Z' }] }` with no `made_from` → `getByText('Email of Oct 28')`.
  The existing test at line 71 (`'Conversation of Oct 28'`, fixture with `session_id: 's1'` and no email fields) must keep passing unchanged.
- [ ] **Step 2: Run** `npx vitest run components/builder/__tests__/BriefNotes.test.tsx`. Expected: the three new tests FAIL.
- [ ] **Step 3: Implement.** Change `noteHeading` to take `from` and pick one of the three strings (a plain conditional or a small object map; keep the comment that the wording follows what the note was made from, #276). At line 98 call `c.noteHeading(noteDay(n.created_at), noteSource(n))`.
- [ ] **Step 4: Run** the same command, then `npm run type-check` (catches any other caller of `noteHeading`; there is none today besides line 98). Expected: PASS.
- [ ] **Step 5: Commit** `git commit -am "Brief tab: head a note by what it was made from (#276)"`

### Task 4: Sam's system prompt heading

**Files:**
- Modify: `lib/agent/system-prompt.ts:87` (`renderUnfoldedNotesBlock`)
- Test: `lib/agent/__tests__/system-prompt.test.ts` (next to "heads each note with its Pacific day" at line 904; reuse the `note()` fixture at line 829, `minimalInput` and `brief`)

**Interfaces:**
- Consumes: `noteSource` (Task 1).

- [ ] **Step 1: Write the failing tests.**
  1. `note({ created_at: '2026-10-29T05:00:00Z', made_from: 'email' })` → `stable` contains `'### Email of Oct 28'` and not `'### Conversation of Oct 28'`.
  2. `made_from: 'both'` → contains `'### Conversation and email of Oct 28'`.
  The test at line 910 (`'### Conversation of Oct 28'`) and the byte-identical test at line 918 must keep passing.
- [ ] **Step 2: Run** `npx vitest run lib/agent/__tests__/system-prompt.test.ts`. Expected: two FAIL.
- [ ] **Step 3: Implement.** In `renderUnfoldedNotesBlock`, pick the word from `noteSource(n)`: `'Conversation'`, `'Email'` or `'Conversation and email'`, then `### ${word} of ${day}`. Keep it a pure function of the note.
- [ ] **Step 4: Run** the same command. Expected: PASS.
- [ ] **Step 5: Commit** `git commit -am "Sam's prompt: head a note by what it was made from (#276)"`

### Task 5: A stretch with nothing relevant writes no note

Do this task only after Nico answers Open question 1. If he chooses prompt only, skip Steps 1.1 to 1.4 and the schema and `coerceNote` parts of Step 3, and keep the prompt wording, the log line and test 1.5.

**Files:**
- Modify: `lib/api/note-writer.ts:73-123` (`WRITE_NOTE_TOOL`), `:320-350` (`coerceNote`), `:559-582` (the `isEmptyNote` branch: add the log)
- Modify: `lib/agent/note-prompt.ts:127`, `:136`, `:147` (`NOTE_SYSTEM_PROMPT`)
- Test: `lib/api/__tests__/note-writer.test.ts` (next to the test at line 390; copy its seeding; for the 👎 case copy the `rating: 'down'` seeding in `describe('thumbs down')` at line 651; for the schema check copy the tool-schema read at lines 217-228)
- Test: `lib/agent/__tests__/note-prompt.test.ts` (in or next to `describe('NOTE_SYSTEM_PROMPT on emails')` at line 294)

**Interfaces:**
- Produces: `write_note` input has a required `nothing_new: boolean`. It is never stored: `coerceNote` keeps returning only `text, decisions, risks_added, risks_resolved, lock_reversals`.

- [ ] **Step 1: Write the failing tests** in `note-writer.test.ts`:
  1. "nothing_new with only text writes no note and advances notes_through_at": model returns `{ text: 'Nothing relevant to the brief was said.', nothing_new: true, decisions: [], risks_added: [], risks_resolved: [], lock_reversals: [] }` → `res.note_id` null, `notes()` length 0, `notes_through_at` is the message's `created_at`.
  2. "nothing_new is ignored when the model also returned a decision": `{ ...someNote, nothing_new: true }` → one note, `text` is `someNote.text`, decisions kept.
  3. "nothing_new keeps a note that carries a 👎, with empty text": seed an agent message in the window with `rating: 'down'`; model returns test 1's input → one note, `text` `''`, `thumbs_down` length 1.
  4. "asks the model for nothing_new": `input_schema.properties.nothing_new` is `{ type: 'boolean' }` and `input_schema.required` contains `'nothing_new'`.
  5. "an empty run logs brief.note_empty and the next run reads nothing": `vi.spyOn(console, 'log')`; after test 1's run, one call's argument parses as JSON to `{ event: 'brief.note_empty', project_id: 'p1', covered: 1 }`; a second `writeNoteForProject(db, 'p1')` rejects with `write_note_no_messages` and `mockMessagesCreate` was called once in total.
  In `note-prompt.test.ts`:
  6. `NOTE_SYSTEM_PROMPT` contains `nothing_new`, contains `Never write that nothing new or relevant came up`, and matches `/When you record something from an email, say in text that it came by email/`.
- [ ] **Step 2: Run** `npx vitest run lib/api/__tests__/note-writer.test.ts lib/agent/__tests__/note-prompt.test.ts`. Expected: the six new tests FAIL; the rest PASS.
- [ ] **Step 3: Implement.**
  - `WRITE_NOTE_TOOL`: add `nothing_new: { type: 'boolean' }` to `properties` and `'nothing_new'` to `required`. Add to the comment above it that the cache cost of this change was accepted for #276.
  - `coerceNote`: after building the fields, when `raw.nothing_new === true` and `decisions`, `risks_added`, `risks_resolved` and `lock_reversals` are all empty, return `text: ''`. Comment: the flag can only drop text, never structured content.
  - In `writeNoteForProject`, when `isEmptyNote(body)` is true (line 560), log `console.log(JSON.stringify({ event: 'brief.note_empty', project_id: projectId, covered }))` (same shape as `email_in_accepted` in `app/api/webhooks/resend/inbound/route.ts:304-311`; ids and counts only, never text). Leave the order note → `notes_through_at` → contest as it is.
  - `NOTE_SYSTEM_PROMPT`: line 127 becomes "Write only what is new relative to the current brief and the notes since curation. Never restate either. If nothing new came up, set nothing_new to true and leave every other field empty. Greetings, thanks, scheduling and anything else that does not bear on the brief count as nothing new. Otherwise set nothing_new to false." Line 136 adds: "Never write that nothing new or relevant came up: set nothing_new instead." Line 147's last sentence becomes "When you record something from an email, say in text that it came by email, who said it and the date."
- [ ] **Step 4: Run** the Step 2 command. Expected: all PASS, including the existing test at line 390 (no `nothing_new` in its input, still no note).
- [ ] **Step 5: Commit** `git commit -am "Note writer: a stretch with nothing relevant writes no note (#276)"`

### Task 6: Docs

**Files:**
- Modify: `docs/data-model.md:13` (briefs bullet) and `:19` (project_emails bullet: the list of fields a note that covered emails carries)
- Modify: `docs/runbooks.md:7` (note-writer cost runaway paragraph)
- Modify: `docs/changelog.md` (prepend an entry, newest first)
- Modify: `CLAUDE.md`, the "Note names and empty notes (#276…)" line under **Watch**

- [ ] **Step 1:** `data-model.md`: a note carries `made_from` (`chat` | `email` | `both`, stamped by code; absent before #276, read through `noteSource` in `lib/brief/note-source.ts`). A stretch with nothing relevant writes no note; only `notes_through_at` moves.
- [ ] **Step 2:** `runbooks.md:7`: one sentence, an empty stretch makes one model call, writes no note, moves `notes_through_at` and logs `brief.note_empty`; a project whose `api_usage` shows `brief.note` at the cron interval with no new notes is a runaway, not empty stretches.
- [ ] **Step 3:** `changelog.md` entry dated the merge day, and the CLAUDE.md Watch line rewritten to what to watch (Verification, production check).
- [ ] **Step 4: Commit** `git commit -am "docs: note names and empty notes (#276)"`

### Task 7 (only if Nico says yes to Open question 3): "Write note now" says when no note was written

**Files:** `lib/copy.ts:314` area (new `copy.brief.writeNoteNothingRelevant`), `components/builder/BuilderProjectView.tsx:568-590` (`handleGenerate`), a test next to the existing BuilderProjectView tests in `components/builder/__tests__/`.

- [ ] Test first: a 200 response `{ note_id: null, covered: 1, through: '…' }` shows the new copy as a notice and does not close silently. Then read `note_id` from the response in `handleGenerate`. Wording is Nico's (Open question 3).

## Risks

- The model may still write a "nothing relevant" sentence with `nothing_new: false`. Unit tests mock the model, so only the production check below shows whether the prompt and flag work. If it recurs, the next step is a stronger prompt example, not a text match in code.
- A wrong `nothing_new: true` drops a few sentences of text when the model returned no structured fields. Bounded by the rule in Task 5; the original emails stay stored and readable from the panel.
- With no note stored, nothing records which emails an empty stretch covered (`email_ids` lives only on notes). Nothing reads it today; worth knowing if a later feature wants "emails noted" per email.
- The tool schema change costs one cache write on the note writer's next call. Negligible.
- Old notes get a new heading by fallback; a "both" note whose chat was in an archived session reads "Email of …". Rare, and these notes fold away at the next paste.

## Verification

1. `npm test` (all of vitest), `npm run lint`, `npm run build`, `npm run type-check`. In a worktree, build and type-check both, build first.
2. Preview test: warranted for Task 5 only, chat path. Push the branch to preview (`git push origin <branch>:preview --force`), on https://preview.ibuild4you.com open a throwaway project, send one chat message of pleasantries as the test admin, then Brief tab "Write note now". Pass: no new note under "New since last curation"; fail: a note saying nothing relevant was said. Then a substantive message and "Write note now". Pass: a note headed "Conversation of <today>". Email cannot be tested on preview (inbound mail goes to production only).
3. Production check after merge, on the smoke project "Email-in smoke test" (address `email-in-smoke-test-3axj@inbox.ibuild4you.com`): a pleasantries email from the maker's Yahoo address, wait 15 minutes; pass is no new note and a `brief.note_empty` line in `vercel logs -e production --since 1h -n 2000 --json`. Then a substantive email; pass is a note headed "Email of <today>".

## Open questions for Nico

1. Empty-note signal: add a required `nothing_new` flag to the note tool (recommended; code can then drop a text-only "nothing relevant" note deterministically, but never a decision or risk), or tighten the prompt only and rely on the existing all-empty path?
2. Does a stretch where only Sam or a Builder wrote in chat (no maker turn), plus an email, count as "Conversation and email"? The plan counts any chat message, of any role, as conversation (inferred, not in the issue).
3. Should "Write note now" say "nothing relevant, no note written" when it writes none? Today it closes silently, the same as for an all-empty result (Task 7, off unless you say yes).
4. Should the prep's `<note>` and the stale-prep line "Note from {day}" also name the source? The issue names only the two headings; the plan leaves both as they are.

## Rulings (Nico, 2026-11-23) — these settle the open questions above

1. The note tool gets the `nothing_new` flag. Code may drop a text-only note, never one carrying a decision or a risk.
2. Any chat message in the stretch counts as conversation, whoever wrote it. Chat plus email is "Conversation and email of …".
3. "Write note now" says when no note was written. Task 7 is part of the build, not optional.
4. The prep's notes and its "Note from {day}" line do not name the source in this PR. Out of scope.
