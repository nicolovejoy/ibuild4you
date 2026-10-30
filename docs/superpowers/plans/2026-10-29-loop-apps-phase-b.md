# Loop apps Phase B (access through Garm) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A person who holds owner or collaborator on a Loop app in Garm can sign into iBuild4you, see that app's feedback and act on it; owners manage the app's admins through Garm; registering an app creates the Garm app first.

**Architecture:** A new server-only Garm client for Loop's delegating key (`lib/garm-loop.ts`) wraps the five `/gnipahellir/apps…` endpoints, the grants-by-email read and an uncached check. An access module (`lib/api/app-access.ts`) turns those into decisions: every data action gates on a Garm check with `min_role` and `allowed`, never on a role string. The existing `/api/admin/apps*` and `/api/admin/feedback*` routes keep their paths and widen their gate from "system admin" to "system admin, or Garm says so for this app". Nothing stores or caches an admin list.

**Tech Stack:** Next.js App Router routes, Firebase Admin (Firestore), vitest, React Query, Tailwind.

**Spec:** `docs/superpowers/specs/2026-10-29-loop-apps-and-garm-admins-design.md` (section "Phase B"). Garm's built contract: `/Users/nico/src/garm/docs/apps.md` and `/Users/nico/src/garm/docs/consuming.md` ("Listing an email's grants", "Delegated endpoints"). Read both Garm docs before Task 1.

## Global Constraints

- Gate on `allowed` from a `/gnipahellir` check with `min_role` `"owner"` or `"collaborator"`. Never authorise by comparing role strings. Role strings may be used for display, for choosing which apps to check, and for notification recipients.
- No copy of an admin list outside Garm: no Firestore field, no module cache, nothing kept beyond the request. A cached sign-in boolean is not an admin list (Task 3).
- Garm unreachable, timed out, or answering 401/5xx → deny (fail closed) and say so. No stale fallback for access.
- The Loop key is `GARM_LOOP_KEY` (server env only; value `op://dev-secrets/garm-consumer-loop/password`, never read into the session). Base URL is the existing `GARM_URL`. 2 s timeout, `cache: 'no-store'`, like `lib/garm.ts`.
- Do not call `POST /gnipahellir/apps` for the seven live apps (musicforge, tideline, photomirande, byside, prntd, bakerylouise, l6-music); they exist in Garm already.
- Preview has no Garm wiring. When `VERCEL_ENV === 'preview'` and `GARM_LOOP_KEY` or `GARM_URL` is unset, app access resolves to "none" for non-admins and app creation skips the Garm step. Production with the key missing fails closed (503 on create, no access for non-admins).
- System admins (`hasSystemRole(auth, 'admin')`) keep full access everywhere, exactly as today, independent of Garm.
- Roles Loop grants: `owner` and `collaborator` only. `viewer` is refused with 400.
- Reader-facing strings go in `lib/copy.ts` under `adminApps` (that block is English-only today; keep it so).
- Timestamps UTC at rest.
- In the worktree, run BOTH `npm run build` and `npm run type-check` before claiming clean (CLAUDE.md). The build needs dummy `NEXT_PUBLIC_FIREBASE_*` env vars in a worktree.

## Review Focus

1. **An email with a `+`** (plus-addressed Gmail) must be percent-encoded in `grants?email=` or Garm 400s. Pinned in Task 1.
2. **A feedback row stored under a legacy slug** (`bakery-louise`) must authorise against the canonical app (`bakerylouise`), not 403. Pinned in Task 4.
3. **A collaborator calling an owner-only action** (admins list, grant, revoke) gets 403 from us, before any Garm write call. Pinned in Task 6.
4. **The last owner removing themselves:** Garm's 409 surfaces as a readable "last owner" message, not a generic error. Pinned in Task 6.
5. **Garm down during sign-in for a Loop-only person:** they get the not-approved answer, not a 500, and an iBuild4you member is unaffected (their ibuild4you check comes first). Pinned in Task 3.

---

### Task 1: Loop's Garm client

**Files:**
- Create: `lib/garm-loop.ts`
- Test: `lib/__tests__/garm-loop.test.ts`

