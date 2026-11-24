# Invite refusal shown at once (no mutation retry where it hurts) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When the server refuses an invite in the Invite window (for example the 409 for inviting a removed member), the message appears as soon as the answer arrives, after exactly one POST. The same change stops three other mutations from repeating a request whose repeat does real harm (a second email to a maker, a second brief, a second conversation).

**Architecture:** Four mutation hooks in `lib/query/hooks.ts` get `retry: false`, with a comment each, as `useUpdateBrief` already has (`lib/query/hooks.ts:571-573`). The app-wide mutation default (`retry: 1`, `lib/query/query-client.ts:22-24`) stays as it is. No component changes: the Invite window already shows `shareProject.error.message` (`components/builder/BuilderProjectView.tsx:1636`).

**Tech Stack:** Next.js App Router, React Query 5.85.3, vitest + Testing Library, Playwright (headless) for the preview check.

**Spec:** no spec. The defect was seen in the headless pass of PR #299 (`scripts/e2e-loose-ends-298.mjs`, section I) and recorded in `docs/changelog.md` (2026-11-24, stacked modals) and the CLAUDE.md Watch line for PR #299.

## What the code does today (read before starting)

- `useShareProject` (`lib/query/hooks.ts:92-120`) has no `retry` option, so it inherits the app default `mutations: { retry: 1 }` (`lib/query/query-client.ts:22-24`). Its `mutationFn` throws a plain `Error` for any non-2xx answer (`hooks.ts:101-104`). React Query 5.85.3 retries a failed mutation after `defaultRetryDelay(0) = 1000 ms` (`node_modules/@tanstack/query-core/build/modern/retryer.js:6-8` and `:84-95`) and only then sets `error`. One refused invite is therefore two POSTs about one second apart, and the message waits for the second answer. That matches the 1.3 seconds measured on preview (1 s delay plus one round trip). The POSTs were not counted on preview; the Verification check counts them.
- `apiFetch` (`lib/firebase/api-fetch.ts`) returns the raw `Response` and never throws on a 4xx; each hook decides. Most mutation hooks throw a plain `Error` carrying only the message. Only the app-admin, key and project-email hooks throw `HttpError` with a status (`hooks.ts:1024-1031`).
- `POST /api/projects/share` (`app/api/projects/share/route.ts:22-216`) answers: 401 (no or bad token, `lib/api/firebase-server-helpers.ts:200`, `:213`), 403 (not a builder, or email unverified, `:163`, `:229`), 400 (missing `project_id` or email, invalid email, inviting yourself: route lines 29-54), 404 (project not found, 57-60), 409 (the invited person was removed from the brief, 68-74), 200 on success, and a 500 if something throws after the writes started (for example `ensureInviteResetLink`, `lib/auth/ensure-invite-account.ts`). No 4xx here is worth retrying: the same request gets the same answer. A repeat after a 500 would be safe (approved_emails is a `set`, an existing active member row is updated rather than added, the welcome is only posted to an empty session), but it is rare and the builder can press Share again.
- The only mutation with `retry: false` today is `useUpdateBrief`. The other `retry: false` lines in `hooks.ts` (1050, 1124, 1169, 1217, 1286, 1322) are on queries.
- The comment at `lib/query/query-client.ts:10-11` explains `retry: 1` by Firestore quota burn, which is about reads. React Query's own mutation default is 0; this app's 1 dates from the scaffold (`a998da0`, cloned from NoteMaxxing).

## Decision: per-hook `retry: false`, not a status-aware default

A default in `query-client.ts` that skips 4xx would only work for hooks that throw an error carrying the status, and of the 36 mutation hooks only seven (app admins, the two keys, the project email address) throw `HttpError`; the rest throw a plain `Error` or a typed one with no status, so it would mean touching all of them to fix one window. It would also keep the retry on network errors and 5xx, which is exactly the case where the hooks below must not repeat: the first request may have done its work and only the answer was lost. So the fix is `retry: false` on the invite hook (every refusal is final) and on the three hooks whose repeat is unsafe, leaving the default and every other hook alone.

Survey of the mutation hooks that keep the default (one line each: is a repeat safe; is a refusal final):

