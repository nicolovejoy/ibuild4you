# Brief Patch Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A next-convo payload may carry `brief_patch` (only what changed) in place of the whole `brief`; the server merges it into the live brief and the Brief tab previews it.

**Architecture:** One pure module (`lib/brief/patch.ts`) normalizes and applies a patch; `PUT /api/briefs` uses it and then runs its existing lock, provenance, risk-owner and fold steps on the merged brief; the Brief tab uses the same module to preview. The prep tells the comms agent which form to send from the measured size.

**Tech Stack:** Next.js App Router, TypeScript, Firestore Admin SDK, React Query, vitest.

**Spec:** `docs/superpowers/specs/2026-11-18-brief-patch-design.md`. Read it first; this plan does not repeat its rules.

## Global Constraints

- Branch `feat/brief-patch` (exists, holds the spec). Work in a worktree of it.
- Test first (vitest). `npm test` for the suite; `npx vitest run <file>` for one file.
- In a worktree, a clean claim needs BOTH `npm run build` and `npm run type-check`, build first. The build needs dummy `NEXT_PUBLIC_FIREBASE_*` values in the environment (any non-empty strings). Never read or write an env file.
- All user-facing text goes in `lib/copy.ts`. No inline strings in components.
- All matching inside a patch uses `normalizeDecisionText` from `lib/api/brief-merge.ts`. Provenance keeps using `topicKey`.
- A whole `brief` paste must behave exactly as before. Existing tests stay green without edits, except the prep snapshot and prompt-text tests that task 5 changes on purpose.
- `docs/brief-curation-guide.md` and `lib/agent/curation-guide.ts` stay identical (pinned by `lib/agent/__tests__/curation-guide.test.ts`).
- Clear, plain code; comments where a rule is not obvious. No new dependencies.
- Commit after each task. End each commit message with `Co-Authored-By: Claude Fable 5.2 <noreply@anthropic.com>`.

## Review Focus

Each has a test in the task named.

1. One patch names the same decision topic twice: the last one wins and the brief holds one decision for it (task 1).
2. Wrong types inside `brief_patch` (decisions not a list, `drop` a string, a drop list holding numbers): the bad part is ignored, nothing throws (task 1). `brief_patch` itself not an object: the parser refuses with a clear error (task 3).
3. One patch drops a text and adds the same text: it ends up present once, since drops run first (task 1).
4. The live brief has no `decisions`, `open_risks`, `shipped` or `queued` keys: additions work, and `shipped`/`queued` stay absent when still empty (task 1).
5. A shipped batch with a bad date or no items is discarded by `normalizeShipped`; a patch left with nothing is a no-op, not an error (tasks 1 and 2).

---

### Task 1: The pure patch module

**Files:**
- Create: `lib/brief/patch.ts`, `lib/brief/has-content.ts`
- Modify: `lib/types/index.ts` (types below), `lib/agent/system-prompt.ts:369` and `components/builder/BuilderProjectView.tsx:2524` (each has a private `hasBriefContent`; replace both with the shared one if their bodies agree, else keep the system-prompt body as the shared one and say so in the commit)
- Test: `lib/brief/__tests__/patch.test.ts`

**Interfaces — produces:**

```ts
// lib/types/index.ts
export interface BriefPatchDrop { decisions?: string[]; features?: string[]; open_risks?: string[]; queued?: string[] }
export interface BriefPatch {
  problem?: string; target_users?: string; constraints?: string; additional_context?: string
  decisions?: BriefDecision[]            // topic, decision, locked only
  features?: string[]
  open_risks?: Array<string | BriefRisk>
  shipped?: BriefShipped[]
  queued?: string[]
  drop?: BriefPatchDrop
}
export interface BriefPatchSummary {
  fields_replaced: string[]              // names of the text fields replaced
  decisions_revised: number; decisions_added: number; decisions_dropped: number
  features_added: number; features_dropped: number
  risks_added: number; risks_changed: number; risks_dropped: number
  queued_added: number; queued_dropped: number
  shipped_added: number                  // items, not batches
}

// lib/brief/has-content.ts
export function hasBriefContent(brief: BriefContent): boolean

// lib/brief/patch.ts
export function normalizeBriefPatch(raw: unknown): BriefPatch | null   // null unless raw is a plain object
export function applyBriefPatch(live: BriefContent, patch: BriefPatch): {
  content: BriefContent
  unmatched: Required<BriefPatchDrop>    // drop entries that matched nothing, as sent
  locksTouched: string[]                 // stored topics of locked decisions a patch tried to replace or drop
  summary: BriefPatchSummary
  changed: boolean                       // false when content equals live
}
export function removedDecisionTopics(live: BriefContent | null, next: BriefContent): string[]  // for a whole rewrite
```