**Interfaces:**
- Produces:
  - `type LoopRole = 'owner' | 'collaborator' | 'viewer'`
  - `class GarmLoopError extends Error { status: number | null }` — `status` is Garm's HTTP status, or `null` for timeout/network/unconfigured.
  - `loopGarmConfigured(): boolean` — `GARM_URL` and `GARM_LOOP_KEY` both set.
  - `loopGarmBypassed(): boolean` — `VERCEL_ENV === 'preview' && !loopGarmConfigured()`.
  - `loopCheck(email: string, slug: string, minRole: 'owner' | 'collaborator'): Promise<boolean>` — `POST /gnipahellir` with the loop key; true only when `allowed === true`; any error → false (never throws). No cache.
  - `listGrantsForEmail(email: string): Promise<Array<{ project: string; role: LoopRole }>>` — `GET /gnipahellir/grants?email=<encodeURIComponent(normalized)>`; throws `GarmLoopError` on failure.
  - `listDelegableApps(): Promise<Array<{ slug: string; display_name: string }>>` — `GET /gnipahellir/apps`; throws.
  - `listAppGrants(slug: string): Promise<Array<{ email: string; role: LoopRole; created_at: string; created_by: string }>>` — `GET /gnipahellir/apps/<slug>/grants`; throws (404 included).
  - `createGarmApp(actor: string, slug: string, displayName: string): Promise<void>` — `POST /gnipahellir/apps {actor, slug, display_name}`; 201 → resolve; else throw.
  - `grantOnApp(actor: string, slug: string, email: string, role: 'owner' | 'collaborator'): Promise<void>` — `POST /gnipahellir/apps/<slug>/grants {actor, email, role}`; 200 → resolve; else throw.
  - `revokeOnApp(actor: string, slug: string, email: string): Promise<void>` — `DELETE /gnipahellir/apps/<slug>/grants {actor, email}`; 200 → resolve; else throw.
  - All emails pass through `normalizeEmail` (`lib/email/normalize`). All requests send `authorization: Bearer ${GARM_LOOP_KEY}`, `content-type: application/json` when there is a body, `cache: 'no-store'`, `signal: AbortSignal.timeout(2000)`. Unconfigured → throw `GarmLoopError(status null)` (or `false` for `loopCheck`) without fetching. Never log the key or an email.

- [ ] **Step 1: Write failing tests** in `lib/__tests__/garm-loop.test.ts`, stubbing `global.fetch` with `vi.fn()` and setting `process.env.GARM_URL = 'https://garm.test'`, `GARM_LOOP_KEY = 'garm_loop_test'` in `beforeEach`:
  - `loopCheck` posts `{ email: 'a@b.com', project: 'tideline', min_role: 'owner' }` to `https://garm.test/gnipahellir` with the bearer header; returns true for `{allowed:true}`, false for `{allowed:false}`, false for `{allowed:'yes'}`, false when fetch rejects, false on a 500, and makes no fetch when `GARM_LOOP_KEY` is unset.
  - `loopCheck` called twice makes two fetches (no cache).
  - `listGrantsForEmail('Sam+x@Example.com')` requests `https://garm.test/gnipahellir/grants?email=sam%2Bx%40example.com` and returns the `grants` array.
  - `listAppGrants('tideline')` returns `grants`; a 404 throws `GarmLoopError` with `status === 404`.
  - `grantOnApp('o@x.com','tideline','N@X.com','collaborator')` posts body `{actor:'o@x.com', email:'n@x.com', role:'collaborator'}` to `/gnipahellir/apps/tideline/grants`; a 409 throws with `status === 409`; a 403 throws with `status === 403`.
  - `revokeOnApp` sends `DELETE` with body `{actor, email}`.
  - `createGarmApp` posts `{actor, slug, display_name}` and resolves on 201; throws `status 409` on 409.
  - A fetch that rejects (timeout) makes `listDelegableApps` throw `GarmLoopError` with `status === null`.
  - `loopGarmBypassed()` is true only with `VERCEL_ENV='preview'` and the key unset.

