# Welcome follow-ups (#293) and the project page that never loads (#291) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the five code follow-ups PR #292 left (#293 items 1 to 5), and make the project page say so when a brief cannot be shown instead of loading forever (#291).

**Issues:** #293 (welcome bugs follow-ups; detail in PR #292's body and review comment), #291 (project page stuck on "Loading...").

**Tech Stack:** Next.js App Router, Firestore (Admin SDK), React Query, vitest + Testing Library.

**Checked on:** branch `welcome-followups` at `0a85391` (main after PR #292). Every file, function and line cited below was opened at that commit. Line numbers drift as earlier tasks land; search for the quoted code if a number is off.

## Global Constraints

Binding on every task.

1. TDD: write the failing test first, run it, see it fail for the reason the task gives, then write the code. Task 5 strengthens tests of code that is already right; its "failing first" is a temporary break of the code, described there.
2. User-facing text lives in `lib/copy.ts`. Builder text has no French twin. Maker-facing text also goes in `lib/copy-maker.ts` with its French twin (that file reads English from `lib/copy.ts`; see its header comment). Only Task 7 adds text.
3. No new dependencies. No new Firestore index: every new query is a single equality on `session_id`, or a query the code already runs.
4. Tests are vitest. Component tests start with `// @vitest-environment jsdom`.
5. One commit per task. The commit message ends with this line:
   `Co-Authored-By: Claude Fable 5.2 <noreply@anthropic.com>`
6. Verification before each commit, in this worktree (`/Users/nico/src/ibuild4you-wt-followups`), in this order: `npm test`, `npm run lint`, then `npm run build` followed by `npm run type-check`. The build needs dummy Firebase values; run it as one line:
   `NEXT_PUBLIC_FIREBASE_API_KEY=dummy NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=dummy.firebaseapp.com NEXT_PUBLIC_FIREBASE_PROJECT_ID=dummy NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=dummy NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=1 NEXT_PUBLIC_FIREBASE_APP_ID=1:1:web:1 npm run build`
   Both build and type-check are needed: either alone is a false green in a worktree (CLAUDE.md, "Gotchas").
7. Never commit `lib/build-info.json` (the build rewrites it). `git checkout lib/build-info.json` before committing if it shows as modified.
8. Do not change the kickoff (`lib/agent/kickoff.ts`, `app/api/chat/kickoff/route.ts`) or `lib/sessions/welcome.ts`.

## Task order and dependencies

1. Task 1, then Task 2: both change `lib/sessions/apply-import.ts` and its test. Task 2 builds on Task 1's transaction.
2. Task 3 depends on Task 2 (it reads the PATCH field Task 2 adds).
3. Tasks 4, 5, 6 and 7 are independent of the others and of each other, except that Task 7 assumes Task 6's server answer (it works without it, for unknown slugs only).

---

### Task 1: the import reads and writes in one transaction (#293 item 3)

**Files:**
- Modify: `lib/sessions/apply-import.ts`
- Modify: `lib/sessions/__tests__/apply-import.test.ts`

**What is wrong today.** `applyImportToOpenSession` (`lib/sessions/apply-import.ts:17-116`) reads the project's sessions (`:24`), then the open conversation's messages (`:30-34`), decides from them, and writes with `db.batch()` (`:76-114`). Nothing ties the writes to what was read. If the maker sends a message, or rates the old welcome, between the read and the commit (tens of milliseconds), the import does not see it: it can delete a welcome the maker just answered or rated, and post a new one after the maker's reply. The only caller is `PATCH /api/projects` (`app/api/projects/route.ts:279-291`), which catches any throw and answers `import_applied: null`. Its test mocks the module (`app/api/projects/__tests__/update-delete-project.test.ts:5-8`), so it does not change here.

**Wanted.** The whole function body runs inside `db.runTransaction`. Both reads go through the transaction; every write goes through it; nothing else changes (same decisions, same writes, same return values).

Why this closes the gap: Firestore runs server-SDK transactions with serializable isolation and pessimistic locks on what the transaction read, including the documents a query returned and the range it scanned. A maker message added to the queried range, or a rating written to a message the import read, either waits for the import to commit or makes Firestore re-run the import's callback, which then reads the new state. The re-run is why the callback must have no side effects outside the transaction. The same transaction also serializes two imports sent close together (a double click): the second one re-reads, finds the first one's welcome, and does not post it again.

The transaction boundary, exactly:

```ts
export async function applyImportToOpenSession(
  db: Firestore,
  projectId: string,
  project: Record<string, unknown>,
  now: string
): Promise<'no_session' | 'maker_replied' | 'applied'> {
  // One transaction from the first read to the last write: a maker message or
  // a rating that lands while the import runs is either seen (Firestore re-runs
  // this callback with the new state) or waits until the import has committed.
  // The callback may run more than once, so it does nothing outside `tx`.
  return db.runTransaction(async (tx) => {
    const sessionSnap = await tx.get(db.collection('sessions').where('project_id', '==', projectId))
    // ... active session pick, unchanged ...
    if (!active) return 'no_session'
    const msgSnap = await tx.get(
      db.collection('messages').where('session_id', '==', active.id).orderBy('created_at', 'asc')
    )
    // ... every decision unchanged (greetings, makerRepliedSinceReopen, welcomeToPost,
    //     alreadyPosted, toDelete) ...
    for (const d of toDelete.values()) tx.delete(d.ref)
    tx.update(active.ref, { /* unchanged */ })
    tx.update(db.collection('projects').doc(projectId), projectUpdate)
    if (toPost) tx.set(db.collection('messages').doc(), { /* unchanged */ })
    return 'applied'
  })
}
```

Rules for the change:
1. Both reads happen before the first write (Firestore requires it; the current order already does).
2. Replace `batch.delete/update/set` with `tx.delete/update/set` one for one. Remove `db.batch()` and `batch.commit()`.
3. Keep every comment that explains a decision. Replace the batch-related wording only.
4. Add no logging inside the callback.

**Test mock change (the risky part, do it exactly).** In `apply-import.test.ts`, `makeDb` (`:10-48`) gains a transaction and loses the batch:

1. The query object keeps `where` and `orderBy`. Rename its `get` to `_run` (same body). Add a public `get()` that pushes the collection name to a new `directReads: string[]` array and then returns `_run()`. The code under test must never call it.
2. `db.batch()` throws `new Error('apply-import must write through its transaction')`.
3. `db.runTransaction(fn)`:
   ```ts
   async runTransaction<T>(fn: (tx: unknown) => Promise<T>): Promise<T> {
     for (let attempt = 1; ; attempt++) {
       const pending: typeof writes = []
       const tx = {
         get: (q: { _run: () => Promise<unknown> }) => q._run(),
         delete: (r: Ref) => pending.push({ op: 'delete', collection: r.collection, id: r.id }),
         update: (r: Ref, d: Row) => pending.push({ op: 'update', collection: r.collection, id: r.id, data: d }),
         set: (r: Ref, d: Row) => pending.push({ op: 'set', collection: r.collection, id: r.id, data: d }),
       }
       const result = await fn(tx)
       // Simulates Firestore aborting the first attempt because another write
       // touched what it read: that attempt's writes are dropped and it re-runs.
       if (attempt === 1 && opts.interleave) {
         opts.interleave(data)
         continue
       }
       writes.push(...pending) // commit
       return result
     }
   }
   ```
   where `type Ref = { collection: string; id: string }`.
4. `makeDb(data, opts: { interleave?: (data: Record<string, Record<string, Row>>) => void } = {})` returns `{ db, writes, directReads }`.

Every existing test keeps its assertions unchanged: they read `writes` after the call, and `writes` holds what was committed.

- [ ] **Step 1: write the failing tests.** Change `makeDb` as above. Add inside the existing `describe`, using the existing helpers `maker`, `sam`, `deletes` and times `T1`..`T4` (`:229-235`):

1. `it('reads and writes only through the transaction')`: `makeDb({ sessions: { s1: activeSession }, messages: { w0: sam('Old', T1) } })`. Call the import. Expect `directReads` to equal `[]`, and `writes` to contain the delete of `w0` and one `set` on `messages` (the import ran and committed).
2. `it('a maker reply that lands while the import runs is seen on the retry → maker_replied, nothing written')`: `messages: { w0: sam('Old', T1) }`, `interleave: (d) => { d.messages.m9 = maker(T2) }`. Expect the result `'maker_replied'` and `writes` to equal `[]`.
3. `it('a rating that lands while the import runs keeps the rated welcome')`: `messages: { w0: sam('Old', T1) }`, `interleave: (d) => { d.messages.w0.rating = 'up' }`. Expect `deletes(writes)` to equal `[]` and exactly one `set` on `messages` with `content: 'Fresh welcome'`.
4. `it('a second import right after the first does not post the welcome twice')`: `messages: { w0: sam('Old', T1) }`, `interleave: (d) => { d.messages.wNew = sam('Fresh welcome', NOW, { kind: 'welcome' }) }` (the first import committed before ours re-ran). Expect no `set` on `messages`.

How they prove the defect: with the code as it is, every test in the file fails with "apply-import must write through its transaction" (the code calls `db.batch()`). Tests 2 to 4 also prove more than "uses a transaction": they fail if the code reads outside the callback (the re-run would decide on the first attempt's stale rows) or writes outside it (the first attempt's writes would survive).

- [ ] **Step 2: run** `npx vitest run lib/sessions/__tests__/apply-import.test.ts`. Expect every test to fail on the batch error.

- [ ] **Step 3: change `lib/sessions/apply-import.ts`** as specified above. Update the top comment (`:10-16`) with one sentence: the import reads and writes in one transaction, so a maker reply or rating that lands meanwhile is seen.

- [ ] **Step 4: run** the file, then the verification in Global Constraints 6. Commit: `Import: read and write the open conversation in one transaction (#293)`.

**Reviewer checks:** no `await` on anything but `tx.get` inside the callback; no write outside `tx`; no decision logic changed (diff the body ignoring the `batch`→`tx` renames); the existing tests' assertions are untouched.

---

### Task 2: the import says whether it posted a welcome (#293 item 2, server)

Depends on Task 1 (the function now runs in `db.runTransaction`).

**Files:**
- Modify: `lib/sessions/apply-import.ts`
- Modify: `lib/sessions/__tests__/apply-import.test.ts`
- Modify: `app/api/projects/route.ts` (PATCH, `:274-295`)
- Modify: `app/api/projects/__tests__/update-delete-project.test.ts` (`:5-8`, `:276-331`)

**What is wrong today.** The import answers `'applied'` both when it posted a new welcome and when it only re-armed the conversation (deleted the canned greeting, re-snapshotted the config, nulled `last_kickoff_at`) because the welcome was unchanged (`apply-import.ts:54`, `toPost === null`). The builder's header treats every `'applied'` as "the maker has not answered" while the paste banner is up (`components/builder/BuilderProjectView.tsx:1234-1235`). In the re-arm case the maker may have spoken earlier, so after the banner is dismissed the header follows the messages and flips from Nudge to Start. Task 3 fixes the header; this task gives it the fact it needs.

**Wanted.** The import returns whether it posted a welcome, and the PATCH answers it.

New type and signature in `lib/sessions/apply-import.ts`:

```ts
export type ImportOutcome = {
  result: 'no_session' | 'maker_replied' | 'applied'
  // True only when result is 'applied' and a new welcome was posted (kind 'welcome').
  welcomePosted: boolean
}

export async function applyImportToOpenSession(
  db: Firestore,
  projectId: string,
  project: Record<string, unknown>,
  now: string
): Promise<ImportOutcome>
```

Returns: `{ result: 'no_session', welcomePosted: false }`, `{ result: 'maker_replied', welcomePosted: false }`, and `{ result: 'applied', welcomePosted: toPost !== null }`.

PATCH (`app/api/projects/route.ts:274-295`):
1. Next to `importApplied`, declare `let importWelcomePosted: boolean | undefined`.
2. In the `'payload_pasted_at' in updates` branch, set `importWelcomePosted = false` alongside `importApplied = null`; on success set `importApplied = outcome.result` and `importWelcomePosted = outcome.welcomePosted`.
3. The log line becomes `console.log('[projects] apply_import', { project_id, result: outcome.result, welcome_posted: outcome.welcomePosted })`. The `result` key keeps its name and values, so the log filter in CLAUDE.md ("filter for `apply_import`") still works.
4. The answer spreads `{ import_applied: importApplied, import_welcome_posted: importWelcomePosted }` under the same `importApplied !== undefined` condition. Without `payload_pasted_at` neither key is present. When the import threw: `import_applied: null`, `import_welcome_posted: false`.

- [ ] **Step 1: write the failing tests.**

In `apply-import.test.ts`:
1. Change every `expect(await applyImportToOpenSession(db, 'p1', <p>, NOW)).toBe(X)` to `expect((await applyImportToOpenSession(db, 'p1', <p>, NOW)).result).toBe(X)`. This covers the existing tests and Task 1's test 2. No other assertion changes.
2. `it('says a welcome was posted when it posts one')`: `messages: { g: greeting }` (session snapshot `'Old'`, project welcome `'Fresh welcome'`). Expect the call to resolve to `{ result: 'applied', welcomePosted: true }` (`toEqual`).
3. `it('says no welcome was posted when it only re-arms the conversation')`: `sessions: { s1: { ...activeSession, welcome_message: 'Fresh welcome' } }`, `messages: { m: makerEarly, g: greeting }`. Expect `{ result: 'applied', welcomePosted: false }`, and the greeting deleted (as today).
4. `it('never says a welcome was posted when it did not apply')`: the `no_session` setup of the first test and the `maker_replied` setup of the second. Expect `welcomePosted: false` for both.

In `update-delete-project.test.ts`:
1. `mockApplyImport` default (`:5`) becomes `vi.fn(async () => ({ result: 'applied', welcomePosted: true }))`. Every `mockResolvedValueOnce('<value>')` becomes `mockResolvedValueOnce({ result: '<value>', welcomePosted: false })`, except `'applied'` at `:312`, which becomes `{ result: 'applied', welcomePosted: true }`.
2. `'PATCH logs the import outcome (no emails, no content)'` (`:289`): expect `{ project_id: 'proj-1', result: 'maker_replied', welcome_posted: false }`.
3. New `it('PATCH answers whether the import posted a welcome')`: mock `{ result: 'applied', welcomePosted: false }` → the JSON has `import_applied: 'applied'` and `import_welcome_posted: false`; then mock `{ result: 'applied', welcomePosted: true }` → `import_welcome_posted: true`.
4. Extend `'PATCH answers import_applied null when the import step threw'` (`:320`): also `import_welcome_posted` is `false`.
5. Extend `'PATCH without payload_pasted_at has no import_applied'` (`:328`): also no `import_welcome_posted` key.

- [ ] **Step 2: run** both files. Expect the `.result` assertions and the new tests to fail (the function still returns a string; the PATCH answers no new key).

- [ ] **Step 3: change** `apply-import.ts` and the PATCH as specified. Add one line to the function's top comment: `welcomePosted` tells the builder's header whether the conversation now opens with a welcome the maker has not answered.

- [ ] **Step 4: run** both files, then the verification. Commit: `Import: say whether it posted a welcome, and answer it from the PATCH (#293)`.

---

### Task 3: the Conversations header after a paste (#293 items 1 and 2, builder view)

Depends on Task 2. Restated interface: `PATCH /api/projects` with `payload_pasted_at` answers `import_applied: 'no_session' | 'maker_replied' | 'applied' | null` and `import_welcome_posted: boolean` (true only when the import posted a new welcome into the open conversation). Its answer also carries `updated_at`, the server time of the PATCH; when a welcome was posted, that welcome's `created_at` is the same value (the route passes `patch.updated_at` as the import's `now`, `app/api/projects/route.ts:283`).

