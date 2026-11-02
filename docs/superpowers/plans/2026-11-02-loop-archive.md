# Loop feedback archive + delete (#232) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let admins archive (soft) and system admins delete (hard) Loop feedback, singly or in bulk, so test feedback stops cluttering the inbox.

**Architecture:** `archived_at` on the feedback doc, set through the existing PATCH; a new DELETE on the same route; list/read/prototype readers skip archived rows; the shared `FeedbackInbox` component grows checkboxes, a Show-archived toggle and a bulk bar.

**Tech Stack:** Next.js App Router API routes, Firebase Admin SDK, vitest (+ jsdom/@testing-library for components), Tailwind.

**Spec:** `docs/superpowers/specs/2026-11-02-loop-archive-design.md` (includes the controller rulings).

## Global Constraints

- `archived_at` is an ISO UTC string (`new Date().toISOString()`) or `null`/absent.
- Delete is system admin only (`hasSystemRole(auth, 'admin')`), never app owners/collaborators; never touches GitHub.
- Access for archive mirrors existing PATCH: `requireFeedbackAccess(auth, existing.project_id)`.
- Do not change the shape of `lib/feedback/READ.md` responses.
- New user-facing strings go in `lib/copy.ts` under a new `adminFeedback` section (admin screens are English only; no French twin).
- Commits end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Never commit `lib/build-info.json`.

## Review Focus

- Non-admin collaborator sends DELETE → 403, doc untouched (Task 1 test).
- PATCH `archived` with a non-boolean (e.g. `"yes"`) → 400 (Task 1 test).
- A status filter (e.g. `?status=spam`) still hides archived rows unless `include_archived=1` (Task 1 test).
- Read API page that would contain an archived row still returns `limit` live rows and a correct `has_more` (Task 2 test: archived rows are skipped exactly like spam).
- Bulk action where one request fails: the others still apply, the list refreshes, and an error line names the failure count (Task 3 test).

---

### Task 1: API — archive via PATCH, DELETE route, list hides archived

**Files:**
- Modify: `lib/types/index.ts` (`Feedback`: add `archived_at?: string | null`)
- Modify: `app/api/admin/feedback/[id]/route.ts` (PATCH `archived`; new `DELETE`)
- Modify: `app/api/admin/feedback/route.ts` (hide archived unless `include_archived=1`)
- Test: `app/api/admin/feedback/[id]/__tests__/route.test.ts`, `app/api/admin/feedback/__tests__/route.test.ts`

**Interfaces:**
- Produces: `PATCH /api/admin/feedback/[id]` body `{ archived: boolean }` → `archived_at` set to ISO now / `null`; response is the merged row as today.
- Produces: `DELETE /api/admin/feedback/[id]` → `200 { id, deleted: true }`; 401 unauthenticated, 403 non-system-admin (checked before any Firestore read), 404 missing doc. Deletes every doc in `feedback/{id}/replies` then the feedback doc.
- Produces: `GET /api/admin/feedback?include_archived=1` includes archived rows; without it rows with a truthy `archived_at` are filtered out in memory (same pattern as spam).

- [ ] **Step 1: Write failing tests** in the two test files:
  - PATCH `{ archived: true }` → `mockUpdate` called with `archived_at` matching `/^\d{4}-\d{2}-\d{2}T.*Z$/`; `{ archived: false }` → `archived_at: null`; `{ archived: 'yes' }` → 400; a collaborator (`mockRequireFeedbackAccess` resolves null, `hasSystemRole` false) may archive.
  - DELETE as admin → 200 `{ id: 'abc', deleted: true }`, reply docs and the feedback doc deleted; DELETE as non-admin → 403 and no delete call; missing doc → 404; unauthenticated → 401. Extend the `getAdminDb` mock so `doc()` also exposes `delete` and `collection('replies')` with a `get()` returning reply docs whose `ref.delete` is spied.
  - GET without the flag drops a row with `archived_at: '2026-11-01T00:00:00.000Z'`; with `?include_archived=1` keeps it; with `?status=new` (no flag) still drops it.
- [ ] **Step 2: Run** `npx vitest run app/api/admin/feedback` — expect the new tests to FAIL.
- [ ] **Step 3: Implement.** In PATCH, `'archived' in body` must be a boolean else 400 `archived must be boolean`. DELETE: auth → `hasSystemRole(auth,'admin')` else 403 → get doc (404) → delete replies (batch or per-doc) → delete doc. Comment that a linked GitHub issue is deliberately left alone. GET: read `include_archived === '1'`; comment it.
- [ ] **Step 4: Run** `npx vitest run app/api/admin/feedback` — PASS.
- [ ] **Step 5: Commit** `feat(loop): archive and delete feedback via the admin API (#232)`.