- [ ] **Step 2: Run** `npx vitest run lib/__tests__/garm-loop.test.ts` — expect FAIL (module missing).
- [ ] **Step 3: Implement** `lib/garm-loop.ts` with a header comment in the style of `lib/garm.ts` stating the trust posture (key can act as any owner; server-only) and THE ONE RULE.
- [ ] **Step 4: Run** the test file — expect PASS.
- [ ] **Step 5: Commit** `feat(loop): Garm client for Loop's delegating key`.

### Task 2: App access decisions

**Files:**
- Create: `lib/api/app-access.ts`
- Test: `lib/api/__tests__/app-access.test.ts`

**Interfaces:**
- Consumes: Task 1 (`loopCheck`, `listGrantsForEmail`, `loopGarmBypassed`, `loopGarmConfigured`); `findAppBySlug` from `lib/api/apps.ts`; `AuthSuccess`, `hasSystemRole`, `getAdminDb` from `lib/api/firebase-server-helpers.ts`.
- Produces:
  - `type AppAccess = 'admin' | 'owner' | 'collaborator' | null` — `'admin'` means system admin.
  - `appAccessFor(auth: AuthSuccess, slug: string): Promise<AppAccess>` — admin → `'admin'`; unconfigured/bypassed → `null`; else `loopCheck(email, slug, 'owner')` true → `'owner'`, else `loopCheck(email, slug, 'collaborator')` true → `'collaborator'`, else `null`. `slug` must be the canonical app slug.
  - `requireAppAccess(auth: AuthSuccess, slug: string, min: 'owner' | 'collaborator'): Promise<NextResponse | null>` — `null` when allowed (admin always allowed; `'owner'` satisfies `'collaborator'`), else `NextResponse.json({ error: 'Forbidden' }, { status: 403 })`.
  - `accessibleApps(auth: AuthSuccess): Promise<Array<{ app: App; access: Exclude<AppAccess, null> }>>` — admin → every Firestore `apps` row with `'admin'`. Otherwise: `listGrantsForEmail` (on throw → `[]`), keep projects whose role is owner or collaborator and that have a Firestore `apps` row, then confirm each with `appAccessFor`; drop any that come back `null`. Sorted by `app.name`.
  - `hasAnyAppAccess(email: string): Promise<boolean>` — for the sign-in gate (no `AuthSuccess` yet): bypassed/unconfigured → false; `listGrantsForEmail` (throw → false); candidates = owner/collaborator projects with a Firestore `apps` doc (`doc(slug).get().exists`); return true at the first candidate where `loopCheck(email, slug, 'collaborator')` is true; else false.

- [ ] **Step 1: Write failing tests** mocking `@/lib/garm-loop` and Firestore (follow the `vi.mock('@/lib/api/firebase-server-helpers', …)` pattern in `app/api/admin/apps/__tests__/route.test.ts`):
  - admin auth → `appAccessFor` returns `'admin'` and `loopCheck` is never called.
  - non-admin, `loopCheck(owner)` true → `'owner'`; owner false + collaborator true → `'collaborator'`; both false → `null`.
  - `requireAppAccess(..., 'owner')` for a collaborator returns a 403 response; for an owner returns null.
  - `accessibleApps` for a non-admin with grants `[{project:'tideline',role:'owner'},{project:'rock-art',role:'owner'},{project:'byside',role:'viewer'}]` and Firestore apps `tideline`, `byside` returns only tideline with `access:'owner'` (rock-art has no app row; byside is viewer).
  - `accessibleApps` drops an app whose `loopCheck` both come back false even though the grants list said owner.
  - `accessibleApps` returns `[]` when `listGrantsForEmail` throws.
  - `hasAnyAppAccess` returns false when bypassed, false when `listGrantsForEmail` throws, true for a collaborator grant on an app with a Firestore row whose check passes, false when the only grant is on a slug with no app row.
- [ ] **Step 2: Run** `npx vitest run lib/api/__tests__/app-access.test.ts` — FAIL.
- [ ] **Step 3: Implement** `lib/api/app-access.ts`.
- [ ] **Step 4: Run** — PASS.
- [ ] **Step 5: Commit** `feat(loop): app access decisions through Garm`.