**Files:**
- Modify: `lib/sessions/maker-replied.ts` (new export)
- Modify: `lib/sessions/__tests__/maker-replied.test.ts`
- Modify: `components/builder/BuilderProjectView.tsx`: `ImportedPayload` (`:97-101`), `savePayload` (`:750-850`), `importWarnings` (`:532`, `:844`, `:989-991`), `StatusStrip` (`:1226-1242`), `StartDispatch` auto-open (`:1838-1847`)
- Modify: `components/builder/__tests__/BuilderProjectView.dispatch.test.tsx`

**What is wrong today, from the code.**

1. Item 1. In `StatusStrip`, `const makerAnswered = importApplied ? false : ...` (`:1235`). While the banner is up (`justImported` is set until it is dismissed or the Start window is closed) and the server said `'applied'`, `makerAnswered` is `false` whatever the messages say. If the maker answers the new welcome while the builder looks at the page, the realtime listener updates the messages, but the header stays on Nudge until the banner is dismissed. Confirmed by reading: nothing in the override looks at a message. The new test 1 below fails on today's code for exactly this reason (it renders with the banner up, adds a maker message after the import time to the messages query, and today's header stays on Nudge).
2. Item 2. The same override applies when the import only re-armed the conversation (no welcome posted). If the maker had spoken earlier, the messages say "answered" (no tagged welcome; the canned greeting is ignored by `makerAnsweredOpening`), so the header shows Nudge while the banner is up and Start after it is dismissed. The new test 3 below fails on today's code (it sees Nudge with the banner up).

