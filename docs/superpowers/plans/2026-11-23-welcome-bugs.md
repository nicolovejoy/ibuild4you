# Welcome bugs (relay efficiency, Project 5) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A conversation never shows two welcomes, and a builder's welcome for the round always reaches the conversation the maker is in.

**Architecture:** One pure rule for "has the maker answered this conversation's opening", in a new `lib/sessions/maker-replied.ts`. The import, `POST /api/sessions` and the builder's Conversations header all call it. A welcome posted by an import is tagged `kind: 'welcome'`, so the rule can find it from the messages alone. When an import posts a new welcome into a conversation where the maker has not answered, it replaces the unanswered opening instead of adding to it (ruling 1).

**Tech Stack:** Next.js App Router, Firestore (Admin SDK), vitest + Testing Library.

**Spec:** `docs/superpowers/specs/2026-11-15-relay-efficiency-design.md`, "Project 5". The payload status half shipped as the Next round panel (PR #273) and is out of scope, as is "whether the paste is current" on the Brief tab.

**Not in scope:** the "new welcome, old directives" part of the first report. The spec found no split write (`apply-import.ts` re-copies config and posts the welcome in one batch, today lines 58-86) and named two payload causes. Confirming either needs the payload that was pasted. Nothing in this plan touches it.

## What the code does today (read before starting)

Checked on main at `c0dda8a`. No commit has touched `lib/sessions`, `app/api/sessions/route.ts` or the kickoff since the spec was written (2026-11-15). The spec's line numbers for `BuilderProjectView.tsx` are stale (the file shrank); the current ones are below.

### Bug 1: two welcomes in one conversation. Confirmed.

The spec says: "Two welcomes is real. An import into an open conversation removes only the canned 'nothing queued' greeting (`apply-import.ts:59`). A welcome posted when the conversation was created stays, and the new one is added after it."

Still true:

1. A conversation opens with a welcome posted at creation: `app/api/sessions/route.ts:153-164` (Start conversation N), `app/api/projects/route.ts:611-619` (the first conversation, on project create), `app/api/projects/share/route.ts:144-188` (on share, when the conversation is empty). None of these messages has a `kind`.
2. The builder imports a payload with a new `welcome_message` before the maker answers. `PATCH /api/projects` calls `applyImportToOpenSession` when `payload_pasted_at` is in the body (`app/api/projects/route.ts:257-266`).
3. `lib/sessions/apply-import.ts:35-40`: no maker message, so it applies.
4. `apply-import.ts:45-49`: `welcomeToPost` with `isFirstSession: false`. The new text differs from the session's own snapshot, so it is "new".
5. `apply-import.ts:51-56`: the "already posted" check compares the new text with existing agent messages. The old welcome has different text, so it does not match.
6. `apply-import.ts:58-59`: only `kind === 'unqueued_greeting'` messages are deleted. `apply-import.ts:76-84`: the new welcome is added. The maker sees the old welcome, then the new one.

The same happens on a first conversation (default copy or a generated welcome, then the first payload's welcome), and when a kickoff model greeting sits in an empty return conversation before the import. No test covers it: `lib/sessions/__tests__/apply-import.test.ts` has no case with an agent message other than the canned greeting.

### Bug 2: a welcome stranded in a closed conversation. Confirmed.

The spec says: "The import counts only maker messages after the last canned greeting (`apply-import.ts:35-39`); the header and the new-session route count any maker message (`BuilderProjectView.tsx:1104`, `app/api/sessions/route.ts:132-139`). Sequence: the maker spoke, the kickoff posted the canned greeting, the builder imports. The import posts the new welcome into that old conversation; the header then offers 'start'; the new conversation treats the welcome as used and opens empty, with the welcome stranded in the closed one."

Still true, step by step:

1. The maker spoke in conversation N. The builder copied the prep (`prep_copied_at`). The maker came back and the kickoff posted the canned greeting into conversation N (`app/api/chat/kickoff/route.ts:232` with `isUnqueuedReturn`, `lib/sessions/queued.ts:31-34`).
2. The builder imports with a new welcome. `apply-import.ts:33-40` counts only maker messages after the last greeting, so it applies: deletes the greeting, re-snapshots `welcome_message` onto conversation N, posts the welcome there (`:58-86`).
3. The import hands the builder to the Conversations tab (`BuilderProjectView.tsx:305`). The header counts any maker message: `BuilderProjectView.tsx:1202` (`activeMessages?.some((m) => m.role === 'user')`), passed as `makerRepliedInActive` at `:1212` into `getDispatchState` (`lib/builder/conversations-view.ts:66`). The maker spoke earlier, so the header shows "Start conversation N+1", and the Start modal opens by itself after a paste (`BuilderProjectView.tsx:1787-1796`).
4. The builder clicks Start. `app/api/sessions/route.ts:131-140` treats conversation N as "used" because it has any `role == 'user'` message. Its snapshot now holds the new welcome, so `welcomeToPost` at `:146-152` finds it "already used" and the new conversation opens with no welcome. The welcome is left in the closed conversation N. When the maker opens the new one, the kickoff writes a model greeting (`kickoff/route.ts:146-161` pass, then `:232` declines the canned path because the payload is queued), not the builder's words.

A second, related gap: after an import has posted a welcome and deleted the greeting, a second import into the same conversation sees the maker's old messages with no greeting to anchor on, and returns `maker_replied` (`apply-import.ts:35-40`). The new rule below fixes this too.

### Builder-facing lines that are wrong today (spec, both reports)

1. The banner after a paste when the header is not on Start says "agent config applies from the next conversation" (`BuilderProjectView.tsx:1281-1297`, text at `:1291`). When there is an open conversation the maker has not answered, the server has just applied the config to it.
2. The Start modal's "Opens with" line shows the project's `welcome_message` whatever will really open the thread (`BuilderProjectView.tsx:1879`, rendered `:1915-1920`). The Next round panel already computes the true opening (`lib/builder/next-round.ts:54-63`).

These are Task 5 (ruling 4).

## The rule (used by Tasks 1 to 4)

1. A welcome posted by an import carries `kind: 'welcome'`. Welcomes posted at creation stay untagged (no change to those routes).
2. "The opening point" of a conversation is the `created_at` of its newest `kind: 'welcome'` message. With none, it is the start of the conversation.
3. "The maker answered the opening" = there is a `role: 'user'` message with `created_at` after the opening point. With no opening point, any `role: 'user'` message counts (exactly today's behaviour for every conversation that has no tagged welcome).
4. The import also treats the canned greeting as a re-opening (#214): its point is the newer of the opening point and the newest `kind: 'unqueued_greeting'` message.
5. A builder's own note is `role: 'user'` and counts, as it does today in all three places (ruling 3). The kickoff keeps its own exclusion (#254); it is not changed.

Timestamps are UTC ISO strings, so string comparison is time order (as in `lib/sessions/queued.ts`).

## Global Constraints

1. Builder-facing text lives in `lib/copy.ts`. It has no French twin (French is only in `lib/copy-public.ts` and `lib/copy-maker.ts`). Nothing maker-facing changes text.
2. Do not change the kickoff (`lib/agent/kickoff.ts`, `app/api/chat/kickoff/route.ts`) or `lib/sessions/welcome.ts`.
3. No new Firestore index. Every new query is a single equality on `session_id`.
4. In a worktree, run both `npm run build` and `npm run type-check` before claiming clean (CLAUDE.md). The build needs dummy `NEXT_PUBLIC_FIREBASE_*` values in a worktree.
5. Ship by PR and a preview test (risky change: it deletes messages).

## Review Focus

1. The replace step in the import must never delete a message from before the opening point. In bug 2's conversation, Sam's last reply to the maker sits before the greeting and must stay. Pinned in Task 2.
2. A conversation with no tagged welcome behaves exactly as today in the header and in `POST /api/sessions`. Pinned in Tasks 1 and 3.
3. A rated agent message is never deleted (it would leave `projects.thumbs_down_count` off by one, and the maker reacted to it). Pinned in Task 2.

---

## Task 1: the shared rule

**Files:**
- Create: `lib/sessions/maker-replied.ts`
- Create: `lib/sessions/__tests__/maker-replied.test.ts`
- Modify: `lib/types/index.ts:161` (the `Message.kind` union)
- Modify: `app/api/chat/route.ts:197` (the `kind` cast)

- [ ] **Step 1: write the failing tests** in `lib/sessions/__tests__/maker-replied.test.ts`. Build messages as plain objects `{ role, kind?, created_at }`. Tests:

1. `describe('makerAnsweredOpening')`:
   1. `'no messages → false'`.
   2. `'an untagged welcome only → false'` (one agent message, no kind).
   3. `'any maker message counts when no welcome is tagged'`: agent at T1, user at T2 → true. Also user at T0 before an untagged agent at T1 → true (today's rule).
   4. `'a maker message before a tagged welcome does not count'`: user T1, agent T2, agent `kind: 'welcome'` T3 → false.
   5. `'a maker message after a tagged welcome counts'`: as above plus user T4 → true.
   6. `'the newest tagged welcome is the one that counts'`: welcome T1, user T2, welcome T3 → false.
   7. `'a canned greeting is not an opening here'`: user T1, agent T2, greeting `kind: 'unqueued_greeting'` T3 → true (the header and Start are unchanged in the "nothing queued" state).
2. `describe('makerRepliedSinceReopen')`:
   1. `'a maker message before the greeting does not count'`: user T1, greeting T2 → false.
   2. `'a maker message after the greeting counts'`: greeting T1, user T2 → true.
   3. `'a maker message before a tagged welcome does not count'`: user T1, welcome T2 → false.
   4. `'uses the newer of greeting and welcome'`: welcome T1, user T2, greeting T3 → false; greeting T1, welcome T2, user T3 → true.
   5. `'no greeting and no welcome: any maker message counts'`: user T1 → true.
3. `describe('reopenPoint')`:
   1. returns `null` with neither kind present.
   2. returns the newest `created_at` among `'welcome'` and `'unqueued_greeting'` messages, regardless of array order (pass the messages out of order).

- [ ] **Step 2: run** `npx vitest run lib/sessions/__tests__/maker-replied.test.ts`. Expect failure: the module does not exist.

- [ ] **Step 3: write `lib/sessions/maker-replied.ts`** with these exports, and a header comment that states the rule above (points 1 to 5):

```ts
export type ReplyCheckMessage = {
  role: 'user' | 'agent'
  kind?: string | null
  created_at?: string | null
}

// Newest created_at among messages of the given kinds, or null.
function newestAt(messages: ReplyCheckMessage[], kinds: string[]): string | null

// Where the import judges a reply from: the newer of the newest import-posted
// welcome (kind 'welcome') and the newest canned greeting. null = the start.
export function reopenPoint(messages: ReplyCheckMessage[]): string | null

// Asked by POST /api/sessions and the builder Conversations header.
export function makerAnsweredOpening(messages: ReplyCheckMessage[]): boolean
// = some role 'user' message with created_at > newestAt(['welcome']) (any, when null)

// Asked by the import (lib/sessions/apply-import.ts).
export function makerRepliedSinceReopen(messages: ReplyCheckMessage[]): boolean
// = some role 'user' message with created_at > reopenPoint (any, when null)
```

Compare with `String(m.created_at ?? '') > since`.

- [ ] **Step 4: widen the type.** `lib/types/index.ts:161`: `kind?: 'unqueued_greeting' | 'welcome'`, with the comment extended: "'welcome' = a builder welcome an import posted into an open conversation (Project 5)". `app/api/chat/route.ts:197`: change the cast to `data.kind as Message['kind']` (or the same union written out). Its only use, `:390`, checks `'unqueued_greeting'` and is unaffected.

- [ ] **Step 5: run** the new test file, then `npm run type-check`. Expect pass. Commit: `Welcome bugs: one rule for whether the maker answered a conversation's opening`.

## Task 2: the import uses the rule, tags its welcome, and replaces an unanswered opening (bug 1)

Depends on Task 1. Nico ruled "replace" (ruling 1): do every step.

**Files:**
- Modify: `lib/sessions/apply-import.ts`
- Modify: `lib/sessions/__tests__/apply-import.test.ts`

- [ ] **Step 1: write the failing tests** in `apply-import.test.ts`, using its in-memory `makeDb`. Add these `it`s inside the existing `describe`:

1. `'a maker message before an import-posted welcome is not a reply → applied'`: messages: user T1 (`2026-10-10T09:00`), agent T2, agent `kind: 'welcome'` content `'Older welcome'` T3. Expect `'applied'`.
2. `'a maker message after an import-posted welcome is a reply → maker_replied, no writes'`: as above plus user T4. Expect `'maker_replied'` and `writes` equal `[]`.
3. `'replaces an unanswered creation welcome instead of adding a second'`: active session snapshot `welcome_message: 'Old'`, one agent message `{ role: 'agent', content: 'Old', created_at: T1 }` with id `w0`, project welcome `'Fresh welcome'`. Expect a `delete` of `w0` and exactly one `set` on `messages` with `kind: 'welcome'` and content `'Fresh welcome'`.
4. `'replaces an unanswered import-posted welcome and keeps the answered history'`: messages user `m1` T1, agent `a1` T2 (Sam's reply), agent `w1` `kind: 'welcome'` content `'Middle'` T3. Project welcome `'Fresh welcome'`. Expect `delete` of `w1` only. Expect no `delete` of `m1` or `a1`. Expect one `set` with the new welcome.
5. `'re-opening after a greeting deletes the greeting only'`: messages user `m1` T1, agent `a1` T2, greeting `g` T3. Expect `delete` of `g`, no `delete` of `a1`, one `set` with the new welcome. (The existing test at line 83 covers part of this; this one adds `a1`.)
6. `'deletes nothing but greetings when no welcome is posted'`: one agent message `w0` content `'Fresh welcome'` and session snapshot `'Fresh welcome'` (unchanged welcome). Expect no `delete` and no `set`.
7. `'keeps an unanswered opening the maker rated'`: as test 3 but `w0` has `rating: 'up'`. Expect no `delete` of `w0`; the new welcome is still posted.

Update the existing `'posts the new welcome when it is new for this round'` (line 110): the expected `data` gains `kind: 'welcome'`. That is the only existing assertion that changes.

- [ ] **Step 2: run** `npx vitest run lib/sessions/__tests__/apply-import.test.ts`. Expect tests 1, 3, 4, 7 and the updated line-110 test to fail; 2, 5 and 6 may already pass.

- [ ] **Step 3: change `lib/sessions/apply-import.ts`:**

1. Replace lines 33-40 with a call to `makerRepliedSinceReopen` over the message data (`messages.map((d) => d.data() as ReplyCheckMessage)`). Keep `greetings` (still deleted).
2. Keep the `welcomeToPost` and `alreadyPosted` logic (lines 42-56) as it is.
3. When `toPost` is not null, also delete every agent message with `created_at >= reopenPoint(...)` (all agent messages when it is null), except messages with a `rating` set. Use `>=`: an earlier import's welcome has `created_at` equal to its own point. Build one `Set` of ids from greetings plus these, and `batch.delete` each once.
4. When no welcome is posted, delete greetings only, as today.
5. The posted message (lines 76-84) gains `kind: 'welcome'`.
6. Update the top comment (lines 9-13) to say: the import re-opens the conversation when the maker has not spoken since its last opening (welcome or greeting), and a new welcome replaces the unanswered opening.

Why this cannot delete answered history: the function returns early if any user message is after the reopen point, so every agent message at or after it is unanswered. Agent messages before it (Sam's replies to the maker) are never touched.

- [ ] **Step 4: run** the test file, then `npm test`. Expect pass. Commit: `Welcome bugs: a new welcome replaces an unanswered one in the open conversation`.

## Task 3: Start conversation N uses the rule (bug 2, server)

Depends on Task 1. Independent of Task 2 except for the tag it reads.

**Files:**
- Modify: `app/api/sessions/route.ts:126-140`
- Modify: `app/api/sessions/__tests__/sessions.test.ts`

- [ ] **Step 1: rework the messages mock, then write the failing tests.**

1. In `sessions.test.ts` replace `mockSessionsWithMakerMessage` (line 49) and `messagesCollection()` (lines 88-104) with `let mockSessionMessages: Record<string, Record<string, unknown>[]> = {}`. The mock's `where('session_id', '==', id)` returns `{ get }` that pushes `id` to `messagesQueries` and resolves `{ docs: (mockSessionMessages[id] ?? []).map((d, i) => ({ id: \`m${i}\`, data: () => d })) }`. Reset it in the `beforeEach` where the old set was reset.
2. Port the two existing #214 tests (lines 324 and 340): "maker spoke" becomes `mockSessionMessages = { s2: [{ role: 'user', created_at: '2026-10-10T09:00:00.000Z' }] }`; "never spoke" becomes `{ s2: [{ role: 'agent', content: 'Round two hello', created_at: '2026-10-10T08:00:00.000Z' }] }`. Their assertions stay the same.
3. New `it('replays a welcome the maker has not answered when an import posted it after their last message')`: s1 completed with `welcome_message: 'Round one hello'`; s2 active with `welcome_message: 'Round two hello'`; `mockSessionMessages.s2 = [user T1, agent T2, { role: 'agent', kind: 'welcome', content: 'Round two hello', created_at: T3 }]`; project welcome `'Round two hello'`. Expect the new session's agent message content `'Round two hello'`.
4. New `it('does not replay an import-posted welcome the maker answered')`: as above plus a user message at T4. Expect no agent message in `batchSets`.

- [ ] **Step 2: run** `npx vitest run app/api/sessions/__tests__/sessions.test.ts`. Expect test 3 to fail (today the maker's T1 message marks s2 as used).

- [ ] **Step 3: change the route.** In the loop at `app/api/sessions/route.ts:132-140`, read all the session's messages with `db.collection('messages').where('session_id', '==', doc.id).get()` (no role filter, no limit), map to `d.data() as ReplyCheckMessage`, and add the id to `unusedSessionIds` when `!makerAnsweredOpening(rows)`. Update the comment at `:126-130` to say "the maker has not answered the conversation's opening (the welcome an import posted, else any message)".

- [ ] **Step 4: run** the test file and `npm test`. Commit: `Welcome bugs: Start replays a welcome the maker has not answered`.

## Task 4: the Conversations header uses the rule (bug 2, builder view)

Depends on Task 1. Nico ruled "Nudge" (ruling 2).

**Files:**
- Modify: `components/builder/BuilderProjectView.tsx:1202`, `:1212`, `:1325`
- Create: `components/builder/__tests__/BuilderProjectView.dispatch.test.tsx`

- [ ] **Step 1: write the failing test.** Copy the harness from `components/builder/__tests__/BuilderProjectView.importPatch.test.tsx` lines 1-82 (mocked `apiFetch` answering GETs by path, the same `vi.mock`s), with `useSearchParams: () => new URLSearchParams('tab=conversations')`. Answers: `/api/projects` as in that file (it has `requester_email`), `/api/sessions` = `[{ id: 's1', project_id: 'p1', status: 'active', created_at: T0, welcome_message: 'Round two hello' }]`, plus `/api/messages` per test. Check which members endpoint `useProjectMembers` calls (`lib/query/hooks.ts:192`) and answer it with `[]`. Tests:

1. `'offers Nudge when an import posted a welcome after the maker last spoke'`: messages user T1, agent T2, agent `kind: 'welcome'` T3. Expect a button named `/^Nudge/` and no button named `/Start conversation 2/`.
2. `'offers Start when the maker answered the import-posted welcome'`: same plus user T4. Expect `/Start conversation 2/`.
3. `'offers Start when the maker spoke and no welcome is tagged (unchanged)'`: user T1, agent T2. Expect `/Start conversation 2/`.

- [ ] **Step 2: run** the file. Expect test 1 to fail.

- [ ] **Step 3: change the view.** At `:1202` replace `hasUserMessages` with `const makerAnswered = activeMessages ? makerAnsweredOpening(activeMessages) : false` and use it at `:1212` and `:1325`. Nothing else in the header changes.

- [ ] **Step 4: run** the file and `npm test`. Commit: `Welcome bugs: the header waits on the maker after an import re-opens their conversation`.

## Task 5: the two builder lines say what will happen

Depends on Task 4. Nico ruled yes (ruling 4).

**Files:**
- Modify: `lib/copy.ts` (`copy.nextRound`, near `:662-689`)
- Modify: `components/builder/BuilderProjectView.tsx:1281-1297` (banner), `:1762-1784` and `:1879`, `:1915-1920` (Start modal)
- Modify: `components/builder/__tests__/BuilderProjectView.dispatch.test.tsx`

- [ ] **Step 1: write the failing tests** in the Task 4 file.

1. `'the banner after a paste says the config applies to the open conversation'`: render on the Brief tab instead (`useSearchParams` with no tab), messages `[]` for `s1`, script `PATCH /api/projects` to answer `{ id: 'p1' }` and `PUT /api/briefs` as in the importPatch file. Paste a `next-convo` payload with `welcome_message` (so `configUpdated` is true) and click Import. Expect the text of `copy.nextRound.importAppliedToOpen`.
2. `'the Start modal shows Sam's greeting when the welcome was already used'`: sessions `s0` completed with `welcome_message: 'Hello'` and `s1` active with the same, messages for `s1` with a user message (Start state), project `welcome_message: 'Hello'`. Click the Start button. Expect `copy.nextRound.openingKickoff` in the modal and not `'Hello'`.

- [ ] **Step 2: run.** Expect both to fail.

- [ ] **Step 3: change.**

1. `lib/copy.ts`, `copy.nextRound`: add `importAppliedToOpen: '; agent config applied to the open conversation'` and `importAppliesNext: '; agent config applies from the next conversation'`.
2. Banner `:1291`: when `justImported.configUpdated`, use `importAppliedToOpen` if `activeSession && !makerAnswered`, else `importAppliesNext`. Update the comment at `:1281-1283`.
3. Start modal: pass `opening={nextRound({ project, sessions, unusedSessionId }).opening}` from the header into `StartDispatch` (the same arguments as the `NextRoundPanel` at `:1322-1327`). Replace `openerPreview` at `:1879` with: the welcome text (whitespace collapsed, as now) for `kind: 'welcome'`, `copy.nextRound.openingDefault` for `'default'`, `copy.nextRound.openingKickoff` for `'kickoff'`. The row always shows.

- [ ] **Step 4: run** the file and `npm test`. Commit: `Welcome bugs: the paste banner and Start modal say what will open the conversation`.

## Task 7: the last reminder is always visible

Ruled in by Nico on 2026-11-23. Done after Task 5 and before Task 6 (the numbers are kept so Tasks 1 to 6 keep their names). Depends on Task 4 (it edits the same header). Independent of Tasks 2, 3 and 5.

**What is wrong today:**
1. The green "Reminder sent to …" line is component state in `NudgeDispatch` (`components/builder/BuilderProjectView.tsx:1691`, `:1702-1708`) and is gone on reload.
2. "Copy reminder" and "Start & copy nudge" stamp `last_nudged_at` though the app sent nothing (`lib/hooks/useNudgeCopy.ts:21-26`, through `PATCH /api/projects`, allowed at `app/api/projects/route.ts:230`).
3. A real send (kinds `reminder` and `nudge`) stamps the same `last_nudged_at` with no method or recipient (`app/api/projects/[id]/email/route.ts:216-221`).
4. The time shows only on the dashboard card, as "Nudged 2h ago" (`app/dashboard/page.tsx:392-394`, `copy.dashboard.nudgedAt` at `lib/copy.ts:159`), for copies and sends alike.
5. Automatic reminders stamp a separate `last_reminder_sent_at` (`app/api/cron/maker-reminders/route.ts:204-208`), shown only in Settings (`lib/builder/settings-view.ts:60`).
6. `lib/types/index.ts:48` says `last_nudged_at` is "when the builder last copied a nudge message", which is wrong since the email route also writes it.

**Decisions made here:**
1. Fields, all on `projects`, no index: keep `last_nudged_at`; add `last_nudged_method: 'email' | 'copy' | null` and `last_nudged_to: string[] | null` (the addresses the email actually went to). Automatic reminders keep `last_reminder_sent_at`; line 4 names no address, so no new field there.
2. The server decides the method. `PATCH /api/projects` with `last_nudged_at` in the body (only `useNudgeCopy` sends it) also writes `last_nudged_method: 'copy'` and `last_nudged_to: null`. The client cannot claim an email. The email route writes `'email'` and the delivered addresses for kinds `reminder` and `nudge`. When every recipient was suppressed (preview only), it still stamps `last_nudged_at` as today and writes `last_nudged_method: null`, `last_nudged_to: null`, because nothing was emailed.
3. The `nudge` email (sent by "Start conversation N" in `StartDispatch`, `BuilderProjectView.tsx:1853-1862`) feeds the same line, as "Reminder emailed to …". It is the email that tells the maker a conversation is waiting. "Start & copy nudge" feeds it as a copy.
4. Legacy wording: a `last_nudged_at` with no `last_nudged_method` (everything before this ships, and the all-suppressed preview case) reads "Reminder recorded November 20, 4:00 PM. The app did not save whether it was emailed or copied." It never says "emailed".
5. Which one shows: the newest of the manual one (`last_nudged_at`) and the automatic one (`last_reminder_sent_at`). On a tie, the manual one (it carries the address).
6. "Since the welcome was posted" is measured from the open conversation's opening point: the `created_at` of its newest `kind: 'welcome'` message (Task 2 tags these), else the conversation's `created_at` (its welcome was posted at creation). A reminder older than that is not shown in the header.
7. Where it shows on the Conversations header: in the Nudge state, always (line 1 when there is nothing to show). In the Start state, only when a reminder exists at or after the open conversation's opening point; otherwise nothing. In the Invite state, never.
8. The dashboard card, for builder-side viewers (`builderSide`, `app/dashboard/page.tsx:291`), shows the same sentence for the newest reminder, with no opening-point filter (the card has no messages), and nothing when there is none. Maker viewers keep today's "Nudged …" / "Relancé …" line unchanged; the four sentences are builder text and have no French twin.
9. After a send, the Nudge button stays (today it is replaced until reload), and the line updates from the refetched project.

**Files:**
- Create: `lib/builder/reminder-line.ts`, `lib/builder/__tests__/reminder-line.test.ts`
- Modify: `lib/copy.ts` (new `copy.reminderLine` group)
- Modify: `lib/types/index.ts:48` (comment) and the `Project` type (two new fields)
- Modify: `app/api/projects/route.ts` (PATCH, near `:241-246`), `app/api/projects/__tests__/update-delete-project.test.ts`
- Modify: `app/api/projects/[id]/email/route.ts:216-221`, `app/api/projects/__tests__/maker-email.test.ts`
- Modify: `lib/query/hooks.ts` (`useSendMakerEmail`: invalidate `queryKeys.project(project_id)` and `queryKeys.projects()` on success; check first whether it already does)
- Modify: `components/builder/BuilderProjectView.tsx` (`StatusStrip` near `:1250-1280`, `NudgeDispatch` `:1677-1760`)
- Modify: `app/dashboard/page.tsx:392-394`
- Modify: `components/builder/__tests__/BuilderProjectView.dispatch.test.tsx` (from Task 4)
- Modify: `docs/data-model.md:8` (projects line: the three fields and who writes them; `last_reminder_sent_at` is the automatic one)

- [ ] **Step 1: write the failing tests.**

1. `lib/builder/__tests__/reminder-line.test.ts`:
   1. `describe('pacificDateTime')`: `'2026-11-23T22:10:00.000Z'` → `'November 23, 2:10 PM'`; `'2026-11-23T17:00:00.000Z'` → `'November 23, 9:00 AM'`; `'2026-07-04T19:05:00.000Z'` → `'July 4, 12:05 PM'` (summer time).
   2. `describe('latestReminder')`: nothing set → `{ kind: 'none' }`; method `'email'` with `to: ['a@x.com']` → `emailed`; method `'copy'` → `copied`; only `last_reminder_sent_at` → `automatic`; manual newer than automatic → the manual one; automatic newer → `automatic`; same instant → the manual one; `last_nudged_at` with no method → `recorded`; method `'email'` with `to` empty or null → `recorded`.
   3. `describe('conversationOpeningAt')`: messages with two `kind: 'welcome'` → the newest one's `created_at`; none tagged → the session's `created_at`; an `unqueued_greeting` is ignored.
   4. `describe('headerReminderLine')`: Nudge state, nothing → `none`; Nudge state, reminder before the opening point → `none`; reminder at or after it → that reminder; Start state, nothing since the opening → `null` (show nothing); Start state, one since → that reminder; Invite state → `null`.
   5. `describe('reminderText')`, exact strings: `'No reminder sent since the welcome was posted.'`; `'Reminder emailed to a@x.com, November 23, 2:10 PM.'` (two addresses joined with `', '`); `'Reminder text copied November 23, 2:10 PM. The app did not send it.'`; `'Automatic reminder emailed November 23, 9:00 AM.'`; `'Reminder recorded November 20, 4:00 PM. The app did not save whether it was emailed or copied.'`.
2. `update-delete-project.test.ts`: `it('marks a PATCHed last_nudged_at as a copy')`: PATCH with `last_nudged_at` → the update has `last_nudged_method: 'copy'` and `last_nudged_to: null`. `it('ignores last_nudged_method and last_nudged_to sent by the client')`: PATCH with `last_nudged_method: 'email'` and no `last_nudged_at` → neither field written.
3. `maker-email.test.ts`: extend `'sends a reminder to the maker, replyTo + bcc the builder, and stamps last_nudged_at'` (line 119) to expect `last_nudged_method: 'email'` and `last_nudged_to: [the maker's address]`. `it('a nudge stamps email and every address it went to')` next to line 207. Extend `'suppresses the real send on preview for a non-allowlisted maker, but still stamps activity'` (line 304) to expect `last_nudged_method: null` and `last_nudged_to: null`. In `'suppresses per recipient on preview (allowlisted maker still sends)'` (line 274), expect `last_nudged_to` to hold only the allowlisted address.
4. `BuilderProjectView.dispatch.test.tsx`: `it('shows the stored reminder beside Nudge after a reload')`: project with `last_nudged_at` after the opening, method `'email'`, `to: ['sam@example.com']`, messages as Task 4 test 1 → the `reminderText` for it is on screen. `it('says no reminder was sent in the Nudge state when none was')`. `it('shows nothing about reminders in the Start state when none was sent for this conversation')`.

- [ ] **Step 2: run** the four files. Expect failures.

- [ ] **Step 3: change.**

1. `lib/builder/reminder-line.ts`: export `pacificDateTime(iso)` (format the date `{ month: 'long', day: 'numeric' }` and the time `{ hour: 'numeric', minute: '2-digit' }` separately with `timeZone: 'America/Los_Angeles'`, `en-US`, and join with `', '`: a single formatter with both prints "November 23 at 2:10 PM"), `latestReminder(project)`, `conversationOpeningAt(session, messages)`, `headerReminderLine({ dispatchKind, project, openingAt })` returning a line or `null`, and `reminderText(line)`. The line type is `{ kind: 'none' } | { kind: 'emailed'; at; to } | { kind: 'copied'; at } | { kind: 'automatic'; at } | { kind: 'recorded'; at }`.
2. `lib/copy.ts`: `reminderLine: { none, emailed(to, when), copied(when), automatic(when), recorded(when) }` with the exact strings above.
3. Types: the two fields on `Project`; fix the `last_nudged_at` comment.
4. `PATCH /api/projects`: after the allowed-field loop, `if ('last_nudged_at' in updates) { patch.last_nudged_method = 'copy'; patch.last_nudged_to = null }`. Do not add the two fields to `allowed`.
5. Email route `:216-221`: in the non-invite branch, `last_nudged_method` is `'email'` and `last_nudged_to` the non-suppressed addresses from `results`, or both `null` when every result is suppressed.
6. `useSendMakerEmail`: invalidate the project queries on success.
7. `StatusStrip`: compute `openingAt = activeSession ? conversationOpeningAt(activeSession, activeMessages ?? []) : null` and `headerReminderLine(...)`; render the text as a small line beside the dispatch button when not `null`. `NudgeDispatch`: remove `sentTo` state and its early return (`:1691`, `:1702-1708`, `setSentTo` at `:1742`). Leave `SendToMakerButton` (`:1581`, used only for invites at `:1506`) as it is; its sends are stamped by the server like any other.
8. Dashboard `:392-394`: `builderSide` → `reminderText(latestReminder(project))` when not `none`; maker viewers keep `d.nudgedAt(ago(project.last_nudged_at))`.
9. `docs/data-model.md:8`: name `last_nudged_at`, `last_nudged_method`, `last_nudged_to` (server-written; copy from the PATCH, email from the email route; null method = recorded before 2026-11-23 or suppressed on preview) and `last_reminder_sent_at` (the cron).

- [ ] **Step 4: run** the four files and `npm test`. Commit: `Reminders: the last one sent or copied stays visible on the header and the dashboard`.

## Task 6: preview check script

Depends on Tasks 2 to 4 and 7 on a branch pushed to preview (`git push origin <branch>:preview --force`, 1-2 min to rebuild).

**Files:**
- Create: `scripts/e2e-p5-welcome-bugs.mjs`, modelled on `scripts/e2e-214-stale-greeting.mjs` (same `launchLoggedIn`, `loginWithPassword`, `readCastPassword`, `call` helper, PASS/FAIL grading, throwaway brief deleted at the end, SKIPPED when `.test-cast-passwords.json` is missing).

Steps the script runs:

1. Scenario A (bug 1, test admin only). Create a brief by Import JSON with welcome `W1` and a test-cast maker as requester (as e2e-214 does). PATCH `payload_pasted_at` plus welcome `W2`. Grade: conversation 1 holds exactly one agent message, content `W2`, `kind: 'welcome'`.
2. Scenario B (bug 2, needs the test-cast maker, because the kickoff is maker-only and the test admin resolves to owner; `docs/runbooks.md`, agent-driven e2e). As the maker, send one chat message in conversation 1 and wait for Sam's reply (one model call). As the builder, PATCH `prep_copied_at` = now. As the maker, POST `/api/chat/kickoff` for conversation 1. Grade: one `unqueued_greeting`. As the builder, PATCH `payload_pasted_at` plus welcome `W3`. Grade: greeting gone; the maker's message and Sam's reply still there; last agent message `W3` with `kind: 'welcome'`.
3. Still B: open the builder page `?tab=conversations` headless and grade that a "Nudge" button shows and "Start conversation 2" does not. Take a screenshot.
4. Still B: POST `/api/sessions` as the builder anyway. Grade: conversation 2's first agent message is `W3`.
5. Task 7, before step 4 above (it needs the Nudge state). In the builder page, grade the line "No reminder sent since the welcome was posted." beside Nudge. Click Nudge, then "Copy reminder"; reload; grade "Reminder text copied … The app did not send it." Click Nudge, then "Send reminder" (it goes to the test-cast address, which is on the preview allowlist, so one real email goes to an ibuild4you.com inbox); reload; grade "Reminder emailed to test-originator@ibuild4you.com, …". GET the project and grade `last_nudged_method: 'email'` and `last_nudged_to`. Open `/dashboard` and grade the same sentence on the brief's card. Screenshot each.

Also re-run `node scripts/e2e-214-stale-greeting.mjs` and `node scripts/e2e-204-welcome-verbatim.mjs` against preview; both must still pass. e2e-204 step 2 may now take the replace path if it pastes while conversation 1 is unanswered; it should still see `W2` open conversation 2.

## Verification

1. `npm test`, `npm run lint`, `npm run type-check`, and `npm run build` (both, in a worktree).
2. Task 6 script on preview (including its Task 7 step), plus the two regression scripts.
3. After merge, on production: watch the next F4FC paste. `vercel logs -e production --since 1h -n 2000 --json`, filter for `apply_import`; the result should be `applied` when the maker has not answered, and the conversation should show one welcome.
4. After merge, on production: the next reminder Nico sends or copies shows on the Conversations header after a reload, and on the dashboard card, with its method and Pacific time. A brief nudged before the deploy shows "Reminder recorded …".

## Rulings (Nico, 2026-11-23)

1. A new welcome replaces an unanswered opening; it does not follow it (Task 2, every step).
2. After an import re-opens the maker's old conversation, the header offers Nudge, not Start (Task 4).
3. A builder's own note counts as the maker answering, as today in the import, the header and Start. The kickoff's exclusion (#254) is not touched.
4. Both builder lines are fixed in this pass: the paste banner and the Start modal's "Opens with" (Task 5).
5. The last reminder is always visible (Task 7), with the four sentences Nico approved: "No reminder sent since the welcome was posted.", "Reminder emailed to (address), November 23, 2:10 PM.", "Reminder text copied November 23, 2:10 PM. The app did not send it.", "Automatic reminder emailed November 23, 9:00 AM." The legacy wording, the opening point and the Start-state rule are decided in Task 7, "Decisions made here".

## Risks

1. A maker with the conversation open when the builder pastes will see the old welcome disappear and the new one appear (the maker view listens in real time). Only when they had not answered it. Rated messages are kept.
2. The builder sees "Nudge" where they saw "Start" after an import into a conversation the maker had come back to. That is the fix, but it changes the builder's next step mid-round.
3. Data already in production in the broken state:
   1. Closed conversations holding a stranded welcome: history only. No repair needed. A read-only check can list them, to see whether a maker's current round lost its welcome text (links, test steps): a completed session whose last message is an agent message equal to its `welcome_message`, posted after its last user message, while the next session has no agent message with that text. If a current round is affected, the builder re-sends the welcome as a builder note.
   2. Open conversations where an import already posted a welcome after the maker's messages: that welcome has no `kind`, so after deploy the header still shows Start for them, and Start still strands it. Run the same read-only check on active sessions before deploy. If any turn up, the smallest repair is setting `kind: 'welcome'` on that one message; or the builder simply re-imports. Not written here.
   3. Conversations already showing two welcomes: cosmetic history. No repair.
4. `POST /api/sessions` now reads all messages of the open conversation instead of one. Normally tens of documents; acceptable.
5. Task 7 changes the dashboard card for builders: "Nudged 2h ago" becomes a full sentence with a Pacific date, and automatic reminders now show there too. Maker viewers see no change. Every brief nudged before the deploy reads "Reminder recorded …" until its next reminder; no backfill (the method was never stored, so none is possible).
6. Inferred, not verified: that no other code path reads `message.kind` and would mis-handle `'welcome'`. A grep on main found only `app/api/chat/route.ts:197`, `:390` and `lib/sessions/apply-import.ts:33`.
