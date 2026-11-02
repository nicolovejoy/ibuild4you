# Loop read key: offer to save in 1Password (#246) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When a read key is revealed after mint/rotate, present it in a password-manager-friendly form so 1Password offers to save it, without ever sending it anywhere.

**Architecture:** Replace the reveal `<input readOnly>` in `components/admin/ReadKeyPanel.tsx` with a `<form>` holding a username input and a password input plus a no-op submit; Copy stays and copies from state.

**Tech Stack:** React client component, vitest + jsdom + @testing-library/react.

**Spec:** `docs/superpowers/specs/2026-11-02-loop-key-1password-design.md` (includes the controller rulings).

## Global Constraints

- Username field value `loop-read-key-<slug>` with `autocomplete="username"`; key field `type="password"` with `autocomplete="new-password"`; neither readonly.
- The form never submits anywhere: `onSubmit` calls `preventDefault()`, no `action`/`method`, no fetch/apiFetch carries the key.
- The key is still shown once and never stored client-side beyond component state (no localStorage/sessionStorage).
- New strings in `lib/copy.ts` under `copy.adminApps` (admin is English only, no French twin).
- Commits end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Never commit `lib/build-info.json`.

## Review Focus

- Admin types into the masked field then clicks Copy: the clipboard gets the minted key, not the edited text (test).
- Pressing Enter in either field submits the form: no navigation, no network call (test: submit event default prevented, `fetch`/`apiFetch` spy not called).
- Rotate twice: the form shows the second key, not the first (test).
- Revoke after reveal: the form disappears (test).
- Username stays `loop-read-key-<slug>` for the slug prop given (test with a slug like `l6-music`).

---

### Task 1: Password-manager-friendly reveal form

**Files:**
- Modify: `components/admin/ReadKeyPanel.tsx`
- Modify: `lib/copy.ts` (`copy.adminApps`)
- Test: create `components/admin/__tests__/ReadKeyPanel.test.tsx` (`// @vitest-environment jsdom`; mock `@/lib/query/hooks` `useAppReadKey`/`useMintAppReadKey`/`useRevokeAppReadKey`; stub `navigator.clipboard.writeText`; spy `globalThis.fetch` and mock `@/lib/firebase/api-fetch` to assert no call carries the key)

**Interfaces:**
- Produces: no new exports; `ReadKeyPanel({ slug })` unchanged.

Copy keys (exact text) in `copy.adminApps`: `readKeyUsernameLabel: 'Item name'`, `readKeySave: 'Save to password manager'`, `readKeySaveNote: 'The key is masked so your password manager (e.g. 1Password) can offer to save it. Nothing is sent anywhere.'`.

- [ ] **Step 1: Write failing tests:** after a mint resolves `{ key: 'lrk_test_123' }` with slug `l6-music`: (a) a `form` contains an input with value `loop-read-key-l6-music`, `autocomplete="username"`, not readonly; (b) an input `type="password"`, `autocomplete="new-password"`, value `lrk_test_123`, not readonly; (c) submitting the form (button click and `fireEvent.submit`) leaves `defaultPrevented` true and calls neither `fetch` nor `apiFetch`; (d) Copy writes `lrk_test_123` even after the key field was changed to `edited`; (e) a second mint resolving `lrk_test_456` shows `lrk_test_456`; (f) revoke removes the form; (g) the form has no `action` attribute.
- [ ] **Step 2: Run** `npx vitest run components/admin/__tests__/ReadKeyPanel.test.tsx` — FAIL.
- [ ] **Step 3: Implement.** Controlled inputs: `keyField` state set from the mint result; username state set to `loop-read-key-${slug}` on mint. Copy reads `revealed`, not `keyField`. Keep existing classes/layout; label both inputs (`aria-label` or `<label>`). Add a comment explaining why the form exists (password-manager save prompt) and why it never submits.
- [ ] **Step 4: Run** the test file — PASS; then `npm test` once.
- [ ] **Step 5: Commit** `feat(loop): offer to save a minted read key in a password manager (#246)`.