**Wanted.**

1. `ImportedPayload` becomes:
   ```ts
   // What the builder was told after a paste, from the PATCH answer.
   // applied: the import went into the open conversation (import_applied 'applied');
   //   the banner says the config was applied to it.
   // welcomePosted: it posted a new welcome there (import_welcome_posted); the header
   //   then counts only maker messages after importedAt, since the cached messages
   //   can predate the import.
   // importedAt: the PATCH answer's updated_at (server time, same as the welcome's
   //   created_at); null when the answer had none.
   type ImportedPayload = { configUpdated: boolean; applied: boolean; welcomePosted: boolean; importedAt: string | null }
   ```
2. `savePayload`: at both places that read `res?.import_applied` (`:780` in `stampPasted`, `:815` after the config PATCH), also set `welcomePosted = res?.import_welcome_posted === true` and `importedAt = typeof res?.updated_at === 'string' ? res.updated_at : null` (declare both next to `applied`, defaults `false` and `null`). Pass all four fields to `onImported` (`:848`) and store them in `importWarnings` (its state type becomes `{ messages: string[] } & ImportedPayload`; the Continue button at `:989-991` passes the four fields on).
3. New export in `lib/sessions/maker-replied.ts`, next to `makerAnsweredOpening`:
   ```ts
   // True when some role 'user' message has created_at after `since`.
   // Asked by the builder's header right after an import posted a welcome.
   export function makerSpokeAfter(messages: ReplyCheckMessage[], since: string): boolean
   ```
   Implement it with the existing private `userMessageAfter(messages, since)`.