- `useUpdateCurrentUser` (PATCH users/me): safe; final. Leave.
- `useCreateProject` (POST projects): **unsafe**, a repeat after a lost answer creates a second brief with slug `-2` (`app/api/projects/route.ts:29-40`); final. **Change.**
- `useShareProject` (POST share): safe; final, and the retry delays the message. **Change.**
- `useSendMakerEmail` (POST projects/{id}/email): **unsafe**, the route sends through Resend before it stamps the project (`app/api/projects/[id]/email/route.ts:155-231`), so a 500 on the stamp, or a lost answer, repeats a real email to the maker; final. **Change.**
- `useChangeRequesterEmail` (PATCH share): a repeat re-keys an already re-keyed row; refusals final. Not checked in depth. Leave.
- `useSetBriefRole`, `useSetMemberRole`, `useRestoreMember`, `useUpdateProject`, `useArchiveProject`, `useRateMessage`, `useUpdateFileMeta`, `useMoveFile`, `useRenameFolder`, `useUpdateApp` (PATCH, set a value): safe; final. Leave.
- `useRemoveMember`, `useDeleteProject`, `useDeleteMessage`, `useDeleteFile`, `useDeleteFolder`, `useRevokeAppAdmin`, `useRevokeAppReadKey`, `useRevokeBuildStatusKey` (DELETE): safe in effect, though a repeat after a lost success can show a misleading "not found"; final. Leave.
- `useGenerateWelcome` (POST, one model call): safe, costs a second call; final. Leave.
- `useGeneratePrep` (POST): safe, cached server-side (`hooks.ts:376-378`); final. Leave.
- `useClaimProject` (POST claim): safe (claims the same row); final. Leave.
- `useCreateSession` (POST sessions): **unsafe**, the route completes every active session and opens a new one (`app/api/sessions/route.ts:86-110`), so a repeat closes the conversation just opened and opens another; final. **Change.**
- `useUploadFiles`: its `mutationFn` never throws (each file is settled), so retry never fires. Leave.
- `useCreateLink`, `useCreateFolder` (POST): a repeat makes a visible duplicate that is one click to delete; final. Leave (noted in Risks).
- `useCreateApp` (POST): a repeat meets a slug conflict; final. Leave.
- `useGrantAppAdmin` (POST to Garm): safe (same grant); final. Leave.
- `useMintAppReadKey`, `useMintBuildStatusKey` (POST): a repeat rotates again and the caller gets the newest key, but `rotated` reads true on a first mint; final. Leave.
- `useCreateProjectEmailIn` (POST): safe, documented (`hooks.ts:1326`); final. Leave.

## Global Constraints

- User-facing text lives only in `lib/copy.ts`. This plan adds none; the refusal text comes from the route as today.
- In a worktree, run BOTH `npm run build` and `npm run type-check` before claiming clean (CLAUDE.md: either alone is a false green). The build needs dummy `NEXT_PUBLIC_FIREBASE_*` values in a worktree.
- No new dependencies.
- Comments where a choice is not obvious: each `retry: false` carries one comment saying why that hook does not take the app default.
- Do not change `lib/query/query-client.ts`. The existing test `lib/query/__tests__/use-update-brief.test.tsx:79` asserts the default is still 1.
- Browser checks run headless (Chromium, as the existing e2e scripts do). Never `headless: false`.

## Review Focus

1. The control test in Task 1 must fail if the harness cannot see a retry: it proves a hook without `retry: false` is called twice under the app defaults. Without it the other tests could pass vacuously.
2. The fetch mock must build a fresh `Response` per call (`mockImplementation`, not `mockResolvedValue`), so a retry is a clean second call and not a "body already used" error.
3. No other hook and no component changes in the diff.

---

### Task 1: `retry: false` on four mutation hooks

**Files:**
- Modify: `lib/query/hooks.ts` (`useCreateProject` at line 71, `useShareProject` at 92, `useSendMakerEmail` at 124, `useCreateSession` at 645)
- Create: `lib/query/__tests__/mutation-retry.test.tsx` (copy the header, the `vi.mock` of `@/lib/firebase/api-fetch`, the `fetchMock` setup and the app-defaults client of `lib/query/__tests__/use-update-brief.test.tsx:1-28` and `:72-90`)