Decisions for the implementer:
- `normalizeBriefPatch` keeps a text field only when it is a string; decisions only with string `topic` and `decision`, keeping `locked: true` and nothing else; lists through `normalizeRisks`, `normalizeShipped`, `normalizeQueued`, features filtered to non-blank strings; drop lists filtered to non-blank strings. Unknown keys are discarded.
- `applyBriefPatch` handles locks itself: a replacement or drop aimed at a decision locked in `live` is not applied and its stored topic goes in `locksTouched` (not in `unmatched`).
- A replacement whose normalized decision text and lock flag equal the stored ones is not a revision and does not count.
- A matching risk counts as `risks_changed` only when its owner or text differs.
- `content` omits `shipped` and `queued` when empty, as `PUT /api/briefs` does today.
- `applyBriefPatch` never mutates `live`.

- [ ] **Step 1: Write the failing tests** in `lib/brief/__tests__/patch.test.ts`. One `it` per line, each asserting on `content`, `summary`, `unmatched` or `locksTouched`:
  - text field: `"constraints": "New"` replaces; `""` and `"   "` leave the field; `fields_replaced` is `['constraints']`
  - decision on a known topic sent as `"bar ranges"` against stored `"Bar Ranges"`: replaced in place, stored topic spelling kept, `decisions_revised: 1`
  - decision on a new topic: appended, `decisions_added: 1`
  - same topic twice in one patch: one decision, the last text (Review Focus 1)
  - replacement and drop aimed at a locked decision: content unchanged, `locksTouched` holds the stored topic, `unmatched.decisions` empty
  - a new decision with `locked: true` is added locked
  - feature already present as `Don’t email` sent as `Don't email`: not added, `features_added: 0`
  - risk matching an existing unowned risk, sent with `owner: 'maker'`: replaced, `risks_changed: 1`
  - shipped: item appended to the batch with the same date; new date makes a new batch; an item already in the batch is skipped; `shipped_added` counts items
  - drop a risk stored with a curly apostrophe by its straight form: removed, `risks_dropped: 1`
  - drop text matching two features: both removed
  - drop matching nothing in each of the four lists: each entry lands in `unmatched` as sent; content unchanged
  - drop and add of the same text: present once (Review Focus 3)
  - live brief with only the five required fields: decisions, risks, queued and shipped additions work; with an empty patch `content` has no `shipped` or `queued` key (Review Focus 4)
  - `{}`: `changed: false` and `content` deep-equals `live`
  - `normalizeBriefPatch`: `null`, a string and an array return `null`; `{ decisions: 'x', drop: 'y', features: [1, 'a', ' '] }` returns `{ features: ['a'] }` (Review Focus 2); a shipped batch with no items is discarded (Review Focus 5)
  - `removedDecisionTopics`: returns stored topics missing from `next`, `[]` when `live` is null
  - `hasBriefContent`: false for the all-empty brief, true when any one field has data
- [ ] **Step 2: Run** `npx vitest run lib/brief/__tests__/patch.test.ts`. Expected: fails, module not found.
- [ ] **Step 3: Implement** the types, `has-content.ts` and `patch.ts`; swap the two private `hasBriefContent` copies for the shared one.
- [ ] **Step 4: Run** the file again, then `npm test`. Expected: all pass.
- [ ] **Step 5: Commit** `feat: pure brief patch module (normalize, apply, summary)`.

---

### Task 2: `PUT /api/briefs` accepts a patch

**Files:**
- Modify: `app/api/briefs/route.ts`
- Test: `app/api/briefs/__tests__/briefs.test.ts` (follow its existing mocks)

**Interfaces:**
- Consumes: `normalizeBriefPatch`, `applyBriefPatch`, `hasBriefContent` from task 1.
- Produces: request body takes `patch` in place of `content`. Response for a patch adds `patch_summary: BriefPatchSummary` and `locks_kept: string[]`. Errors, all 400 with nothing written and nothing folded:
  - both `content` and `patch` present: `{ error: 'Send either content or patch, not both' }`
  - `patch` not a plain object: `{ error: 'patch must be an object' }`
  - no brief doc, or `!hasBriefContent(live)`: `{ error: 'patch_no_brief' }`
  - unmatched drops: `{ error: 'patch_drop_unmatched', unmatched }`

