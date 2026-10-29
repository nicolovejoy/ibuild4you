# Loop apps, Phase A — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Loop feedback stands on its own `apps` collection, decoupled from briefs, with the seven live slugs migrated and the brief-paste registration replaced by a New-app action.

**Architecture:** One new server module, `lib/api/apps.ts`, owns the `apps` collection (lookup by slug or legacy slug, create, validate). The public ingest, the admin to-github route and the signing-secret script resolve an app through it instead of querying `projects`. A read-first migration script seeds the seven live apps from an explicit map. The admin UI gains `/admin/apps` (list + New app) and per-app feedback views; the brief Setup tab loses the Loop-only toggle. No Garm involvement in this phase.

**Tech Stack:** Next.js App Router routes, Firebase Admin SDK (`getAdminDb()`), vitest with the existing `vi.mock('@/lib/firebase/admin')` style, React Query + `apiFetch()`, Tailwind v4, copy in `lib/copy.ts` (EN + FR), Node ESM scripts under `scripts/` using `scripts/fixtures/db.mjs`.

**Spec:** `docs/superpowers/specs/2026-10-29-loop-apps-and-garm-admins-design.md` (Phase A section, migration map, and the "Decided by Nico" list).

## Global Constraints

- The feedback wire contract is unchanged: the field is still `projectId`, the error is still `404 { "error": "Unknown project" }`, and every live widget (musicforge web + iOS, tideline, photomirande, byside, prntd, bakerylouise, l6) must keep posting successfully through and after the migration.
- `feedback.project_id` keeps its name and always holds the app's **canonical** slug; a submission under a legacy slug is stored under the canonical one.
- App slugs are kebab-case (`/^[a-z0-9]+(-[a-z0-9]+)*$/`, max 64) and unique across every `apps.slug` and every `legacy_slugs` entry.
- Never store an admin list anywhere in this phase. `apps.created_by` is provenance only.
- The migration never deletes a brief; it prints the three cruft brief ids (`tideline`, `photomirande`, `musicforge`) for Nico.
- Signing secrets are copied to the slug-keyed doc; the old doc stays until a later cleanup.
- Briefs keep `projects.github_repo` (sibling decisions, #142). Only `feedback_requires_identity` leaves `projects`.
- Reader-facing strings go in `lib/copy.ts` with a French twin. Timestamps UTC at rest, Pacific on display.
- In a worktree run **both** `npm run build` and `npm run type-check` (plus `npm test`, `npm run lint`) before claiming clean; see CLAUDE.md on why either alone is a false green. The worktree needs the dummy `NEXT_PUBLIC_FIREBASE_*` env for `build`.
- Commit messages end with `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>` only if Fable wrote them; otherwise the executing model's line.

## Review Focus

1. A widget still posting the old brief slug (`byside-validate-the-buyers-offer-to-close-journey`) after migration must get `201` and a row stored under `byside`. Test in Task 3.
2. Two apps must not be able to claim the same id through `legacy_slugs` (one app's canonical slug equal to another's legacy slug). Test in Task 1 and Task 4.
3. A slug with uppercase, spaces or a trailing dash submitted to New app must be rejected with `400`, not silently normalised into a different slug than the admin typed. Test in Task 4.
4. An identity assertion signed for app `musicforge` but posted with a legacy `projectId` of another app must not verify. Test in Task 3 (the `result.project === canonical slug` check).
5. Converting a feedback row to a GitHub issue for an app with no `github_repo` must return the same `400` it does today, not a `500` from a missing `projects` doc. Test in Task 5.

---

### Task 1: `lib/api/apps.ts` — the apps module

**Files:**
- Create: `lib/api/apps.ts`
- Create: `lib/api/__tests__/apps.test.ts`
- Modify: `lib/types/index.ts` (add `App` interface next to `Feedback`, around line 232; change the `Feedback.project_id` comment to "app slug (canonical)")

**Interfaces:**
- Produces:
  - `export interface App extends BaseEntity { slug: string; name: string; github_repo?: string; feedback_requires_identity?: boolean; brief_id?: string | null; legacy_slugs?: string[]; created_by: string }` in `lib/types/index.ts`. Document id == `slug`.
  - `export const APP_SLUG_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/` and `export function isValidAppSlug(s: string): boolean` (regex + length ≤ 64).
  - `export async function findAppBySlug(db: Firestore, slugOrLegacy: string): Promise<App | null>` — doc get on `apps/{slug}` first, then `where('legacy_slugs', 'array-contains', slugOrLegacy).limit(1)`.
  - `export async function isSlugTaken(db: Firestore, slug: string): Promise<boolean>` — true if `apps/{slug}` exists or any app lists it in `legacy_slugs`.
  - `export async function createApp(db: Firestore, input: { slug: string; name: string; created_by: string; github_repo?: string; feedback_requires_identity?: boolean; brief_id?: string | null; legacy_slugs?: string[] }): Promise<App>` — throws `AppSlugInvalid` or `AppSlugTaken` (exported `class ... extends Error`); writes `created_at`/`updated_at` ISO strings; also rejects when any `legacy_slugs` entry is taken or equals `slug`.

- [ ] **Step 1: Write the failing tests** in `lib/api/__tests__/apps.test.ts`, mocking Firestore the way `app/api/feedback/__tests__/route.test.ts` does (an in-memory map behind `collection('apps').doc(id).get/set` and `where('legacy_slugs','array-contains',…).limit().get`):

```ts
it('isValidAppSlug accepts kebab-case and rejects case, spaces, dashes at ends, >64 chars')
it('findAppBySlug returns the app by canonical slug')
it('findAppBySlug returns the app by a legacy slug')
it('findAppBySlug returns null for an unknown slug')
it('createApp writes apps/{slug} with created_at and the given fields')
it('createApp throws AppSlugInvalid for "Tideline"')
it('createApp throws AppSlugTaken when the slug is another app’s canonical slug')
it('createApp throws AppSlugTaken when the slug is another app’s legacy slug')
it('createApp throws AppSlugTaken when a legacy_slugs entry is already an app slug')
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run lib/api/__tests__/apps.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement `lib/api/apps.ts` and the `App` type** per Interfaces.

- [ ] **Step 4: Run to verify they pass**

Run: `npx vitest run lib/api/__tests__/apps.test.ts`
Expected: PASS, 9 tests.

- [ ] **Step 5: Commit**

```bash
git add lib/api/apps.ts lib/api/__tests__/apps.test.ts lib/types/index.ts
git commit -m "feat(loop): apps module — slug validation, lookup by canonical or legacy slug, create"
```

---

### Task 2: Migration script `scripts/migrate-loop-apps.mjs`

**Files:**
- Create: `scripts/migrate-loop-apps.mjs`

**Interfaces:**
- Consumes: `initAdminDb()` and `findProjectBySlug(db, slug)` from `scripts/fixtures/db.mjs`.
- Produces: the seven `apps` docs in whichever Firebase project the env points at. Run read-only by default, writes only with `--apply`.

The explicit map (from the spec; do not infer):

```js
const APPS = [
  { slug: 'musicforge',   name: 'MusicForge',   cruftBrief: 'musicforge' },
  { slug: 'tideline',     name: 'Tideline',     cruftBrief: 'tideline' },
  { slug: 'photomirande', name: 'photomirande', cruftBrief: 'photomirande' },
  { slug: 'byside',       name: 'BySide',       legacy: 'byside-validate-the-buyers-offer-to-close-journey' },
  { slug: 'prntd',        name: 'PRNTD',        legacy: 'prntd-mobile-flow-rethink' },
  { slug: 'bakerylouise', name: 'Bakery Louise', legacy: 'bakery-louise' },
  { slug: 'l6-music',     name: 'L6 Music',     legacy: 'l6-shapes-positions-game' },
]
```

For each entry the script: looks up the source brief (`cruftBrief` or `legacy`) by slug; copies its `github_repo` and `feedback_requires_identity` onto the app; sets `brief_id` to the brief's doc id for `legacy` entries and `null` for cruft; sets `legacy_slugs: [legacy]` when present; copies `loop_signing_secrets/{briefDocId}` to `loop_signing_secrets/{slug}` if it exists (never deletes the source); writes `created_by: 'migration:2026-10-29'`. With `--apply` it skips an app that already exists (idempotent) and prints what it skipped. It ends by printing the three cruft brief ids under the heading `Delete by hand (Nico):`. Feedback rows under a legacy slug are **not** rewritten (the ingest stores canonical from now on; the inbox resolves legacy ids via `findAppBySlug`).

- [ ] **Step 1: Write the script** with the usage header style of `scripts/loop-secret.mjs`. Usage lines:

```
op run --env-file=.env.preview.tpl -- node scripts/with-preview-env.mjs node scripts/migrate-loop-apps.mjs
op run --env-file=.env.preview.tpl -- node scripts/with-preview-env.mjs node scripts/migrate-loop-apps.mjs --apply
```

- [ ] **Step 2: Dry run against preview**, confirm it prints seven planned writes and zero errors (missing source briefs on preview are reported per row, not fatal).

- [ ] **Step 3: Apply on preview**, re-run the dry run, confirm it reports seven `exists, skipped`.

- [ ] **Step 4: Commit**

```bash
git add scripts/migrate-loop-apps.mjs
git commit -m "feat(loop): migration script seeding the seven live apps from the brief slugs"
```

(Production run is Nico's step after the PR merges; the script prints the exact command with the ops template.)

---

### Task 3: Ingest resolves apps, not briefs

**Files:**
- Modify: `app/api/feedback/route.ts:171-205` (project lookup, title, requiresIdentity, signing-secret doc id) and `:240,:257,:277` (use canonical slug)
- Modify: `app/api/feedback/__tests__/route.test.ts` (mock `apps` instead of `projects`)
- Modify: `lib/feedback/README.md:35,65,131-132,153,168` and `docs/loop.md:39,61-64` ("app slug", lookup command)
- Modify: `scripts/loop-secret.mjs:55-62` (resolve `apps/{slug}` directly instead of looking up a brief; the secret doc id is the slug)

**Interfaces:**
- Consumes: `findAppBySlug(db, projectId)` from Task 1.
- Produces: `feedback.project_id` = `app.slug`; `loop_signing_secrets/{app.slug}` is the secret doc; `verifyIdentityAssertion(...).project` must equal `app.slug`.

- [ ] **Step 1: Update the tests.** Replace the `projects` mock with an `apps` mock exposing `doc(id).get()` and `where('legacy_slugs','array-contains',…)`. Add:

```ts
it('404 Unknown project when the slug matches no app and no legacy slug')
it('stores project_id as the canonical slug when posted under a legacy slug')
it('reads loop_signing_secrets by the canonical slug')
it('does not verify an assertion whose project is the legacy slug (must be canonical)')
it('honours apps.feedback_requires_identity')
```

- [ ] **Step 2: Run to verify the new tests fail**

Run: `npx vitest run app/api/feedback/__tests__/route.test.ts`

- [ ] **Step 3: Implement** — replace the `projects` query with `const app = await findAppBySlug(db, projectId)`; `projectTitle = app.name`; `requiresIdentity = app.feedback_requires_identity === true`; secret doc id `app.slug`; store `project_id: app.slug`; the burst query uses `app.slug`. Update the header comment (lines 15-18).

- [ ] **Step 4: Run the whole feedback suite**

Run: `npx vitest run app/api/feedback lib/feedback`
Expected: PASS.

- [ ] **Step 5: Update the two docs** so every "projects.slug" becomes "an app slug (`apps.slug`, or one of its `legacy_slugs`)" and the lookup command becomes `node scripts/with-prod-env-ro.mjs node scripts/list-apps.mjs` (Task 6 creates it).

- [ ] **Step 6: Commit**

```bash
git add app/api/feedback lib/feedback/README.md docs/loop.md
git commit -m "feat(loop): ingest resolves the app by canonical or legacy slug; feedback stores the canonical slug"
```

---

### Task 4: Admin API for apps

**Files:**
- Create: `app/api/admin/apps/route.ts` (GET list, POST create)
- Create: `app/api/admin/apps/[slug]/route.ts` (GET one, PATCH `name`, `github_repo`, `feedback_requires_identity`)
- Create: `app/api/admin/apps/__tests__/route.test.ts`
- Modify: `lib/query/hooks.ts` (add `useApps()`, `useApp(slug)`, `useCreateApp()`, `useUpdateApp()` following the existing admin hooks' shape; drop `feedback_requires_identity` from the project type at line 334)
- Modify: `app/api/projects/route.ts:193` (remove `'feedback_requires_identity'` from `allowed`) and `:377-379` (remove the create-time copy)
- Modify: `CLAUDE.md` PATCH field list and the create-payload note (remove `feedback_requires_identity`)

**Interfaces:**
- Consumes: `createApp`, `isValidAppSlug`, `findAppBySlug` from Task 1; `getAuthenticatedUser`, `hasSystemRole(auth,'admin')` as in `app/api/admin/feedback/route.ts`.
- Produces: `GET /api/admin/apps → { apps: App[] }` sorted by `name`; `POST /api/admin/apps { slug, name, github_repo?, feedback_requires_identity? } → 201 { app }`, `400 { error: 'Invalid slug' }`, `409 { error: 'Slug already in use' }`; `GET /api/admin/apps/[slug] → { app }` or 404; `PATCH → { app }`. Admin-only (403 otherwise). `created_by` = the caller's email.

- [ ] **Step 1: Write the failing route tests** (mock style of `app/api/admin/feedback/__tests__/route.test.ts`):

```ts
it('GET 403 for a non-admin')
it('GET lists apps sorted by name')
it('POST 201 creates with created_by = caller email')
it('POST 400 for slug "Tide line"')
it('POST 400 for slug "tideline-"')
it('POST 409 when the slug is an existing app’s legacy slug')
it('PATCH updates name and feedback_requires_identity, ignores slug')
```

- [ ] **Step 2: Run to verify they fail**

- [ ] **Step 3: Implement the two route files and the hooks**; remove the project-side field per Files.

- [ ] **Step 4: Run** `npx vitest run app/api/admin/apps app/api/projects` — PASS. Run `npm run type-check` — the removed field must not be referenced anywhere except `components/builder/BuilderProjectView.tsx` (Task 5 fixes that).

- [ ] **Step 5: Commit**

```bash
git add app/api/admin/apps lib/query/hooks.ts app/api/projects/route.ts CLAUDE.md
git commit -m "feat(loop): admin apps API (list, create, get, patch); feedback_requires_identity leaves projects"
```

---

### Task 5: to-github reads the app; brief Setup tab drops the Loop toggle

**Files:**
- Modify: `app/api/admin/feedback/[id]/to-github/route.ts:48-70` (resolve `findAppBySlug(db, feedback.project_id)`; title from `app.name`; `400 'App has no github_repo set'` when missing; `404 'Unknown app'` when no app)
- Modify: the to-github test (find it under `app/api/admin/feedback/[id]/` or `lib/feedback/__tests__/github.test.ts`; add the app mock)
- Modify: `components/builder/BuilderProjectView.tsx:1622-1666` (remove the `feedbackRequiresIdentity` state, its effect line and its PATCH field; keep the `github_repo` input, whose label copy should now say it feeds sibling decisions, not Loop)
- Modify: `lib/copy.ts` (the Setup-tab label text for `github_repo`, EN + FR)

**Interfaces:**
- Consumes: `findAppBySlug` (Task 1).

- [ ] **Step 1: Add the failing tests**: `it('400 when the app has no github_repo')`, `it('404 Unknown app when no app matches the feedback slug')`, `it('issue title uses apps.name')`.
- [ ] **Step 2: Run to verify they fail.**
- [ ] **Step 3: Implement** the route change and the component/copy edits.
- [ ] **Step 4: Run** `npx vitest run app/api/admin/feedback lib/feedback` and `npm run type-check` — PASS, no references to `project.feedback_requires_identity` remain (`grep -rn feedback_requires_identity components app lib` shows only `apps` code and the ingest).
- [ ] **Step 5: Commit** — `feat(loop): to-github files against the app; Setup tab drops the Loop identity toggle`

---

### Task 6: Admin UI — `/admin/apps`, per-app inbox, deep links, list script

**Files:**
- Create: `app/admin/apps/page.tsx` (list of apps: name, slug, legacy slugs, github_repo, identity flag, feedback count link; a **New app** form with slug + name + optional repo; inline error copy for 400/409)
- Create: `app/admin/apps/[slug]/page.tsx` (app header + settings form via `useUpdateApp` + the feedback list for that app, reusing the inbox list component)
- Modify: `app/admin/feedback/page.tsx` (extract the list into `components/admin/FeedbackInbox.tsx` taking `{ projectId?: string }`; support `?id=<feedbackId>` to open/scroll to one item — this is the deep link host dashboards will use; replace the free-text "Project slug" input at line 120 with a select fed by `useApps()`)
- Modify: `app/api/admin/feedback/route.ts:35` — when `projectId` is given, also match rows whose `project_id` is one of that app's `legacy_slugs` (one extra `in` query, since pre-migration rows keep the old id)
- Modify: `app/admin/page.tsx:68-96` (add the `/admin/apps` card)
- Modify: `lib/copy.ts` (every new label, EN + FR), `components/builder/*` New-brief modal link text if it mentions Loop (grep `Loop` in `components/`)
- Create: `scripts/list-apps.mjs` (slug, name, legacy_slugs, github_repo; `--grep`), same shape as `scripts/list-projects.mjs`
- Modify: `docs/loop.md` "Moving parts" table: Admin inbox → `app/admin/feedback/` + `app/admin/apps/`; the "slug must exist" section says to create the app at `/admin/apps`

**Interfaces:**
- Consumes: hooks from Task 4; `GET /api/admin/feedback?projectId=` from this task.

- [ ] **Step 1: Add the failing admin-feedback route test**: `it('projectId filter also returns rows stored under that app’s legacy slug')`.
- [ ] **Step 2: Run to verify it fails.**
- [ ] **Step 3: Implement** the route change, the components, the pages, the copy and the script.
- [ ] **Step 4: Run** `npm test`, `npm run lint`, `npm run type-check`, `npm run build` — all PASS.
- [ ] **Step 5: Preview check** (headless, `scripts/lib/preview-login.mjs`): new `scripts/e2e-loop-apps.mjs` logs in as the test admin, opens `/admin/apps`, creates app `e2e-loop-app-<ts>` and asserts the row appears, POSTs one feedback to `/api/feedback` with that slug and asserts `201`, then opens `/admin/apps/e2e-loop-app-<ts>` and asserts the row is listed; finally POSTs with slug `Tideline` and asserts `404`. Prints PASS/FAIL per check like `scripts/e2e-149-identity-relay.mjs`.
- [ ] **Step 6: Commit** — `feat(loop): /admin/apps with New app, per-app inbox, feedback deep links, list-apps script`

---

### Task 7: Docs and changelog

**Files:**
- Modify: `CLAUDE.md` — Data Model: add **apps** (one line: Loop host apps, keyed by slug, `legacy_slugs` for ids widgets still send, settings only, no admins in Phase A); Architecture Loop line points at `/admin/apps`; "MusicForge Loop project created" paragraph gets a one-line note that it is now an `apps` row; Next Steps: Phase A shipped, Phase B waits on Garm (link the spec).
- Modify: `docs/changelog.md` — prepend the entry.
- Modify: `lib/feedback/README.md` — confirm every reference from Task 3 reads right end to end.

- [ ] **Step 1: Edit the three files.**
- [ ] **Step 2: Commit** — `docs: Loop apps Phase A — apps collection, migration, admin pages`

---

### After the branch is green

Open the PR against `main` with the preview migration already applied (Task 2) and the e2e script output pasted in the description. Production steps for Nico, printed in the PR body:

```
op run --env-file=.env.ops.tpl -- node scripts/with-prod-env-ro.mjs node scripts/migrate-loop-apps.mjs
```

then the same with the writable prod env and `--apply`, then delete the three cruft briefs the script lists, then tell prompt-lab the four hosts (byside, prntd, bakerylouise, l6) can switch `projectId` to their new slugs at leisure.

## Self-review notes

- Spec coverage: apps collection (T1), ingest (T3), signing secrets by slug (T2 copy, T3 read and script), New app (T4+T6), per-app inbox + deep link (T6), migration map (T2), `feedback_requires_identity` leaves projects (T4+T5), `github_repo` stays on briefs (T5 copy change), notification email uses `apps.name` (T3 via `projectTitle`), docs (T3, T6, T7).
- Type consistency: `App`, `findAppBySlug`, `isSlugTaken`, `createApp`, `AppSlugInvalid`, `AppSlugTaken` are the only names tasks share.
- Review Focus items 1 to 5 each have a named test in T3, T1/T4, T4, T3, T5.