### Task 2: Other readers skip archived rows

**Files:**
- Modify: `app/api/feedback/read/route.ts` (`scanOneId`: skip archived alongside spam)
- Modify: `lib/api/prototype-feedback.ts` (drop archived rows before `summarizePrototypeFeedback`)
- Modify: `lib/feedback/READ.md` (one sentence: archived rows are not returned, like spam)
- Test: `app/api/feedback/read/__tests__/route.test.ts`, a test for `fetchPrototypeFeedback` (add `lib/api/__tests__/prototype-feedback.test.ts` if none exists)

**Interfaces:**
- Consumes: `archived_at` field from Task 1.

- [ ] **Step 1: Write failing tests:** read route — with `limit` N and an archived row among the stored rows, the response has no item with the archived id and still returns N live items / correct `has_more` (mirror the existing spam test). Prototype feedback — rows `[live, archived]` → only the live row reaches the summary.
- [ ] **Step 2: Run** `npx vitest run app/api/feedback/read lib/api` — FAIL.
- [ ] **Step 3: Implement.** Read route: `if (data.status !== 'spam' && !data.archived_at) kept.push(...)`; update the comment above `scanOneId`. Prototype feedback: filter in memory after the merge (over-fetch is acceptable: archived rows are rare); comment why.
- [ ] **Step 4: Run** the same — PASS.
- [ ] **Step 5: Commit** `feat(loop): host read API and Sam's context skip archived feedback (#232)`.

### Task 3: Inbox UI — checkboxes, Show archived, bulk bar

**Files:**
- Modify: `components/admin/FeedbackInbox.tsx`
- Modify: `app/admin/feedback/page.tsx` (pass `canDelete` = true; the page is system-admin only)
- Modify: `app/admin/apps/[slug]/page.tsx` (pass `canDelete={app.access === 'admin'}`)
- Modify: `lib/copy.ts` (new `adminFeedback` section)
- Test: `components/admin/__tests__/FeedbackInbox.test.tsx` (`// @vitest-environment jsdom`, mirror `components/builder/__tests__/*.test.tsx` setup; mock `apiFetch`, `useApps`, `next/navigation`)

**Interfaces:**
- Consumes: Task 1 API (`PATCH {archived}`, `DELETE`, `?include_archived=1`).
- Produces: `FeedbackInbox({ projectId?: string; canDelete?: boolean })` — `canDelete` defaults to false.

Copy keys (exact text) in `copy.adminFeedback`: `showArchived: 'Show archived'`, `archivedBadge: 'Archived'`, `selectRow: 'Select'`, `selectAll: 'Select all shown'`, `selectedCount: (n: number) => \`${n} selected\``, `archiveSelected: 'Archive selected'`, `unarchiveSelected: 'Unarchive selected'`, `deleteSelected: 'Delete selected'`, `confirmDelete: (n: number) => \`Delete ${n} feedback item${n === 1 ? '' : 's'} for good? This cannot be undone. Linked GitHub issues are left alone.\``, `bulkFailed: (failed: number, total: number) => \`${failed} of ${total} could not be changed.\``.

- [ ] **Step 1: Write failing component tests:** (a) each row has a checkbox; checking two shows "2 selected" and "Archive selected"; (b) "Delete selected" absent when `canDelete` is false, present when true; (c) clicking "Archive selected" sends one `PATCH` per selected id with body `{"archived":true}` then refetches the list; (d) "Delete selected" calls `window.confirm` with `confirmDelete(n)` and sends `DELETE` per id only when confirmed (no request when cancelled); (e) toggling "Show archived" refetches with `include_archived=1` and an archived row shows the "Archived" badge; with the toggle on, "Unarchive selected" sends `{"archived":false}`; (f) when one of two requests fails, the error line reads `bulkFailed(1, 2)` and the list still refetches.
- [ ] **Step 2: Run** `npx vitest run components/admin` — FAIL.
- [ ] **Step 3: Implement.** Selection is a `Set<string>` cleared after each bulk action and when filters change. Bulk requests via `Promise.allSettled` (a non-ok response counts as failed). The "Select all shown" checkbox in the bar header toggles all visible rows. Keep the existing row layout; put the checkbox at the row's left edge. Bump a refetch counter in the load effect's deps rather than duplicating the fetch.
- [ ] **Step 4: Run** `npx vitest run components/admin` — PASS; then `npm test` once.
- [ ] **Step 5: Commit** `feat(loop): bulk archive/delete and Show archived in the feedback inbox (#232)`.