Order inside the handler for a patch: auth and role as today; parse the stamp as today; load the live brief; the no-brief check; `applyBriefPatch`; the unmatched refusal; then the existing stale-prep guard, with `briefContent` set to the merged content. `restoreLocksOnPaste` runs for a patch whether or not there is a stamp. Provenance stamping, `carryRiskOwners`, folding and `size_warning` are unchanged. The `validateBriefContent` call applies to `content` only.

No-op: when `changed` is false, skip `upsertBrief`, fold against the live doc's id, and return the live doc's `{ id, project_id, version, content, updated_at, source }` with `folded`, `folded_reports`, `size_warning`, `patch_summary`, `locks_kept`.

- [ ] **Step 1: Write the failing tests**, one `it` each:
  - both keys → 400, `upsertBrief` not called
  - patch with no brief doc → 400 `patch_no_brief`; with a doc holding empty content → same
  - unmatched drop → 400 `patch_drop_unmatched` with the entry under its list; no write, `foldNotes` not called
  - a patch replacing a locked decision, unstamped: saved content has the lock verbatim, `locks_kept` lists its topic
  - the same, stamped: same result, contest state from the live brief kept
  - provenance: an untouched decision keeps its `decided_at`; a replaced one gets `revised_at`; a new topic gets `decided_at`
  - a stamped `{}` patch: `upsertBrief` not called, response `version` equals the live version, listed notes folded
  - a patch whose only entry is a shipped batch with no items: treated as the no-op above (Review Focus 5)
  - stale stamp without `force` → 409 `stale_prep`; with `force: true` → saved
  - a whole `content` paste: response has no `patch_summary` key
- [ ] **Step 2: Run** `npx vitest run app/api/briefs/__tests__/briefs.test.ts`. Expected: the new tests fail.
- [ ] **Step 3: Implement** in `route.ts`.
- [ ] **Step 4: Run** the file, then `npm test`. Expected: all pass.
- [ ] **Step 5: Commit** `feat: PUT /api/briefs merges a brief_patch into the live brief`.

---

### Task 3: Parser, hook and import flow

**Files:**
- Modify: `lib/api/import-payload.ts`, `lib/query/hooks.ts` (`useUpdateBrief`, near line 538), `components/builder/BuilderProjectView.tsx` (`handleImportJson`, `savePayload`, lines 671-762), `lib/copy.ts`
- Test: `lib/api/__tests__/import-payload.test.ts`, a new `components/builder/__tests__/BuilderProjectView.importPatch.test.tsx` modelled on `BuilderProjectView.copyPrep.test.tsx`

**Interfaces:**
- Consumes: the route contract from task 2; `BriefPatch`, `BriefPatchSummary` from task 1.
- Produces:

```ts
// import-payload.ts: third member of NextConvoPayload
| { mode: 'patch'; patch: Record<string, unknown>; projectUpdate: Record<string, unknown>; stamp: PrepStamp | null }

// hooks.ts: useUpdateBrief variables take `content?: unknown` or `patch?: unknown` (one of them);
// result type adds `patch_summary?: BriefPatchSummary; locks_kept?: string[]`.
// A 400 with error 'patch_drop_unmatched' throws:
export class PatchDropUnmatchedError extends Error { unmatched: Required<BriefPatchDrop> }
```

Parser rules: `brief` and `brief_patch` both present → `{ ok: false, error: copy.brief.pasteBothBriefAndPatch }`. `brief_patch` present and not a plain object → `{ ok: false, error: copy.brief.pastePatchNotObject }`. `brief_patch` present → mode `patch`, with `projectUpdate` built exactly as for `multi`. Otherwise unchanged.

Import flow rules:
- Mode `patch` sends `patch`; the config PATCH and the pasted stamp work as for `multi`.
- The size warning after any import comes from the response's `size_warning`, replacing the client-side `briefSizeWarning(payload.brief)`.
- `locks_kept` non-empty adds the warning `copy.brief.patchLocksKept(topics)`.
- `PatchDropUnmatchedError` shows `copy.brief.patchDropUnmatched(unmatched)` as the paste error.
- Retry: when the brief save succeeded and the config PATCH threw, remember `{ text: pasteJson, version }` in a ref and show `copy.brief.configSaveFailedBriefSaved`. The next Import whose `pasteJson` equals the remembered text skips the brief save and reuses the version. The memory clears when the import completes or the paste text changes.