4. `StatusStrip`, replacing `:1226-1235` (keep the comment's reasoning, reworded):
   ```ts
   // While the banner after a paste is up and the server says the import posted
   // a welcome into the open conversation, only a maker message after the import
   // counts: the cached messages can predate it. Otherwise, the messages decide.
   const welcomeJustPosted = !!justImported?.welcomePosted && !!activeSession
   const makerAnswered = welcomeJustPosted
     ? !!activeMessages && !!justImported?.importedAt && makerSpokeAfter(activeMessages, justImported.importedAt)
     : activeMessages ? makerAnsweredOpening(activeMessages) : false
   ```
   The turn badge condition (`:1239-1242`) uses `welcomeJustPosted` where it used `importApplied`. `configNote` (`:1259-1261`) is unchanged: it still reads `justImported.applied`, which stays true in the re-arm case (the config did go to the open conversation).
5. `StartDispatch` auto-open (`:1843`): `if (justImported && !justImported.welcomePosted && !autoOpenedRef.current)`. Reason: when a welcome was posted, the header is on Nudge; if it later moves to Start because the maker answered, the builder did not ask for the Start window and it must not pop up. The ferry case (`maker_replied`, `welcomePosted: false`) still opens it, as today. Update the comment at `:1838-1841` to say so.

Nothing else in the header changes. The banner still shows only outside the Start state (`:1340`).

- [ ] **Step 1: write the failing tests.**

`maker-replied.test.ts`, new `describe('makerSpokeAfter')`:
1. `'false with no maker message after the time'`: user at `T1`, since `T2` → `false`.
2. `'true with a maker message after the time'`: user at `T3`, since `T2` → `true`.
3. `'a message at the same instant does not count'`: user at `T2`, since `T2` → `false`.
4. `'agent messages never count'`: agent at `T3`, since `T2` → `false`.
(Use the file's existing time constants, or define `T1 < T2 < T3` as UTC ISO strings.)

`BuilderProjectView.dispatch.test.tsx`:
1. Harness: add `let welcomePosted = true` (reset to `true` in `beforeEach`) and `const IMPORTED_AT = '2026-11-23T11:00:00.000Z'` (after `T4`). The PATCH answer for a body with `payload_pasted_at` becomes `{ id: 'p1', updated_at: IMPORTED_AT, import_applied: importApplied, import_welcome_posted: importApplied === 'applied' ? welcomePosted : false }`. Every existing test must still pass unchanged (check `'goes back to the messages once the banner is dismissed'`: its maker message at `T4` is before `IMPORTED_AT`, so the header is on Nudge with the banner up, and on Start after Dismiss, as it asserts).
2. New, in `describe('the banner after a paste')`, `it('moves to Start, without opening the Start window, when the maker answers the new welcome while the banner is up')`: create the `QueryClient` in the test and pass it to `pasteAndImport(client)`. Server messages: `[userMsg('m1', T1), agentMsg('m2', T2), agentMsg('w', IMPORTED_AT, 'welcome')]`. Wait for the messages fetch and 20 ms (as the other tests do). Expect a `/^Nudge/` button. Then, inside `act`, `client.setQueryData(['messages', 's1'], [...those three, userMsg('m5', '2026-11-23T11:05:00.000Z')])` (what the realtime listener does) and wait 20 ms. Expect a `/Start conversation 2/` button, no `/^Nudge/` button, and `screen.queryByRole('dialog')` to be `null`.
3. New, `it('a maker message from before the import still does not count while the banner is up')`: same as 2, but the added message is `userMsg('m5', T4)` (before `IMPORTED_AT`). Expect Nudge stays and no Start button.
4. New, `it('stays on Start through the banner when the import re-armed the conversation without posting a welcome')`: `welcomePosted = false`; server messages `[userMsg('m1', T1), agentMsg('m2', T2)]` (the greeting is gone). `pasteAndImport()`, wait as above. Expect a `/Start conversation 2/` button and no `/^Nudge/` button. The Start window opens by itself (the ferry case): expect a dialog, close it with its Close button (`screen.getByRole('button', { name: copy.modal.close })`; if more than one matches, take the one inside the dialog with `within`). Expect the `/Start conversation 2/` button still there and no Nudge.

How the tests prove the defects: test 2 fails on today's code because the override ignores the new maker message (header stays on Nudge). Test 4 fails on today's code because the override shows Nudge while the banner is up. Test 3 guards the stale-cache protection the override exists for.

- [ ] **Step 2: run** both files. Expect the four `makerSpokeAfter` tests (missing export) and dispatch tests 2 and 4 to fail.

- [ ] **Step 3: change** as specified.

- [ ] **Step 4: run** both files, then the verification. Commit: `Header after a paste: a maker reply moves it to Start, and a re-arm without a welcome follows the messages (#293)`.

**Reviewer checks:** `importedAt` comes from the server's answer, never from the browser clock (`pastedAt`); the ferry auto-open still happens for `maker_replied`; no test that passed before was weakened.

---

### Task 4: Brief-doctor reopen and archive keep the import's reminder restart (#293 item 4)

Independent.

**Files:**
- Modify: `lib/admin/session-ops.ts`
- Modify: `lib/admin/__tests__/session-ops.test.ts`
- Modify: `app/api/admin/sessions/route.ts` (`loadSessionsWithCounts` `:16-35`, its call at `:106`)
- Modify: `docs/data-model.md:8` (the `latest_session_created_at` clause)

**What is wrong today.** An import that posts a welcome into the open conversation stamps `projects.latest_session_created_at = now` (`lib/sessions/apply-import.ts:100`) to restart the automatic-reminder cadence: the cron (`app/api/cron/maker-reminders/route.ts:119`, `lib/api/reminder-cadence.ts:55-61`) skips a project whose last maker message is newer than that value. The admin Brief-doctor's `reopen_conversation` and `archive_conversation` recompute the value from session starts only (`recomputeCounters`, `lib/admin/session-ops.ts:53-61`, used by `planReopen` `:99` and `planArchive` `:137`). After either op, the value falls back to the open conversation's start, the maker's old message is newer again, and the cron stops reminding the maker about the new welcome. `enrich-projects.ts:122-131` keeps the later stored value for display, but the op overwrote it.

**Wanted.** The recompute takes each surviving session's latest opening: the later of its `created_at` and its newest `kind: 'welcome'` message (an import-posted welcome; tagged since PR #292). This reproduces exactly what the import stamped, because the import writes the welcome's `created_at` and `latest_session_created_at` from the same `now`. `planResetToFresh` (all archived, value `null`) is unchanged.

1. `PlannerSession` (`session-ops.ts:15-20`) gains `openedAt?: string | null` with the comment `// created_at of the newest kind 'welcome' message (an import re-opened the conversation); null or absent = none`.
2. `recomputeCounters` takes `Array<{ id: string; created_at: string; openedAt?: string | null }>` and computes:
   ```ts
   const latest = survivors
     .map((s) => (s.openedAt && s.openedAt > String(s.created_at) ? s.openedAt : String(s.created_at)))
     .sort()
     .at(-1)
   ```
3. Update the header comment (`:12-13`): the counters are recomputed from the surviving set, and `latest_session_created_at` includes the later opening an import posted into a conversation.
4. Route: `loadSessionsWithCounts(db, projectId, opts: { withOpenings?: boolean } = {})`. Without the option, unchanged (`count()` per session; used by GET and by the reload at the end of POST). With it, per session, read `db.collection('messages').where('session_id', '==', doc.id).get()` (the same single equality the count uses, no index), set `messageCount: snap.size`, and `openedAt` to the greatest `String(created_at)` among docs with `kind === 'welcome'`, else `null`. POST's first load (`:106`) passes `{ withOpenings: true }`. Comment why: the ops rewrite `latest_session_created_at`, and an import-posted welcome restarted the reminder cadence later than its conversation's start.
5. `docs/data-model.md:8`: after "the project list keeps the later of it and the newest session start", add "; the admin Brief-doctor's reopen and archive recompute it from session starts and import-posted welcomes, so they keep it".

- [ ] **Step 1: write the failing tests** in `session-ops.test.ts`. Extend the `sess` helper with an optional fifth argument `openedAt?: string | null` that sets the field only when given.

1. In `describe('recomputeCounters')`, `it('takes a later opening (an import-posted welcome) over a session start')`: `[{ id: 'a', created_at: '2026-01-01T00:00:00Z', openedAt: '2026-03-15T00:00:00Z' }, { id: 'b', created_at: '2026-02-01T00:00:00Z' }]` → `latest_session_created_at` `'2026-03-15T00:00:00Z'`, `session_count` 2.
2. Same describe, `it('ignores an opening earlier than its session start')`: `[{ id: 'a', created_at: '2026-02-01T00:00:00Z', openedAt: '2026-01-01T00:00:00Z' }]` → `'2026-02-01T00:00:00Z'`.
3. In `describe('planReopen')`, `it("keeps the import's restart of the open conversation")`: sessions `sess('s1', '2026-01-01T00:00:00Z', 'completed', 5)`, `sess('s2', '2026-02-01T00:00:00Z', 'active', 4, '2026-03-01T00:00:00Z')`, `sess('s3', '2026-02-15T00:00:00Z', 'active', 0)`; `planReopen({ sessions, reopenId: 's1', archiveId: 's3', now: NOW })` → `projectPatch.latest_session_created_at` `'2026-03-01T00:00:00Z'`.
4. In `describe('planArchive')`, `it("keeps the import's restart when archiving another conversation")`: sessions `sess('s1', '2026-02-01T00:00:00Z', 'active', 4, '2026-03-01T00:00:00Z')`, `sess('s2', '2026-02-15T00:00:00Z', 'active', 0)`; archive `s2` → `'2026-03-01T00:00:00Z'`.
5. Same describe, `it('drops the restart when archiving the conversation that holds it')`: same sessions; archive `s1` with `typedConfirm: 'Cafe App'`, `briefTitle: 'Cafe App'` → `'2026-02-15T00:00:00Z'`.

The route has no test file today and this task does not add one; the reviewer reads the `loadSessionsWithCounts` change against point 4.

- [ ] **Step 2: run** `npx vitest run lib/admin/__tests__/session-ops.test.ts`. Expect tests 1, 3 and 4 to fail (the opening is ignored); 2 and 5 may pass.

- [ ] **Step 3: change** as specified.

- [ ] **Step 4: run** the file, then the verification. Commit: `Brief-doctor: reopen and archive keep the reminder restart an import made (#293)`.

---

### Task 5: three tests assert what their names say (#293 item 5)

Independent. Test files only; no source change is committed.

**Files:**
- Modify: `lib/api/__tests__/enrich-latest-session.test.ts`
- Modify: `lib/builder/__tests__/reminder-line.test.ts`
- Modify: `lib/hooks/__tests__/useRealtimeMessages.test.tsx`

**What is wrong today.**

1. `enrich-latest-session.test.ts:55-66`, `'the dashboard badge says waiting on the maker in the re-opened case'`. `stubDb` (`:9-25`) returns no messages, so `enrichProjects` derives `last_maker_message_at` as `null` (`lib/api/enrich-projects.ts:37-84`) and overwrites the input's value. With no maker message the badge is "waiting" whatever `latest_session_created_at` says, so the test passes even with the stored-value keep (`enrich-projects.ts:128-131`) deleted.
2. `reminder-line.test.ts:177-179`, `'a legacy stamp (no method) still reads recorded, and an automatic one can follow it'`. It asserts only the first half.
3. `useRealtimeMessages.test.tsx:72-76`, `'asks for metadata changes, so the cache-to-server switch raises a snapshot even when no document differs'`. It checks only that the option is passed. A unit test with a mocked SDK cannot show the SDK raising that snapshot; that part was checked in a real browser by `scripts/e2e-p5-welcome-bugs.mjs` before PR #292 merged.

**Wanted.**

1. `stubDb(sessions, messages: Record<string, unknown>[] = [])`: the `messages` collection returns those rows (the stub ignores filters and limits, so both the last-message and the last-maker-message queries get them). Rewrite the badge test with `messages = [{ role: 'user', sender_email: 'maya@example.com', created_at: '2026-10-10T09:00:00.000Z' }]` and assert two things:
   1. stored `latest_session_created_at: '2026-10-17T12:00:00.000Z'` (after the maker's message) → `getTurnIndicator(p, 'builder')?.state` is `'waiting'`;
   2. the control, stored `'2026-10-09T00:00:00.000Z'` (not later than the session start `2026-10-10T00:00`), same message → `'your_turn'`.
   Also assert `p.last_maker_message_at` is `'2026-10-10T09:00:00.000Z'` in case 1, so the test fails loudly if the stub stops delivering it.
2. Add to the reminder-line test: `expect(latestReminder({ last_nudged_at: T1, last_auto_reminder_at: T2 })).toEqual({ kind: 'automatic', at: T2 })`, and the older-field fallback `expect(latestReminder({ last_nudged_at: T1, last_reminder_sent_at: T2 })).toEqual({ kind: 'automatic', at: T2 })`.
3. Rename the realtime test to `'passes includeMetadataChanges, so the SDK raises the cache-to-server switch even when no document differs'` (the body stays). Add `it('writes a server snapshot whose documents equal the cached one it follows')`: `setup()`, emit `snap(true, 'a')` → query data `undefined`; emit `snap(false, 'a')` → ids `['a']`.

- [ ] **Step 1: make the changes.** Then prove each strengthened test bites, one at a time, and restore the source after each:
   1. Delete the `if (stored && ...)` block at `lib/api/enrich-projects.ts:128-131`; the badge test's case 1 must fail. Restore.
   2. In `lib/builder/reminder-line.ts` `reminderParts`, change `autoAt && (!manual || autoAt > manual.at)` to `autoAt && !manual`; the new reminder-line assertions must fail. Restore.
   3. In `lib/hooks/useRealtimeMessages.ts`, change `if (snapshot.metadata.fromCache) return` to `if (snapshot.metadata.fromCache || snapshot.docs.length === 1) return`; the new realtime test must fail. Restore.
   `git diff --stat` must then show only the three test files.

- [ ] **Step 2: run** the three files, then the verification. Commit: `Tests: three welcome-bug tests now assert what their names say (#293)`.

---

### Task 6: the project lookup answers 404 to a viewer with no role on the brief (#291, server)

Independent.

**Files:**
- Modify: `app/api/projects/route.ts` (GET, slug branch `:74-117`)
- Modify: `app/api/projects/__tests__/get-email-in-fields.test.ts`

**What the code does today for a viewer with no access (#291's open question).** There is no 403. `GET /api/projects?slug=…` finds the project, computes `viewerRole` (`:96-98`; `getProjectRole` matches membership by `user_id` and then by email, so an invited maker who has not claimed yet does have a role), and answers 200 with the whole project document and `viewer_role: null` (`:103-116`); only the email-in fields and `last_nudged_to` are stripped (`withoutEmailInFields`, `:53-61`). So a signed-in, approved user who is not a member (never invited, removed, or signed in under another address) receives the brief's title, context, directives, welcome and requester details. The page then renders the maker view (`selectProjectView(null)` → `'maker'`, `lib/projects/project-view.ts:21-27`), whose conversations never load (`GET /api/sessions` answers 404 to no role, `app/api/sessions/route.ts:23-25`), and the auto-claim answers 403 (`app/api/projects/claim/route.ts:44-46`). That is the same stuck page as #291 plus a data exposure. The only browser consumer of this lookup is `useResolveProject` (`lib/query/hooks.ts:479-490`), used by the project page and, through `useProject`, the two views it renders after a successful lookup.

**Wanted.** A viewer with no role gets the same answer as an unknown slug: `404 { error: 'Project not found' }`. 404 and not 403, so the answer does not confirm the brief exists (the sessions route does the same). Place the check right after `viewerRole` is computed and before `getViewerMembership` (one read saved):

```ts
// No role on this brief: answer as for an unknown one, so a non-member learns
// nothing about it (not even that it exists). Admins resolve to 'admin' above;
// invited members who have not claimed yet match by email in getProjectRole.
if (!viewerRole) {
  return NextResponse.json({ error: 'Project not found' }, { status: 404 })
}
```

- [ ] **Step 1: write the failing tests** in `get-email-in-fields.test.ts`.
1. The loop at `:107` becomes `for (const role of ['maker', 'apprentice'])` (a viewer with no role no longer gets the project).
2. Add a raw helper `const getRes = (query: string) => GET(new Request(\`http://localhost/api/projects${query}\`))`.
3. New `describe('GET /api/projects?slug=: who may read one project')`:
   1. `it('answers 404 to a viewer with no role on the brief, as for an unknown one')`: `mockGetProjectRole.mockResolvedValue(null)`; `getRes('?slug=cafe')` → status 404, JSON `toEqual({ error: 'Project not found' })`.
   2. `it('answers 404 for an unknown slug')`: `getRes('?slug=nope')` → status 404, same body.
   3. `it('does not read the membership of a viewer with no role')`: as 1, then `expect(mockGetViewerMembership).not.toHaveBeenCalled()`.

- [ ] **Step 2: run** the file. Expect 1 and 3 to fail (today: 200 with the project).

- [ ] **Step 3: change** the route as specified.

- [ ] **Step 4: run** the file and `npm test` (other suites may call this GET; fix none of them by weakening the check: a test that needs the project must give its viewer a role). Then the verification. Commit: `Project lookup: a viewer with no role on the brief gets 404, as for an unknown one (#291)`.

---

### Task 7: the project page says when a brief is not found (#291, page)

Independent of Tasks 1 to 5. With Task 6 merged, a viewer with no role also gets the not-found message; without it, only unknown and deleted briefs do.

**Files:**
- Modify: `lib/query/hooks.ts` (`useResolveProject`, `:477-490`)
- Modify: `app/projects/[id]/page.tsx`
- Modify: `lib/copy.ts` (new `projectPage` group, near `dashboard` at `:149`)
- Modify: `lib/copy-maker.ts` (new `projectPage` group in `en` and `fr`)
- Create: `app/projects/[id]/__tests__/page.test.tsx`

**What is wrong today.** `useResolveProject` throws `new Error('Project not found')` on any non-OK answer (`hooks.ts:484`), and the app's default `retry: 1` (`lib/query/query-client.ts:17`) asks again: that is the "404 (twice)" in the issue. The page shows Loading while `resolving || !projectId` (`page.tsx:48`). After the error, `resolving` is false but `projectId` is still undefined, so it shows Loading forever. A 500 or a network failure ends the same way.

**Wanted.**

1. `lib/query/hooks.ts`, above `useResolveProject`:
   ```ts
   // The project lookup answered 404: no such brief, or the viewer has no role on it.
   export class ProjectNotFoundError extends Error {
     constructor() {
       super('Project not found')
       this.name = 'ProjectNotFoundError'
     }
   }
   ```
   In `useResolveProject`: `if (res.status === 404) throw new ProjectNotFoundError()` before the existing `if (!res.ok) throw new Error('Project not found')` (change that message to `'Failed to load project'`). Add `retry: (failureCount, error) => !(error instanceof ProjectNotFoundError) && failureCount < 1` (a 404 is final; anything else keeps the app's one retry).
2. Copy. `lib/copy.ts`, new group:
   ```ts
   // The project page when the brief cannot be shown (#291). Maker-facing too:
   // lib/copy-maker.ts reads these and holds the French.
   projectPage: {
     notFound: 'This brief was not found. It may have been deleted, or it was not shared with you.',
     loadFailed: 'This brief could not be loaded. Reload the page to try again.',
     backToDashboard: 'Back to your briefs',
   },
   ```
   `lib/copy-maker.ts`, `en.projectPage = { notFound: copy.projectPage.notFound, loadFailed: copy.projectPage.loadFailed, backToDashboard: copy.projectPage.backToDashboard }`; `fr.projectPage`:
   ```ts
   projectPage: {
     notFound: 'Ce brief est introuvable. Il a peut-être été supprimé, ou il n’a pas été partagé avec vous.',
     loadFailed: 'Impossible de charger ce brief. Rechargez la page pour réessayer.',
     backToDashboard: 'Retour à vos briefs',
   },
   ```
   (Typographic apostrophe `’`, as the rest of `fr`. "brief" stays in English, per the glossary.)
3. `app/projects/[id]/page.tsx`: take `error` from `useResolveProject` (`const { data: resolved, isLoading: resolving, error: resolveError } = ...`) and the `projectPage` group from `useMakerCopy()`. Before the Loading return (`:48`), add:
   ```tsx
   // The lookup failed for good (a 404 is not retried; anything else was retried once).
   if (user && approved && resolveError) {
     const notFound = resolveError instanceof ProjectNotFoundError
     return (
       <div className="min-h-screen bg-brand-cream flex items-center justify-center px-4">
         <div className="max-w-md text-center space-y-4">
           <p className="text-brand-slate">{notFound ? projectPage.notFound : projectPage.loadFailed}</p>
           <Link href="/dashboard" className="text-brand-navy underline underline-offset-2">
             {projectPage.backToDashboard}
           </Link>
         </div>
       </div>
     )
   }
   ```
   `Link` from `next/link`; `ProjectNotFoundError` from `@/lib/query/hooks`. No redirect and no retry button. The auto-claim does not run (it waits for `projectId`).

- [ ] **Step 1: write the failing tests** in `app/projects/[id]/__tests__/page.test.tsx`. Mocks (copy the shapes from `components/builder/__tests__/BuilderProjectView.dispatch.test.tsx:44-63` where they match): `@/lib/firebase/api-fetch` (`apiFetch` is a `vi.fn` the test scripts per case), `@/lib/hooks/useAuth` → `{ user: { uid: 'u1', email: 'viewer@example.com' }, loading: false, isAuthenticated: true, signOut: vi.fn() }`, `@/lib/hooks/useApproval` → `{ approved: true, loading: false }`, `next/navigation` → `useRouter: () => ({ push: vi.fn(), replace: vi.fn() })`, `useParams: () => ({ id: 'gone-brief' })`, `useSearchParams: () => new URLSearchParams('')`, and `@/components/builder/BuilderProjectView` and `@/components/maker/MakerProjectView` → components that render `null`. Render inside `new QueryClient({ defaultOptions: { queries: { retry: 1, retryDelay: 0 } } })` (the app's retry, without its delay). Count lookups as `apiFetch` calls whose URL starts with `/api/projects?slug=`.
1. `it('says the brief was not found, links to the dashboard, and asks only once on a 404')`: every lookup answers `404 { error: 'Project not found' }`. Expect `findByText(copy.projectPage.notFound)`; a link named `copy.projectPage.backToDashboard` with `href` `/dashboard`; no text `copy.loading`; after a further 50 ms, exactly 1 lookup.
2. `it('says the brief could not be loaded after one retry on a server error')`: every lookup answers `500 { error: 'boom' }`. Expect `findByText(copy.projectPage.loadFailed)` and exactly 2 lookups.
3. `it('says it in French for a French viewer')`: as test 1, rendered inside `<LocaleContext.Provider value={{ locale: 'fr', preferredLocale: 'fr', setLocale: () => {}, rememberLocale: () => {}, setBriefLanguage: () => {}, setPageLocale: () => {} }}>` (`LocaleContext` from `@/components/locale-context`). Expect `makerCopy.fr.projectPage.notFound` and the link text `makerCopy.fr.projectPage.backToDashboard`.
4. `it('still shows Loading while the lookup is pending')`: the lookup never resolves (`new Promise(() => {})`). Expect `copy.loading` and neither message.

- [ ] **Step 2: run** `npx vitest run "app/projects/[id]/__tests__/page.test.tsx"`. Expect 1 to 3 to fail (today: Loading forever, two lookups on a 404) and the copy keys to be missing.

- [ ] **Step 3: change** as specified.

- [ ] **Step 4: run** the file, `npx vitest run lib/__tests__/copy-maker.test.ts`, then the verification. Commit: `Project page: say when a brief is not found or cannot be loaded, with a link back (#291)`.

**Reviewer checks:** the French object is typed `MakerCopy` (a missing key fails type-check); a 404 is never retried and other errors are retried once; no text in the component.

---

## Verification (controller, after the tasks)

1. In the worktree: `npm test`, `npm run lint`, then the build line from Global Constraints 6, then `npm run type-check`.
2. Put the branch on preview: `git push origin welcome-followups:preview --force`, then wait for the rebuild (1 to 2 minutes; `vercel ls` or the PR's Vercel check).
3. #293 item 6, the corrected e2e-204, never run since its step 3 was fixed. The gitignored login files (`.ibuild4you-bypass`, `.test-admin-password`) live in the main checkout, and `scripts/lib/preview-login.mjs` reads them from the script's own repo root, so run the (unchanged) script from there:
   `cd /Users/nico/src/ibuild4you && node scripts/e2e-204-welcome-verbatim.mjs`
   Pass: `PASS` lines for steps 1 to 3 (first conversation opens with W1 word for word; the return conversation with a new welcome opens with W2 word for word; the return conversation with an unchanged welcome opens empty), no `FAIL` line, exit code 0, and the throwaway brief deleted at the end. Step 4 is an LLM probe that is reported, not graded. After this branch, step 2 may take the import's replace path if it pastes while conversation 1 is unanswered; it must still see W2 open conversation 2.
4. Regressions on the same preview, same way: `node scripts/e2e-p5-welcome-bugs.mjs` and `node scripts/e2e-214-stale-greeting.mjs` (both need `.test-cast-passwords.json`; they print SKIPPED without it). Pass: all checks PASS. These exercise the import end to end, now in a transaction (Task 1).
5. #291 on preview, headless (Playwright through `launchLoggedIn()` from `scripts/lib/preview-login.mjs`): open `https://preview.ibuild4you.com/projects/no-such-brief-293`. Pass: the sentence "This brief was not found. It may have been deleted, or it was not shared with you." and a "Back to your briefs" link to `/dashboard`; exactly one `GET /api/projects?slug=no-such-brief-293`, answered 404; no "Loading..." after 5 seconds. Then, signed in as a test-cast maker (`loginWithPassword`), GET `/api/projects?slug=` of a brief that identity is not a member of. Pass: 404 `{ "error": "Project not found" }`.
6. After merge, on production, watch the next F4FC paste: `vercel logs -e production --since 1h -n 2000 --json`, filter for `apply_import`. Pass: the line now carries `welcome_posted`, `result` is `applied` when the maker had not answered, and no `apply_import_failed` (a transaction that cannot commit would show there).

## Not doing

1. #293 item 6 as a task: it needs a live preview, so it is step 3 of Verification.
2. `planReopen` and `planArchive` count already-archived sessions as survivors (`session-ops.ts:96`, `:134`: they filter out only the target), though the file's header says the counters come from the non-archived set, and `enrich-projects.ts:30` excludes archived sessions. Found while planning Task 4; it is a separate bug in an admin-only tool and is not touched here. Worth its own issue.
3. A test file for `app/api/admin/sessions/route.ts`: none exists, and Task 4's route change is a small read-shape change reviewed by reading. The planner logic it feeds is tested.

## Decisions made in planning

1. **Item 2: in the re-arm case (no welcome posted), the header follows the messages, which means Start when the maker had spoken earlier.** The alternative was Nudge throughout, on the grounds that the re-armed conversation will greet the maker through the kickoff. Start agrees with `POST /api/sessions`, which treats that conversation as used, and needs no new rule. Cost if wrong: the builder is offered Start where Nudge would have done; clicking it opens conversation N+1 where the kickoff greets; the history splits across two conversations and nothing is lost.
2. **Item 1: when the maker answers the new welcome while the banner is up, the header moves to Start, and the Start window does not open by itself.** Cost if wrong: the builder clicks Start themselves.
3. **Item 1: the import time is the PATCH answer's `updated_at` (server clock), not the browser's paste time.** It equals the posted welcome's `created_at`, and maker messages are stamped by the server too. Cost if wrong: none expected; if the answer ever lacks it, the header falls back to today's override.
4. **Item 2: `applyImportToOpenSession` returns `{ result, welcomePosted }` instead of adding a fourth string value.** It keeps `import_applied` and the `apply_import` log's `result` values as they are. Cost: about twenty mechanical test edits in Task 2.
5. **Item 3 relies on Firestore's serializable transactions covering a message added to the range the import queried.** Unit tests can prove only that reads and writes go through the transaction and that a re-run re-reads. Cost if wrong: the gap stays as it is today; the change cannot make it worse. A transaction that cannot commit throws, and the PATCH already answers `import_applied: null` for that.
6. **Item 4 derives each conversation's opening from its tagged welcomes, read only in the Brief-doctor's POST.** The listing keeps `count()`. Cost: one full message read per conversation of one brief per admin op; the tool is manual and rare.
7. **#291, 403 question: the lookup gives no role a 404 (Task 6).** Today it answers 200 with the project document. This is an access-control change. Cost if wrong: a flow that needs a non-member to read a project by slug breaks; none was found (the page is the only browser consumer, invited members match by email before they claim, admins resolve to `admin`).
8. **#291: a server or network error also gets a message (`loadFailed`) after the one retry**, since the same line keeps it on Loading forever. Cost: one more string pair.
9. **#291's text is maker-facing**, so it goes in `lib/copy-maker.ts` with French, with English in `lib/copy.ts` as that file's header requires.