### Task 3: Sign-in admits app owners and collaborators

**Files:**
- Modify: `app/api/approved-emails/route.ts` (GET)
- Test: `app/api/approved-emails/__tests__/app-admit.test.ts`

**Interfaces:**
- Consumes: `hasAnyAppAccess(email)` (Task 2).
- Produces: `GET /api/approved-emails` answers `{ approved: true }` for an email that passes `isApprovedEmail` OR `hasAnyAppAccess`. `isApprovedEmail` itself is unchanged (integration auth and others keep today's meaning).

- [ ] **Step 1: Write failing tests** (mock `isApprovedEmail` and `hasAnyAppAccess`, follow `deny-recorder.test.ts` mocks):
  - approved by `isApprovedEmail` → `hasAnyAppAccess` not called, `approved:true`.
  - `isApprovedEmail` false, `hasAnyAppAccess` true → `approved:true`, and `scheduleGarmDenialRecord` NOT called.
  - both false → `approved:false` and the denial recorder IS called.
  - `hasAnyAppAccess` rejects → `approved:false`, status 200 (Review Focus 5).
  - two calls within 60 s for the same app-only email call `hasAnyAppAccess` once (cache hit); a `false` answer is not cached.
- [ ] **Step 2: Run** — FAIL.
- [ ] **Step 3: Implement.** In GET: `approved = await isApprovedEmail(...) || (await appAdmitted(auth.email))`, where `appAdmitted` is a module-local helper with a 60 s cache of `true` answers only, keyed by normalized email, wrapping `hasAnyAppAccess` in try/catch → false. Comment: the cache holds a yes/no about one person's own sign-in, not an admin list; a revoke takes effect within 60 s, same as `garmCheck`. Keep the name/role upsert running for any approved user.
- [ ] **Step 4: Run** this file plus the other `app/api/approved-emails/__tests__` files — PASS.
- [ ] **Step 5: Commit** `feat(loop): app owners and collaborators can sign in`.

### Task 4: Feedback routes open to the app's people

**Files:**
- Modify: `app/api/admin/feedback/route.ts`, `app/api/admin/feedback/[id]/route.ts`, `app/api/admin/feedback/[id]/replies/route.ts`, `app/api/admin/feedback/[id]/to-github/route.ts`
- Create: `lib/api/feedback-access.ts`
- Test: the three existing `__tests__/route.test.ts` files under `app/api/admin/feedback/` plus `lib/api/__tests__/feedback-access.test.ts`

**Interfaces:**
- Consumes: `requireAppAccess` (Task 2), `findAppBySlug`.
- Produces: `requireFeedbackAccess(auth: AuthSuccess, projectId: string): Promise<NextResponse | null>` in `lib/api/feedback-access.ts` — admin → null; resolve `findAppBySlug(db, projectId)`; no app → 403; else `requireAppAccess(auth, app.slug, 'collaborator')`.

Behaviour:
- `GET /api/admin/feedback`: admin unchanged. Non-admin without `projectId` → 403. Non-admin with `projectId` → `requireFeedbackAccess`, then the existing query.
- `PATCH /api/admin/feedback/[id]`, `GET …/replies`, `POST …/to-github`: admin unchanged. Non-admin: load the row first, 404 if missing, then `requireFeedbackAccess(auth, row.project_id)`. A non-admin gets 403 (not 404) for a row on an app they don't hold, after the 404 check.

- [ ] **Step 1: Write failing tests.** Mock `@/lib/api/app-access`. For each route: non-admin collaborator on the row's app succeeds; non-admin with no access gets 403; admin path unchanged (existing tests stay green). In `feedback-access.test.ts`: a row with `project_id: 'bakery-louise'` resolves to app `bakerylouise` and `requireAppAccess` is called with `'bakerylouise'` (Review Focus 2); unknown project id → 403.
- [ ] **Step 2: Run** `npx vitest run app/api/admin/feedback lib/api/__tests__/feedback-access.test.ts` — FAIL.
- [ ] **Step 3: Implement** the helper and replace each `if (!hasSystemRole(auth, 'admin')) return 403` with the admin-or-app gate.
- [ ] **Step 4: Run** — PASS.
- [ ] **Step 5: Commit** `feat(loop): app collaborators read and act on their app's feedback`.

### Task 5: Apps routes — scoped reads, Garm-first registration

**Files:**
- Modify: `app/api/admin/apps/route.ts`, `app/api/admin/apps/[slug]/route.ts`, `lib/types/*` (where `App` lives; add `AppAccess` re-export if the client needs it)
- Test: `app/api/admin/apps/__tests__/route.test.ts`

**Interfaces:**
- Consumes: `accessibleApps`, `appAccessFor` (Task 2); `createGarmApp`, `GarmLoopError`, `loopGarmBypassed`, `loopGarmConfigured` (Task 1).
- Produces:
  - `GET /api/admin/apps` → `{ apps: Array<App & { access: 'admin' | 'owner' | 'collaborator' }> }` for anyone signed in (non-admins see only their apps; `[]` if none). Sorted by name.
  - `GET /api/admin/apps/[slug]` → `{ app: App & { access } }`; 403 when `appAccessFor` is null for a non-admin; 404 when no app.
  - `PATCH` stays admin-only, unchanged.
  - `POST` stays admin-only. Order: validate → `isSlugTaken` (Firestore) 409 → Garm step → `createApp`. Garm step: if `loopGarmBypassed()` skip; else if `!loopGarmConfigured()` → 503 `{ error: 'Garm is not configured' }`; else `createGarmApp(auth.email, slug, name)`: `GarmLoopError` 409 → 409 `{ error: 'That slug already exists in Garm' }`, 403 → 403 `{ error: 'You are not an owner of garm, so you cannot create apps' }`, anything else → 502 `{ error: 'Garm is unavailable' }`. Nothing is written to Firestore on any Garm failure. If `createApp` fails after Garm succeeded, log `[apps] garm app created but local row failed` with the slug and rethrow (Garm apps are never deleted; the admin can retry the create, which will 409 in Garm — note it in the comment).

- [ ] **Step 1: Write failing tests** (extend the existing file): non-admin GET list returns only `accessibleApps` rows with `access`; non-admin GET one with null access → 403, with `'collaborator'` → 200 and `access:'collaborator'`; POST calls `createGarmApp('admin@x.com','tideline2','Tideline 2')` before `createApp`; Garm 409 → 409 and `createApp` not called; Garm 403 → 403; Garm throw `status:null` → 502; bypassed → `createGarmApp` not called and 201; production with key unset → 503; Firestore slug taken → 409 and `createGarmApp` not called.
- [ ] **Step 2: Run** `npx vitest run app/api/admin/apps` — FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** — PASS.
- [ ] **Step 5: Commit** `feat(loop): apps visible to their people; registration creates the Garm app first`.

### Task 6: Manage admins API

**Files:**
- Create: `app/api/admin/apps/[slug]/admins/route.ts`
- Test: `app/api/admin/apps/[slug]/admins/__tests__/route.test.ts`

**Interfaces:**
- Consumes: `requireAppAccess` (Task 2); `listAppGrants`, `grantOnApp`, `revokeOnApp`, `GarmLoopError` (Task 1); `isValidEmail`, `normalizeEmail` (`lib/email/normalize`).
- Produces:
  - `GET /api/admin/apps/[slug]/admins` → `{ admins: Array<{ email, role, created_at, created_by }> }`, exactly what Garm returned, filtered to nothing. Gate: `requireAppAccess(auth, slug, 'owner')` (system admin passes).
  - `POST` `{ email, role }` → `{ ok: true }`. Gate: owner. `role` must be `'owner' | 'collaborator'` else 400; email must pass `isValidEmail` else 400. Calls `grantOnApp(auth.email, slug, normalizeEmail(email), role)`.
  - `DELETE` `{ email }` → `{ ok: true }`. Gate: owner. Calls `revokeOnApp(auth.email, slug, normalizeEmail(email))`.
  - Error map for all three: `GarmLoopError` 404 → 404 `{ error: 'App not found in Garm' }`; 403 → 403 `{ error: 'Garm says you are not an owner of this app' }`; 409 → 409 `{ error: 'last_owner' }`; 400 → 400 `{ error: 'Garm rejected the request' }`; other or null → 502 `{ error: 'Garm is unavailable' }`. Bypassed/unconfigured → 503 `{ error: 'Garm is not configured' }`.
  - The route stores nothing and sets `Cache-Control: no-store` on every response.

- [ ] **Step 1: Write failing tests:** a collaborator gets 403 on GET/POST/DELETE and no Garm write function is called (Review Focus 3); an owner's GET returns Garm's list verbatim; POST with `role:'viewer'` → 400; POST with `email:'nope'` → 400; POST passes the normalized email and the actor `auth.email`; DELETE where Garm throws 409 → 409 `{error:'last_owner'}` (Review Focus 4); Garm `status:null` → 502; responses carry `cache-control: no-store`.
- [ ] **Step 2: Run** — FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** — PASS.
- [ ] **Step 5: Commit** `feat(loop): manage an app's admins through Garm`.

### Task 7: New-feedback email goes to the app's people

**Files:**
- Modify: `app/api/feedback/route.ts` (notify block), `lib/feedback/notify-email.ts`
- Test: `app/api/feedback/__tests__/route.test.ts`, `lib/feedback/__tests__/notify-email.test.ts` (create if absent)

**Interfaces:**
- Consumes: `listAppGrants`, `loopGarmConfigured` (Task 1).
- Produces: `buildFeedbackEmail` takes a new required `appSlug: string` and links to `https://ibuild4you.com/admin/apps/<appSlug>?id=<feedbackId>` instead of `/admin/feedback?focus=`. New exported helper in `app/api/feedback/route.ts` or a small `lib/feedback/recipients.ts`: `feedbackRecipients(appSlug: string): Promise<string[]>` — configured → `listAppGrants(appSlug)` emails with role owner or collaborator, de-duplicated, unioned with `NOTIFICATION_EMAILS`; Garm throws or unconfigured → `NOTIFICATION_EMAILS` (log `[feedback] garm recipients unavailable`, no email address logged).

- [ ] **Step 1: Write failing tests:** with Garm returning `[{email:'eric@x.com',role:'owner'},{email:'v@x.com',role:'viewer'}]`, the send's `to` is `['nlovejoy@me.com','eric@x.com']` (order: NOTIFICATION_EMAILS first); Garm throwing → `to` is `NOTIFICATION_EMAILS`; `FEEDBACK_NOTIFY_SUPPRESS='on'` → no Garm call and no send; the email text contains `/admin/apps/tideline?id=`.
- [ ] **Step 2: Run** `npx vitest run app/api/feedback lib/feedback` — FAIL.
- [ ] **Step 3: Implement.** Pass the canonical `app.slug` (already resolved in the route) to both.
- [ ] **Step 4: Run** — PASS.
- [ ] **Step 5: Commit** `feat(loop): new-feedback email goes to the app's owners and collaborators`.

### Task 8: UI for app people

**Files:**
- Modify: `app/admin/apps/page.tsx`, `app/admin/apps/[slug]/page.tsx`, `app/dashboard/page.tsx`, `components/user-menu.tsx`, `lib/query/hooks.ts`, `lib/query/keys` (wherever `queryKeys` lives), `lib/copy.ts` (`adminApps`)
- Create: `components/admin/ManageAdmins.tsx`

**Interfaces:**
- Consumes: Task 5 response shapes (`access` on each app), Task 6 routes.
- Produces:
  - Hooks: `useAppAdmins(slug)`, `useGrantAppAdmin()`, `useRevokeAppAdmin()` (invalidate `queryKeys.appAdmins(slug)`). `useApps()` / `useApp()` return the `access` field.
  - `/admin/apps`: any approved user. Admin sees today's page. Non-admin sees the list of their apps (name, slug, their access) with Open links, no New app form, back link to `/dashboard`.
  - `/admin/apps/[slug]`: replace the `isAdmin` redirect with "redirect to `/dashboard` when `useApp` 403s". Settings form only when `access === 'admin'`. Feedback inbox for everyone with access. `ManageAdmins` when `access` is `'admin'` or `'owner'`.
  - `ManageAdmins`: table of email, role, added (Pacific date via `Intl.DateTimeFormat('en-US', { timeZone: 'America/Los_Angeles' })`); an add form (email, role select owner/collaborator); a Remove button per row. Errors: `last_owner` → `t.errorLastOwner`; 403 → `t.errorNotOwner`; 502/503 → `t.errorGarmDown`; else `t.errorGeneric`. A one-line note under the heading: `t.adminsNote`.
  - Dashboard + user menu: for a non-admin whose `useApps()` is non-empty, a link "Your apps" → `/admin/apps`. Admins keep their existing Admin link.
  - New copy keys under `adminApps`: `yourApps: 'Your apps'`, `accessLabel: 'Your access'`, `accessOwner: 'Owner'`, `accessCollaborator: 'Collaborator'`, `adminsHeading: 'Admins'`, `adminsNote: 'Kept in Garm. Owners can add and remove people; collaborators can read and act on feedback.'`, `addAdmin: 'Add'`, `removeAdmin: 'Remove'`, `roleOwner: 'Owner'`, `roleCollaborator: 'Collaborator'`, `emailLabel: 'Email'`, `addedLabel: 'Added'`, `errorLastOwner: 'This is the app’s last owner. Add another owner first.'`, `errorNotOwner: 'Garm says you are not an owner of this app.'`, `errorGarmDown: 'Garm is unavailable right now. Nothing was changed.'`, `noAccessApps: 'You do not administer any apps yet.'`.

- [ ] **Step 1:** Implement hooks and copy keys; `npm run type-check` passes.
- [ ] **Step 2:** Implement `ManageAdmins` and the page changes.
- [ ] **Step 3:** `npm run lint && npm run build && npm run type-check && npm test` — all pass.
- [ ] **Step 4: Commit** `feat(loop): apps pages and Manage admins for app owners`.

### Task 9: Read-only smoke, docs, env

**Files:**
- Create: `scripts/garm-loop-smoke.mjs`
- Modify: `docs/loop.md`, `lib/feedback/README.md` (only if it mentions who receives notifications), `CLAUDE.md` (Env vars: `GARM_LOOP_KEY`; Next Steps: Phase B status), `docs/changelog.md` (prepend), the spec's Phase B section (one line: "Plan: docs/superpowers/plans/2026-10-29-loop-apps-phase-b.md; host-facing read deferred")

**Interfaces:**
- Produces: `node scripts/garm-loop-smoke.mjs` reads `GARM_URL` (default `https://garm.prompt-labs.org`) and `GARM_LOOP_KEY` from env, calls only `GET /gnipahellir/apps` and `GET /gnipahellir/apps/<each>/grants`, and prints slug, display name and grant counts by role. No emails printed. Exit 1 on any non-200. Run as `op run --env-file=<a tpl with GARM_LOOP_KEY=op://dev-secrets/garm-consumer-loop/password> -- node scripts/garm-loop-smoke.mjs`; add `GARM_LOOP_KEY` to the committed ops template (`.env.ops.tpl`) so that command works.

- [ ] **Step 1:** Write the script; run it via `op run`; expect seven apps listed, each with ≥1 owner.
- [ ] **Step 2:** Docs and CLAUDE.md edits. In `docs/loop.md`: who can see an app's feedback, how to add an admin, and that the admin list lives only in Garm.
- [ ] **Step 3: Commit** `docs(loop): Phase B — access through Garm`.

## Out of scope (next plan)

- **Host-facing read** (a host backend reading its app's feedback from Loop, spec Phase B last bullet). The surface (short-lived token vs forwarded identity) needs a brainstorm with Nico; musicforge's dashboard panel waits on it.
- Removing the brief-member dual-write into Garm's `ibuild4you` project (spec non-goal).