Copy (exact):
- `pasteBothBriefAndPatch`: `A payload carries either "brief" or "brief_patch", not both.`
- `pastePatchNotObject`: `"brief_patch" must be an object.`
- `patchLocksKept(topics)`: `Locked, left as it is: "A", "B".`
- `patchDropUnmatched(unmatched)`: one sentence per entry, `Not imported: no decision in the brief has the topic "X".` / `Not imported: no feature|risk|queued item in the brief reads "X".`, then `If this payload was already imported, the brief is saved: remove "brief_patch" from the JSON to import the rest.`
- `patchNoBrief` (for error `patch_no_brief`): `This project has no brief yet. The first one must be a whole "brief".`
- `configSaveFailedBriefSaved`: `The brief is saved, but the rest of the payload was not. Click Import again to retry the rest.`

- [ ] **Step 1: Write the failing tests.** Parser: patch mode with stamp and config fields; both keys refused; `brief_patch: "x"` and `brief_patch: []` refused (Review Focus 2); whole-brief and legacy brief-only payloads parse as before. Component: importing a patch payload calls `PUT /api/briefs` with `patch` and no `content`; a response with `locks_kept: ['T']` shows the lock warning; a `patch_drop_unmatched` response shows the unmatched text; after a saved brief and a failed config PATCH, a second Import click sends only the PATCH.
- [ ] **Step 2: Run** both test files. Expected: the new tests fail.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** both files, then `npm test`. Expected: all pass.
- [ ] **Step 5: Commit** `feat: Brief tab imports a brief_patch payload`.

---

### Task 4: The preview line under the paste box

**Files:**
- Modify: `components/builder/FerryDesk.tsx` (beside `pasteVersionLine`, near line 119), `components/builder/BuilderProjectView.tsx` (pass the live brief content to `FerryDesk`), `lib/copy.ts`
- Test: `components/builder/__tests__/FerryDesk.test.tsx`

**Interfaces:**
- Consumes: `normalizeBriefPatch`, `applyBriefPatch`, `removedDecisionTopics` (task 1); the `patch` parser mode (task 3).
- Produces: `FerryDesk` takes a new prop `briefContent: BriefContent | null`. New copy:
  - `patchPreview(summary: BriefPatchSummary): string`: `Changes: ` then the non-zero groups joined with ` · `, each group listing its non-zero counts with commas. Groups in order: decisions (`2 decisions revised, 1 added, 1 dropped`), risks (`1 risk added, 1 changed, 1 dropped`), features, queued, shipped (`2 shipped items added`), fields (`constraints replaced`). Singular and plural by count. All zero: `Changes: none. The notes still fold.`
  - `wholeRewriteRemoves(topics: string[])`: `Whole rewrite: removes 3 decisions: "A", "B", "C"`. Not shown when the list is empty.
  - The unmatched and locked lines reuse `patchDropUnmatched` (its first sentences only, prefixed `Will not import:` in place of `Not imported:`; add a `preview: boolean` parameter) and `patchLocksKept`.

Shown only when the paste box holds JSON that parses and `briefContent` is not null. The unmatched and locked lines use the same warning style as the stale version line. A patch pasted when `briefContent` is null shows `copy.brief.patchNoBrief`.

- [ ] **Step 1: Write the failing tests:** a patch payload shows the `Changes:` line with the right counts; an unmatched drop shows `Will not import: no risk in the brief reads "…".`; a patch aimed at a locked topic shows the locked line; a whole-brief payload missing two stored decisions shows the `Whole rewrite:` line naming them; a whole-brief payload that keeps every decision shows no such line; an empty box shows none of these.
- [ ] **Step 2: Run** `npx vitest run components/builder/__tests__/FerryDesk.test.tsx`. Expected: the new tests fail.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the file, then `npm test`. Expected: all pass.
- [ ] **Step 5: Commit** `feat: preview what a pasted payload changes before import`.

---

### Task 5: The prep, the curation guide and the docs