**Interfaces:**
- No signature changes. Each of the four hooks sends exactly one request per `mutate` call, whatever the answer.

- [ ] **Step 1: Write the failing tests.** Create `lib/query/__tests__/mutation-retry.test.tsx` with exactly this content:

```tsx
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook } from '@testing-library/react'
import { QueryClient, QueryClientProvider, useMutation } from '@tanstack/react-query'
import React from 'react'
import { useShareProject, useSendMakerEmail, useCreateProject, useCreateSession } from '../hooks'
import { queryClient as appQueryClient } from '../query-client'

// These hooks must send one request per call even under the app default
// (mutations retry: 1). The invite hook because every refusal is final and the
// retry held the message back about a second (2026-11-24); the other three
// because a repeat emails a maker twice, makes a second brief, or opens a second
// conversation.

vi.mock('@/lib/firebase/api-fetch', () => ({
  apiFetch: (url: string, options?: RequestInit) => globalThis.fetch(url, options),
}))

const fetchMock = vi.fn()
beforeEach(() => {
  fetchMock.mockReset()
  globalThis.fetch = fetchMock as unknown as typeof fetch
})

// A fresh Response per call, so a retry is a clean second call.
const answer = (body: unknown, status: number) =>
  fetchMock.mockImplementation(() =>
    Promise.resolve(new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }))
  )

// The app's real mutation defaults, with a 1 ms retry delay so a retry shows up fast.
function appDefaults() {
  const client = new QueryClient({
    defaultOptions: { mutations: { ...appQueryClient.getDefaultOptions().mutations, retryDelay: 1 } },
  })
  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  )
}

// Give a retry time to arrive if one is coming.
const settle = () => new Promise((r) => setTimeout(r, 50))

const REMOVED = 'This person was removed from the brief. Restore them under People instead of inviting them again.'

describe('mutation retry under the app defaults', () => {
  it('control: a mutation without retry: false is sent twice', async () => {
    answer({ error: 'nope' }, 409)
    const { result } = renderHook(
      () =>
        useMutation({
          mutationFn: async () => {
            const res = await fetch('/x', { method: 'POST' })
            if (!res.ok) throw new Error('refused')
          },
        }),
      { wrapper: appDefaults() }
    )
    await expect(result.current.mutateAsync()).rejects.toThrow('refused')
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('useShareProject: a 409 is sent once and rejects with the server message', async () => {
    answer({ error: REMOVED }, 409)
    const { result } = renderHook(() => useShareProject(), { wrapper: appDefaults() })
    await expect(result.current.mutateAsync({ project_id: 'p1', email: 'a@b.co' })).rejects.toThrow(REMOVED)
    await settle()
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('useShareProject: a 500 is sent once', async () => {
    answer({ error: 'boom' }, 500)
    const { result } = renderHook(() => useShareProject(), { wrapper: appDefaults() })
    await expect(result.current.mutateAsync({ project_id: 'p1', email: 'a@b.co' })).rejects.toThrow('boom')
    await settle()
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('useSendMakerEmail: a 500 is sent once', async () => {
    answer({ error: 'boom' }, 500)
    const { result } = renderHook(() => useSendMakerEmail(), { wrapper: appDefaults() })
    await expect(result.current.mutateAsync({ project_id: 'p1', kind: 'nudge' })).rejects.toThrow('boom')
    await settle()
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('useCreateProject: a 500 is sent once', async () => {
    answer({ error: 'boom' }, 500)
    const { result } = renderHook(() => useCreateProject(), { wrapper: appDefaults() })
    await expect(result.current.mutateAsync({ title: 't' })).rejects.toThrow('boom')
    await settle()
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('useCreateSession: a 500 is sent once', async () => {
    answer({ error: 'boom' }, 500)
    const { result } = renderHook(() => useCreateSession(), { wrapper: appDefaults() })
    await expect(result.current.mutateAsync({ project_id: 'p1' })).rejects.toThrow('boom')
    await settle()
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})
```

- [ ] **Step 2: Run** `npx vitest run lib/query/__tests__/mutation-retry.test.tsx`. Expected: the control test PASSES; the five hook tests FAIL with `expected "spy" to be called 1 times, but got 2 times`. If the control test fails, stop: the harness cannot see a retry and the other results mean nothing.

