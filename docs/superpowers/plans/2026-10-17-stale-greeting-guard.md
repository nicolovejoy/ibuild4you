# Stale-greeting guard (#214) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When a maker opens a session before the builder has imported the next-convo payload, the agent posts a canned "nothing queued yet, I'll take notes" greeting, the builder is emailed and sees a dashboard state, and a later import cleans and re-arms the open session if the maker has not replied.

**Architecture:** One server-side predicate `isPayloadQueued(project)` (paste stamp newer than the maker's last message) is read by the kickoff route, the chat route and the import PATCH. Kickoff short-circuits the model with a canned message tagged `kind: 'unqueued_greeting'` and stamps `projects.maker_waiting_since`. The import PATCH, when it carries `payload_pasted_at`, calls `applyImportToOpenSession`, which removes that greeting, re-snapshots config, re-arms kickoff and posts a fresh welcome when one is new.

**Tech Stack:** Next.js App Router routes, Firebase Admin SDK (Firestore), Resend, vitest with the repo's hand-rolled Firestore mocks.

**Spec:** `docs/superpowers/specs/2026-10-17-stale-greeting-guard-design.md`

## Global Constraints

- Worktree: `/Users/nico/src/ibuild4you-wt-214` (branch `stale-greeting-guard`). Use absolute paths or `git -C`; never `cd` elsewhere.
- Reader-facing strings live in `lib/copy.ts` (EN) with FR twins in `lib/copy-maker.ts`, never inline in components or routes.
- Server-written fields (`maker_waiting_since`, `unqueued_notified_at`, `last_kickoff_at`, `Message.kind`) are never on the client PATCH allowlist.
- Notification failures never fail the greeting or the import (try/catch, `console.error`).
- Kickoff path never writes `last_maker_message_at`, `notify_after`, `notify_pending_since`.
- Before claiming green in a worktree run BOTH `npm run build` (with the dummy `NEXT_PUBLIC_FIREBASE_*` env from CLAUDE.md memory) AND `npm run type-check`, plus `npm run lint` and `npm test -- --run`.
- Commit after every task; commit messages end with `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.

## Review Focus

1. A brief with maker history but **no paste stamp at all** (every pre-#222 brief on prod): `isPayloadQueued` is false, so kickoff would post the canned greeting on every return visit forever. Expected: that is correct per spec only once the builder uses the ferry desk; pin with a test in Task 1 (`payload_pasted_at` undefined → false) and in Task 3 (greeting posts). Flag in the PR body that older briefs need one paste to arm.
2. `payload_pasted_at` equal to `last_maker_message_at` (same second): spec says strictly newer. Test in Task 1.
3. Two tabs kick off at once: the `last_kickoff_at` stamp precedes the canned post, and the email is gated on `unqueued_notified_at`. Task 3 tests the second call declines `already_kicked_off` and sends no second email.
4. Import PATCH when the active session has a maker message **before** the greeting (old round still active) but none after: spec says clean it. Task 5 tests "maker message older than the greeting" → cleaned.
5. Chat route must not add the "Nothing queued" block once the payload is queued even if an old greeting lingers in history. Task 4 tests queued + greeting present → no block.

---

### Task 1: `isPayloadQueued` predicate

**Files:**
- Create: `lib/sessions/queued.ts`
- Test: `lib/sessions/__tests__/queued.test.ts`

**Interfaces:**
- Produces: `export function isPayloadQueued(project: { payload_pasted_at?: string | null; last_maker_message_at?: string | null }): boolean`

- [ ] **Step 1: Write the failing tests**

```ts
import { isPayloadQueued } from '../queued'
describe('isPayloadQueued', () => {
  it('false with no paste stamp', () => expect(isPayloadQueued({ last_maker_message_at: '2026-10-17T10:00:00.000Z' })).toBe(false))
  it('false when paste is older than the last maker message', () => expect(isPayloadQueued({ payload_pasted_at: '2026-10-17T09:00:00.000Z', last_maker_message_at: '2026-10-17T10:00:00.000Z' })).toBe(false))
  it('false when paste equals the last maker message', () => expect(isPayloadQueued({ payload_pasted_at: '2026-10-17T10:00:00.000Z', last_maker_message_at: '2026-10-17T10:00:00.000Z' })).toBe(false))
  it('true when paste is newer', () => expect(isPayloadQueued({ payload_pasted_at: '2026-10-17T11:00:00.000Z', last_maker_message_at: '2026-10-17T10:00:00.000Z' })).toBe(true))
  it('true when pasted and no maker history', () => expect(isPayloadQueued({ payload_pasted_at: '2026-10-17T11:00:00.000Z' })).toBe(true))
  it('false when both absent', () => expect(isPayloadQueued({})).toBe(false))
})
```

- [ ] **Step 2: Run to verify it fails** — `npx vitest run lib/sessions/__tests__/queued.test.ts` → FAIL (module not found).
- [ ] **Step 3: Implement** in `lib/sessions/queued.ts`. ISO strings compare lexically; `null`/`undefined` paste → false; compare against `last_maker_message_at ?? ''`. Header comment: what "queued" means and who reads it (kickoff, chat, import PATCH).
- [ ] **Step 4: Run to verify it passes.**
- [ ] **Step 5: Commit** — `feat(sessions): isPayloadQueued predicate (#214)`.

### Task 2: Types, copy, and the canned greeting builder

**Files:**
- Modify: `lib/types/index.ts` (`Message`, `Session`, `Project`)
- Modify: `lib/copy.ts` (`chat`, `dashboard`), `lib/copy-maker.ts` (EN table references + FR twin)
- Create: `lib/sessions/unqueued-greeting.ts`
- Test: `lib/sessions/__tests__/unqueued-greeting.test.ts`, extend `lib/__tests__/copy.test.ts`

**Interfaces:**
- Produces: `Message.kind?: 'unqueued_greeting'`; `Session.last_kickoff_at?: string`; `Session.unqueued_notified_at?: string`; `Project.maker_waiting_since?: string | null`.
- Produces: `copy.chat.nothingQueuedGreeting(builder: string): string` (EN), `copy.chat.builderFallbackName: 'your builder'`, `copy.dashboard.turnMakerWaiting: 'Maker waiting — nothing queued'`; FR in `makerCopy.fr.chat.nothingQueuedGreeting(builder)` and `makerCopy.fr.chat.builderFallbackName: 'votre builder'`.
- Produces: `export function unqueuedGreeting(language: Locale, builderFirstName: string | null | undefined): string` in `lib/sessions/unqueued-greeting.ts` (picks EN/FR table, applies fallback name). `export async function ownerFirstName(db: Firestore, projectId: string): Promise<string | null>` — reads the `owner` row in `project_members` for the project, then `users` by that member's `email` (same lookups `app/api/projects/[id]/email/route.ts` uses), returns `first_name` or null.

- [ ] **Step 1: Write the failing tests**

```ts
// unqueued-greeting.test.ts
it('EN uses the builder name', () => expect(unqueuedGreeting('en', 'Nico')).toContain("Nico hasn't queued our next conversation yet"))
it('EN falls back to "your builder"', () => expect(unqueuedGreeting('en', null)).toContain("your builder hasn't queued"))
it('FR twin uses the name', () => expect(unqueuedGreeting('fr', 'Nico')).toMatch(/Nico/))
it('FR falls back', () => expect(unqueuedGreeting('fr', undefined)).toMatch(/votre builder/))
// copy.test.ts: add an assertion that makerCopy.fr.chat.nothingQueuedGreeting is a function and differs from EN output
```

- [ ] **Step 2: Run to verify it fails.**
- [ ] **Step 3: Implement.** EN text verbatim from the spec: `Hi — ${builder} hasn't queued our next conversation yet, so I don't have anything new to go through with you. If something's on your mind in the meantime, tell me and I'll keep notes for ${builder}.` FR twin in the register of `makerCopy.fr.chat` (use the vous form, "Sam" stays "Sam"; consult `/Users/nico/src/prompt-lab/workflow/localization/fr-glossary.md` if present). `ownerFirstName` is a small async helper with a try/catch returning null.
- [ ] **Step 4: Run tests; run `npm run type-check`.**
- [ ] **Step 5: Commit** — `feat(copy): nothing-queued greeting + types (#214)`.

### Task 3: Kickoff short-circuit + builder email

**Files:**
- Create: `lib/email/unqueued-notify.ts`
- Modify: `app/api/chat/kickoff/route.ts` (after the `debounced` guard and the `last_kickoff_at` stamp, before building Claude messages)
- Test: `app/api/chat/kickoff/__tests__/kickoff.test.ts`, `lib/email/__tests__/unqueued-notify.test.ts`
- Modify: `CLAUDE.md` env var bullet for `FEEDBACK_NOTIFY_SUPPRESS` (one sentence: also suppresses the nothing-queued email)

**Interfaces:**
- Consumes: `isPayloadQueued`, `unqueuedGreeting`, `ownerFirstName` (Tasks 1–2).
- Produces: `export function buildUnqueuedEmail({ makerName, projectTitle, slug, openedAt }: {...}): { subject: string; text: string; html: string }` — subject exactly `` `${makerName} opened "${projectTitle}" — nothing queued` ``; text: one sentence + Pacific time via `Intl.DateTimeFormat('en-US', { timeZone: 'America/Los_Angeles', dateStyle: 'medium', timeStyle: 'short' })` + the link `${process.env.NEXT_PUBLIC_APP_URL ?? 'https://ibuild4you.com'}/projects/${slug}?tab=conversations`; html via `textToEmailHtml` (`lib/email/html.ts`).
- Produces: `export async function sendUnqueuedNotification(input): Promise<boolean>` — returns false without sending when `process.env.FEEDBACK_NOTIFY_SUPPRESS === 'on'` or `RESEND_API_KEY` is unset; otherwise `new Resend(...).emails.send({ from: 'iBuild4you <noreply@ibuild4you.com>', to: NOTIFICATION_EMAILS, ... })` and returns true.
- Kickoff route behaviour when `!isPayloadQueued(projectData)`:
  1. `greeting = unqueuedGreeting(language, await ownerFirstName(db, projectId))` (language = `projectData.language ?? 'en'`).
  2. `messages.add({ session_id, role: 'agent', content: greeting, kind: 'unqueued_greeting', created_at: now, updated_at: now })`.
  3. `projects.update({ maker_waiting_since: projectData.maker_waiting_since ?? now, updated_at: now })`.
  4. If `!sessionData.unqueued_notified_at`: `sessions.update({ unqueued_notified_at: now })` then `sendUnqueuedNotification` in try/catch.
  5. Respond with the same SSE shape the model path uses: one `data: {"text": greeting}` event then `data: [DONE]`, status 200, `Content-Type: text/event-stream`. No Anthropic call, no usage accounting.

- [ ] **Step 1: Write the failing tests** in `kickoff.test.ts` using the existing `setup()` helper (add `payload_pasted_at`, `last_maker_message_at`, `language` to the project doc it builds; add a `vi.mock('resend', ...)` capturing `send` calls like `app/api/feedback/__tests__/route.test.ts`; mock `project_members` and `users` query results for `ownerFirstName`):

```ts
describe('nothing queued (#214)', () => {
  it('posts the canned greeting, tags it, skips the model, stamps maker_waiting_since, emails once', async () => {
    setup({ ...emptyReturnSession, project: { last_maker_message_at: T_MINUS_2H, payload_pasted_at: undefined } })
    const res = await POST(makeRequest({ session_id: 'sess-1' }))
    expect(await drain(res)).toContain("hasn't queued our next conversation yet")
    expect(mockAnthropicCreate).not.toHaveBeenCalled()
    const stored = addCalls.find((c) => c.collection === 'messages')!
    expect(stored.data.kind).toBe('unqueued_greeting')
    expect(updateCalls.some((u) => typeof u.maker_waiting_since === 'string')).toBe(true)
    expect(updateCalls.some((u) => 'last_maker_message_at' in u || 'notify_after' in u)).toBe(false)
    expect(resendSend).toHaveBeenCalledTimes(1)
    expect(resendSend.mock.calls[0][0].subject).toBe('Mara opened "Cafe app" — nothing queued')
  })
  it('does not email again on a session already notified', ...)        // sessionData.unqueued_notified_at set → resendSend not called, greeting still posted? No: second call must hit already_kicked_off first; set last_kickoff_at undefined but unqueued_notified_at set to pin the email gate alone
  it('suppressed under FEEDBACK_NOTIFY_SUPPRESS=on', ...)               // greeting posted, resendSend not called
  it('uses "your builder" when no owner first name', ...)
  it('queued → model path unchanged', ...)                                // payload_pasted_at newer than last_maker_message_at → mockAnthropicCreate called, no kind on the stored message
  it('paste equal to last maker message counts as not queued', ...)
  it('still declines no_maker_history before the guard', ...)           // no maker anywhere → 200 JSON decline, no canned message
})
```

- [ ] **Step 2: Run to verify they fail.**
- [ ] **Step 3: Implement** `lib/email/unqueued-notify.ts`, then the route branch. Keep the branch in a small local function `respondUnqueued()` inside the route so the model path below is untouched.
- [ ] **Step 4: Run the kickoff suite + email tests; `npm run type-check`.**
- [ ] **Step 5: Commit** — `feat(kickoff): canned greeting + builder email when nothing is queued (#214)`.

### Task 4: Chat route "Nothing queued" block + clear `maker_waiting_since`

**Files:**
- Modify: `lib/agent/system-prompt.ts` (`SystemPromptInput` gains `nothingQueued?: boolean`; `buildSystemPromptParts` pushes a volatile block)
- Modify: `app/api/chat/route.ts` (compute flag; include `maker_waiting_since: null` in the existing maker-turn project update)
- Test: `lib/agent/__tests__/system-prompt.test.ts`, `app/api/chat/__tests__/chat.test.ts`

**Interfaces:**
- Consumes: `isPayloadQueued`.
- Produces: volatile block text exactly:

```
## Nothing queued

The builder has not prepared this conversation yet. Do not run discovery or push toward decisions. Listen, take notes, reflect back what the maker says, and tell them the builder will pick it up. Keep it short.
```

- Flag rule in the route: `nothingQueued = !isPayloadQueued(projectData) && storedMessages.some((m) => m.kind === 'unqueued_greeting')`.

- [ ] **Step 1: Write the failing tests**

```ts
// system-prompt.test.ts
it('adds the Nothing queued block to the volatile part when flagged', () => {
  const parts = buildSystemPromptParts({ ...base, nothingQueued: true })
  expect(parts.volatile).toContain('## Nothing queued')
  expect(parts.stable).not.toContain('## Nothing queued')
})
it('omits it by default', () => expect(buildSystemPromptParts(base).volatile ?? '').not.toContain('Nothing queued'))
// chat.test.ts
it('passes nothingQueued only when unqueued AND a tagged greeting is in history', ...)   // assert on the buildSystemPromptParts mock's call arg
it('queued + lingering greeting → nothingQueued false', ...)
it('maker turn clears maker_waiting_since', ...)                                         // update payload includes maker_waiting_since: null
it('builder turn does not touch maker_waiting_since', ...)
```

- [ ] **Step 2: Run to verify they fail.**
- [ ] **Step 3: Implement.** The chat route already loads `storedMessages` after the project update; compute the flag there and pass it. The `maker_waiting_since: null` goes in the existing `countsAsMakerActivity(role)` update.
- [ ] **Step 4: Run both suites; `npm run type-check`.**
- [ ] **Step 5: Commit** — `feat(chat): nothing-queued prompt block; maker turn clears maker_waiting_since (#214)`.

### Task 5: Import PATCH applies to the open session

**Files:**
- Create: `lib/sessions/apply-import.ts`
- Modify: `app/api/projects/route.ts` PATCH (after `update(patch)`, when `'payload_pasted_at' in updates`)
- Test: `lib/sessions/__tests__/apply-import.test.ts`, `app/api/projects/__tests__/update-delete-project.test.ts`

**Interfaces:**
- Consumes: `welcomeToPost` (`lib/sessions/welcome.ts`), `Message.kind`.
- Produces: `export async function applyImportToOpenSession(db: Firestore, projectId: string, project: Record<string, unknown>, now: string): Promise<'no_session' | 'maker_replied' | 'applied'>`.
  - Query `sessions` where `project_id == projectId` (all statuses, needed for `earlierWelcomes`); active = the one with `status === 'active'` (if several, newest `created_at`). None → `'no_session'`.
  - Load that session's messages ordered by `created_at asc`. Find the last `kind === 'unqueued_greeting'`. If any `role === 'user'` message has `created_at` greater than that greeting's `created_at` → `'maker_replied'`. If there is no greeting at all and the session has any `role === 'user'` message → `'maker_replied'`. (A session with no greeting and no maker message, e.g. the builder clicked Start early, is still cleaned: re-snapshot + welcome.)
  - Batch: delete every `unqueued_greeting` message in the session; `sessions.update` with the five snapshot fields from `project` (`session_mode`, `seed_questions`, `builder_directives`, `welcome_message`, `identity`, only those `!== undefined`), `last_kickoff_at: null`, `unqueued_notified_at: null`, `updated_at: now`; `projects.update({ maker_waiting_since: null })`; and, if `welcomeToPost({ isFirstSession: false, welcome: project.welcome_message, earlierWelcomes: <welcome_message of every OTHER session> })` returns text, add the welcome as `{ session_id, role: 'agent', content, created_at: now, updated_at: now }`. Commit → `'applied'`.
- PATCH route: `if ('payload_pasted_at' in updates) { try { await applyImportToOpenSession(db, project_id, { ...projectDoc.data(), ...patch }, patch.updated_at as string) } catch (err) { console.error('[projects] apply_import_failed', err) } }`. The response is unchanged.
- The PATCH allowlist must NOT gain `maker_waiting_since`; add an assertion.

- [ ] **Step 1: Write the failing tests** for the helper with an in-memory Firestore mock in the style of `lib/sessions/__tests__/welcome.test.ts` / `app/api/sessions/__tests__/sessions.test.ts` (batch recording `set`/`update`/`delete`):

```ts
it('no active session → no_session, no writes')
it('maker replied after the greeting → maker_replied, no writes')
it('maker message before the greeting only → applied: greeting deleted, snapshot updated, last_kickoff_at null, maker_waiting_since null')
it('posts the new welcome when it is new for this round')
it('does not post a welcome an earlier session already used')
it('session with no greeting and no maker message → applied (re-snapshot only)')
// update-delete-project.test.ts
it('PATCH with payload_pasted_at calls applyImportToOpenSession with the merged project')   // vi.mock the helper
it('PATCH without it does not')
it('PATCH ignores maker_waiting_since from the client')
```

- [ ] **Step 2: Run to verify they fail.**
- [ ] **Step 3: Implement** helper and the route hook.
- [ ] **Step 4: Run both suites; `npm run type-check`.**
- [ ] **Step 5: Commit** — `feat(import): a later payload import cleans and re-arms the open session (#214)`.

### Task 6: Dashboard turn state

**Files:**
- Modify: `lib/turn-indicator.ts` (`TurnState` gains `'maker_waiting'`; branch before the `makerMessagedInCurrentSession` check, builder side only)
- Modify: `lib/copy-maker.ts` EN `turn.makerWaiting: copy.dashboard.turnMakerWaiting`, FR `turn.makerWaiting: 'Maker en attente — rien de prévu'`
- Test: `lib/__tests__/turn-indicator.test.ts`

**Interfaces:**
- Produces: builder viewer + `project.maker_waiting_since` set → `{ state: 'maker_waiting', label: t.makerWaiting, className: 'bg-rose-100 text-rose-700' }`. Maker viewer → unchanged result (they see the chat itself). Any dashboard grouping that switches on `TurnState` (grep `lib/dashboard/group-briefs.ts`, `app/dashboard/page.tsx`) must handle the new value by treating it like `your_turn` for sorting.

- [ ] **Step 1: Write the failing tests** — builder sees `maker_waiting` when set; maker viewer never does; `your_turn` still wins once the maker has messaged in the current session **and** `maker_waiting_since` is null (the chat route clears it); grouping helper places `maker_waiting` with `your_turn`.
- [ ] **Step 2: Run to verify they fail.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run tests; `npm run type-check`.**
- [ ] **Step 5: Commit** — `feat(dashboard): maker-waiting turn state (#214)`.

### Task 7: Preview e2e + docs

**Files:**
- Create: `scripts/e2e-214-stale-greeting.mjs`
- Modify: `CLAUDE.md` (Data Model `messages` line: `kind`; `projects`: `maker_waiting_since`; Agent Behavior "Who speaks first" paragraph: one sentence on the nothing-queued greeting), `docs/changelog.md` (prepend entry)

**Interfaces:**
- Script (pattern: `scripts/e2e-130-message-rating.mjs` for the maker login via `loginWithPassword` + `readCastPassword`): builder creates a brief via Import JSON with `requester_email: 'test-originator@ibuild4you.com'`; maker signs in, sends one message (creates maker history; `last_maker_message_at` set); builder PATCHes nothing; maker reloads after the harness forces a gap — since the 1h gap cannot be waited, drive the server directly: POST `/api/chat/kickoff` as the maker on a **new** session the builder started without importing (empty return session → kickoff fires without a gap). Grade: the stored greeting contains "hasn't queued", the message doc has `kind`, the project has `maker_waiting_since`, dashboard row shows "Maker waiting"; then builder PATCHes `payload_pasted_at` + a new `welcome_message` → greeting gone, welcome present in the same session, `maker_waiting_since` null. If `.test-cast-passwords.json` is missing, print `SKIPPED: no test cast passwords` and exit 0.
- `FEEDBACK_NOTIFY_SUPPRESS` is on for preview, so the run emails nobody.

- [ ] **Step 1: Write the script.**
- [ ] **Step 2: Run against preview after `git push origin stale-greeting-guard:preview --force` and a Ready deploy** — expected `ALL PASS` (or `SKIPPED` with the reason).
- [ ] **Step 3: Update CLAUDE.md + changelog.**
- [ ] **Step 4: Full verification in the worktree:** build (dummy env), type-check, lint, `npm test -- --run`.
- [ ] **Step 5: Commit** — `test(e2e): #214 stale-greeting walk-through; docs`.