**Files:**
- Modify: `lib/agent/next-convo-prompt.ts`, `lib/agent/curation-guide.ts`, `docs/brief-curation-guide.md`, `app/dashboard/docs/next-conversation/page.tsx`, `docs/project-setup-json.md`, `lib/copy.ts` (`briefOverSizeLimit`, line 181)
- Test: `lib/agent/__tests__/next-convo-prompt.test.ts`, `lib/agent/__tests__/prep-prompts-snapshot.test.ts` (update the snapshot on purpose), `lib/agent/__tests__/curation-guide.test.ts`, `lib/api/__tests__/import-payload.test.ts` (the schema lockstep check, if it reads the prompt's schema)

**Interfaces — produces:**

```ts
// next-convo-prompt.ts
export function prepModeLine(brief: BriefContent | null): string
```

Exact lines, chosen by `hasBriefContent` and `briefSizeChars` against `BRIEF_CHAR_BUDGET` (20,000) and the 80% mark (16,000):
- no brief or empty: `No brief yet: send the whole "brief".`
- over 20,000: `Over budget: this round, send the whole "brief", rewritten and trimmed to fit.`
- 16,000 to 20,000: `Under budget, but close: send "brief_patch", and drop before you add.`
- under 16,000: `Under budget: send "brief_patch".`

The line goes in the `<current_brief>` block directly under the size sentence.

Prompt changes (`NEXT_CONVO_SYSTEM_PROMPT`), wording in the style already there:
- The curation paragraph: send what this round changes as `brief_patch`; everything left out stays as it is. Send the whole `brief` instead, rewritten, when the `<current_brief>` block says so or when the builder asks for a compaction in this chat. Never both.
- The schema example shows `brief_patch` (the shape in the spec, including `drop`) and one line stating that `brief` takes the same nine fields whole.
- A rule set for `brief_patch`, covering every merge rule in the spec: text fields replace and an empty string does nothing; a decision is restated whole under its exact topic; features, risks, queued and shipped add; `drop` removes by exact topic or text; to reword a feature or risk, drop and add; a settled risk is dropped only after its answer is added; a queued item that shipped is dropped from `queued` and added to `shipped`; a drop that matches nothing refuses the whole payload, so copy drop texts from the brief.
- The locked rule for a patch: do not include a locked decision in `brief_patch` at all; the existing verbatim rule stays for a whole `brief`.
- Rules that said "anything you leave out is gone" now say it of a whole `brief` only.

Curation guide: a new section `Patch or whole rewrite` (when each is sent, and that only a whole rewrite merges, compacts or removes shipped batches), and the `Always carry "shipped" and "queued" forward` line scoped to a whole rewrite. Same text in both copies.

`briefOverSizeLimit` gains a closing sentence: `The next prep will ask for a whole rewrite.`

The docs page and `docs/project-setup-json.md` each gain the `brief_patch` shape and a short statement of the merge rules, the refusals and the lock rule.

- [ ] **Step 1: Write the failing tests:** `prepModeLine` returns each of the four lines at 0, 15,999, 16,000, 20,000 and 20,001 characters (build briefs of those sizes by padding `problem`); `buildNextConvoUserContent` contains the line inside `<current_brief>`; the system prompt contains `"brief_patch"` and `"drop"` and no longer contains `Always include the whole \`brief\``; the guide contains `Patch or whole rewrite`.
- [ ] **Step 2: Run** the three agent test files. Expected: new tests fail; the snapshot test fails after step 3, not before.
- [ ] **Step 3: Implement**, then update the snapshot with `npx vitest run lib/agent/__tests__/prep-prompts-snapshot.test.ts -u` and read the diff to confirm it holds only the intended changes.
- [ ] **Step 4: Run** `npm test`. Expected: all pass.
- [ ] **Step 5: Commit** `feat: the prep asks for a brief_patch, or a whole rewrite when over budget`.

---

### Task 6: Verify and ship

- [ ] **Step 1:** In the worktree, with dummy `NEXT_PUBLIC_FIREBASE_*` values set, run `npm run build`, then `npm run type-check`, `npm run lint`, `npm test`. Expected: all four clean.
- [ ] **Step 2:** Prepend an entry to `docs/changelog.md` and update CLAUDE.md's Next Steps (project 4 built; first real check is the first F4FC round after its compaction). Commit.
- [ ] **Step 3:** Push the branch and open a PR. Put it on preview: `git push origin feat/brief-patch:preview --force`.
- [ ] **Step 4:** On `preview.ibuild4you.com`, headless through `scripts/lib/preview-login.mjs`: on a test project with a brief, paste a stamped patch that revises one decision, adds one risk and drops one feature. Pass: the preview line reads `Changes: 1 decision revised · 1 risk added · 1 feature dropped`, Import succeeds, History shows one new version with exactly those changes. Then paste a patch with a drop that matches nothing. Pass: the preview says `Will not import`, Import shows the same refusal, and the version does not move.
- [ ] **Step 5:** Report the results to Nico with the PR link. Merge is his call.