- [ ] **Step 3: Implement.** In `lib/query/hooks.ts`, add `retry: false` with its comment as the first property inside each hook's `useMutation({`, the same placement as `useUpdateBrief` (`hooks.ts:570-573`). Exact text:

In `useCreateProject`:

```ts
  return useMutation({
    // No retry (the app default is one). If the first request created the brief
    // and only the answer was lost, a repeat creates a second one (slug "-2").
    retry: false,
    mutationFn: async (payload: { title: string; [key: string]: unknown }) => {
```

In `useShareProject`:

```ts
  return useMutation({
    // No retry (the app default is one). Every refusal here is final (400, 403,
    // 404, 409 for a removed member), and the retry held the message back about
    // a second (2026-11-24). A repeat after a 500 would be safe; the builder can
    // press Share again.
    retry: false,
    mutationFn: async ({ project_id, email, first_name, last_name, role, brief_role }: { project_id: string; email: string; first_name?: string; last_name?: string; role?: string; brief_role?: string }) => {
```

In `useSendMakerEmail`:

```ts
  return useMutation({
    // No retry (the app default is one). The route sends the email before it
    // stamps the project, so a repeat after a failed stamp or a lost answer
    // emails the maker twice.
    retry: false,
    mutationFn: async ({
```

In `useCreateSession`:

```ts
  return useMutation({
    // No retry (the app default is one). The route closes every active
    // conversation and opens a new one, so a repeat after a lost answer closes
    // the one just opened and opens another.
    retry: false,
    mutationFn: async ({ project_id }: { project_id: string }) => {
```

Change nothing else in these hooks and nothing in `lib/query/query-client.ts`.

- [ ] **Step 4: Run** `npx vitest run lib/query/__tests__/mutation-retry.test.tsx lib/query/__tests__/use-update-brief.test.tsx`. Expected: all PASS. Then `npm test`, `npm run lint`, `npm run build`, `npm run type-check` (in a worktree: build first, then type-check; both must pass).

- [ ] **Step 5: Commit**

```
git add lib/query/hooks.ts lib/query/__tests__/mutation-retry.test.tsx
git commit -m "Invite, maker email, new brief, new conversation: no mutation retry"
```

### Task 2: Headless check script and docs

**Files:**
- Create: `scripts/e2e-invite-refusal-retry.mjs`
- Modify: `scripts/e2e-loose-ends-298.mjs:271-272` (the comment that says mutations retry once)
- Modify: `docs/changelog.md` (prepend an entry, newest first)
- Modify: `CLAUDE.md`, the "Stacked modals and the headless pass (PR #299 …)" line under **Watch**

- [ ] **Step 1: Write the script.** `scripts/e2e-invite-refusal-retry.mjs`, headless Chromium only, modelled on `scripts/e2e-loose-ends-298.mjs` (reuse its header comment style, `grade` and `note` helpers, the `call` helper at lines 50-59, the project setup at lines 147-165 that captures `auth` from the create response, and the cleanup in `finally` at lines 360-366). It needs `.ibuild4you-bypass` and `.test-admin-password` only (no test-cast passwords). Steps:
  1. `const { browser, ctx, page } = await launchLoggedIn()` from `./lib/preview-login.mjs`.
  2. Create a throwaway brief through "New brief" → `#project-json` → "Import & create", payload `{ _payload_type: 'new-project', title: \`e2e invite refusal ${stamp} — delete me\`, requester_email: 'test-originator@ibuild4you.com', requester_first_name: 'Mara' }`. Keep `proj` and `auth` as the 298 script does.
  3. Add and remove the second member by API, not UI: `POST /api/projects/share` with `{ project_id: proj.id, email: 'test-contributor@ibuild4you.com', first_name: 'Tomas', brief_role: 'contributor' }` (grade status 200); `GET /api/projects/${proj.id}/members` and take the `id` of the member whose `email` is that address; `DELETE /api/projects/${proj.id}/members/${id}` (grade status 200).
  4. Count requests: `let posts = 0; page.on('request', (r) => { if (/\/api\/projects\/share$/.test(r.url()) && r.method() === 'POST') posts++ })`. Register it after step 3 (the API calls in step 3 go through `page.request`, which does not fire `page.on('request')`, but registering after them keeps the count unambiguous).
  5. `page.goto(\`${BASE}/projects/${proj.slug}?tab=settings\`)`, wait 4000 ms, click the button named exactly `Invite`, fill `input[placeholder="First name"]` with `Tomas` and `input[type="email"]` with the removed address inside the dialog.
  6. Time it: set up `page.waitForResponse` for the share POST as at lines 265-267; `const tClick = Date.now()`; click the dialog's `Share` button; await the response and record `tResp = Date.now()`; wait for the message text `This person was removed from the brief. Restore them under People instead of inviting them again.` inside the dialog (timeout 10000) and record `tMsg = Date.now()`.
  7. Wait 2500 ms more (longer than React Query's 1000 ms retry delay plus a round trip), then grade:
     - `posts === 1`, label `one POST for one refused invite`, evidence `${posts} POST(s)`.
     - response status 409.
     - `tMsg - tResp < 500`, label `message within 500 ms of the 409`, evidence `${tMsg - tResp} ms`; also `note` the time from click to message (`tMsg - tClick`).
     - the dialog still holds the address in its email field.
  8. Screenshot to `${SHOTS}/invite-refusal.png` (`SHOTS = process.env.E2E_SHOT_DIR || shotDir`), close with Escape, delete the brief in `finally`, print `PASS: all checks` or `FAILED: n check(s)` and exit 1 on failure.
- [ ] **Step 2:** In `scripts/e2e-loose-ends-298.mjs`, replace the two comment lines at 271-272 with: `// The share hook does not retry (lib/query/hooks.ts, useShareProject), so the message should follow the first 409 at once.` Change nothing else in that script.
- [ ] **Step 3:** `docs/changelog.md`: prepend an entry dated the merge day: the cause (the app's mutation default `retry: 1` sent a refused invite twice, a second apart), the change (`retry: false` on `useShareProject`, `useSendMakerEmail`, `useCreateProject`, `useCreateSession`, and why for each in one clause), that the default stays at 1 for every other hook, and the preview result from the Verification check (POST count and milliseconds).
- [ ] **Step 4:** `CLAUDE.md`: in the PR #299 Watch line, replace the sentence that starts "Open: a refused invite shows its message about 1.3 seconds late" with one saying it was fixed (this PR's number) and what to watch: no hook other than the four was changed, so a slow refusal anywhere else is the same cause.
- [ ] **Step 5: Commit**

```
git add scripts/e2e-invite-refusal-retry.mjs scripts/e2e-loose-ends-298.mjs docs/changelog.md CLAUDE.md
git commit -m "e2e: count the POSTs for a refused invite; docs"
```

## Risks

- A transient network error or 5xx on these four now shows an error at once instead of being retried silently. For the invite that is an extra click; for the other three it is the point.
- `useCreateLink` and `useCreateFolder` still repeat on a failure and can leave a visible duplicate. Left on purpose; they are one click to undo.
- `handleShare` (`components/builder/BuilderProjectView.tsx:1432-1442`) awaits `mutateAsync` without a catch, so a refused invite also logs an unhandled rejection in the console. Unchanged by this plan; the message is shown from `shareProject.error` either way.

## Verification

1. `npm test`, `npm run lint`, `npm run build`, `npm run type-check`. In a worktree, build and type-check both, build first.
2. Preview, headless. Push the branch to preview (`git push origin <branch>:preview --force`), wait for the Vercel build (1-2 minutes; the site footer or `vercel ls` shows the new deployment), then run `E2E_SHOT_DIR=/private/tmp/invite-refusal node scripts/e2e-invite-refusal-retry.mjs`. Pass: `PASS: one POST for one refused invite [1 POST(s)]`, `PASS: message within 500 ms of the 409`, and the noted click-to-message time well under the 1.3 seconds seen on 2026-11-24. Fail: 2 POSTs (the hook still retries: check the deployment is the branch's) or a delay near 1 second.
3. Optional regression run of the earlier pass: `E2E_SHOT_DIR=/private/tmp/loose-ends node scripts/e2e-loose-ends-298.mjs` (needs `.test-cast-passwords.json`; it makes a real Sam call). Its section I note "time from the first 409 to the message on screen" should now read a few hundred milliseconds at most.
