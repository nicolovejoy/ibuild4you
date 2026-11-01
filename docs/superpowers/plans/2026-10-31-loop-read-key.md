# Loop Per-App Read Key Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a Loop host app's server read its own recent feedback with a per-app read key, without any submitter email leaving Loop (Phase 1 of #237 / musicforge #412).

**Architecture:** A system admin mints a key on `/admin/apps/<slug>`; only its sha256 is stored in `loop_read_keys/{slug}`. `GET /api/feedback/read` checks the Bearer key against that hash in constant time, reads `feedback` rows for the slug newest first (existing `project_id asc + created_at desc` index), drops spam in code, and returns trimmed items with a keyed-hash sender tag instead of the email.

**Tech Stack:** Next.js App Router route handlers, Firebase Admin SDK (Firestore), `node:crypto`, React Query, Tailwind, vitest.

**Spec:** `docs/superpowers/specs/2026-10-31-loop-read-key-design.md` (rough design) plus the decisions below, which are final.

## Global Constraints

- Work only in `/Users/nico/src/ibuild4you-loop-read-key` (branch `loop-read-key`). Never commit `lib/build-info.json`.
- Key format: `lrk_` + 22 base64url chars (16 random bytes). Store only sha256 hex. Doc `loop_read_keys/{slug}` = `{ key_hash, created_at, created_by, last_used_at? }` (ISO strings, `created_by` = uid). One live key per app; minting again replaces it (that is Rotate).
- Key compare: `crypto.timingSafeEqual` over the two 32-byte sha256 digests (never over raw strings of differing length).
- Admin key routes: system admin only (`hasSystemRole(auth, 'admin')`), else 403 `{ error: 'Forbidden' }`. Key shown once, in the POST response only, with `Cache-Control: no-store`.
- Read endpoint: missing header, wrong key, unknown app, invalid slug, key for another app all answer the same 404 `{ error: 'Not found' }`. `LOOP_SENDER_TAG_SECRET` unset → 503 `{ error: 'not_configured' }` (checked first). No CORS headers. No OPTIONS handler.
- `limit` default 20, max 50. Newest first. Exclude `status: 'spam'`. `next_cursor` null when done.
- Sender tag: `"Sender " + first 4 hex of HMAC-SHA256(LOOP_SENDER_TAG_SECRET, slug + "\n" + normalizeEmail(email))`; no email → `"anonymous"`. Use `normalizeEmail` from `lib/email/normalize.ts`.
- Rate limit: 60 reads per minute per app via `checkRateLimit` in `lib/api/rate-limit.ts`, key `feedback-read:<slug>`, checked only after the key verifies (so an outsider cannot starve the host). Exceeded → 429 `{ error: 'Too many requests' }` with `Retry-After`.
- Logging: exactly one `console.log(JSON.stringify({ event: 'loop_read', slug, count }))` per successful read, and `{ event: 'loop_read_key_minted' | 'loop_read_key_revoked', slug, actor: uid, rotated? }` on admin actions. Never log a key, hash, email or cursor.
- Route files export only handlers. Constants go in `lib/feedback/limits.ts`.
- All UI text goes in `lib/copy.ts` under `adminApps`.
- Before claiming any task done: `npm test`, `npm run lint`, then build and type-check (both, either alone is a false green):

```
NEXT_PUBLIC_FIREBASE_API_KEY=dummy NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=dummy.firebaseapp.com NEXT_PUBLIC_FIREBASE_PROJECT_ID=dummy NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=dummy NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=1 NEXT_PUBLIC_FIREBASE_APP_ID=1:1:web:1 npm run build && npm run type-check
```

Then `git checkout lib/build-info.json` if the build touched it.

## Review Focus

- Garbled, truncated or hand-made `before` cursor → 400 `{ error: 'Invalid cursor' }` after auth, never a 500 (Task 2, Task 4).
- Odd `limit` values (`abc`, `0`, `-5`, `999`, `2.7`) → clamped to 1..50, non-numeric → 20 (Task 4).
- A presented key of the wrong length, empty, or without the `lrk_` prefix → 404, never a thrown `timingSafeEqual` RangeError (Task 3).
- A page whose first rows are all spam still returns up to `limit` real items and a correct cursor (Task 4).
- A rotated key: the old key is 404 on the very next read (Task 3, Task 8).

---

### Task 1: Platform and summary helpers

**Files:**
- Create: `lib/feedback/read-format.ts`
- Test: `lib/feedback/__tests__/read-format.test.ts`

**Interfaces:**
- Produces: `type Platform = 'ios' | 'android' | 'mac' | 'windows' | 'linux' | 'other'`; `platformFromUserAgent(ua: string | null | undefined): Platform`; `summarize(body: string | null | undefined): string`; `SUMMARY_MAX = 140`.

- [ ] **Step 1: Write the failing tests.** `platformFromUserAgent`: iPhone Safari UA → `ios`; iPad UA → `ios`; Android Chrome UA (contains `Linux`) → `android`; `Macintosh; Intel Mac OS X` → `mac`; `Windows NT 10.0` → `windows`; `X11; Linux x86_64` → `linux`; `CrOS` → `other`; `''`, `undefined`, `e2e-loop-apps/1.0` → `other`. Order of checks is ios, android, mac, windows, linux, case-insensitive. `summarize`: `'\n\n  Footer 404s  \nmore'` → `'Footer 404s'`; a 200-char single line → length 140 ending in `'…'` (139 chars + `…`); exactly 140 chars → unchanged; `'   \n  '` → `''`; `undefined` → `''`; `'a\r\nb'` → `'a'`.
- [ ] **Step 2: Run** `npx vitest run lib/feedback/__tests__/read-format.test.ts`. Expected: FAIL, module not found.
- [ ] **Step 3: Implement** both functions in `lib/feedback/read-format.ts` (regex tests, split on `/\r?\n/`). Header comment: why platform is derived (the UA itself is not exposed to hosts).
- [ ] **Step 4: Run** the same command. Expected: PASS.
- [ ] **Step 5: Commit** `feat(loop-read): platform and summary helpers (#237)`.

### Task 2: Sender tag, cursor and key helpers

**Files:**
- Create: `lib/feedback/read-crypto.ts`
- Test: `lib/feedback/__tests__/read-crypto.test.ts`

**Interfaces:**
- Produces:
  - `senderTag(secret: string, slug: string, email: string | null | undefined): string`
  - `encodeCursor(createdAt: string): string` (base64url of `JSON.stringify({ c: createdAt })`)
  - `decodeCursor(cursor: string): string | null` (null on bad base64, bad JSON, missing/non-string `c`, or `c` that is not a parseable date)
  - `READ_KEY_PREFIX = 'lrk_'`; `generateReadKey(): string` (`lrk_` + `randomBytes(16).toString('base64url')`, 26 chars total)
  - `hashReadKey(key: string): string` (sha256 hex)
  - `readKeyMatches(presented: string, storedHashHex: string): boolean`

- [ ] **Step 1: Write the failing tests.**
  - `senderTag('s3cret','byside','Sam@X.com ')` equals `'Sender ' + createHmac('sha256','s3cret').update('byside\nsam@x.com').digest('hex').slice(0,4)` (compute expected in the test); matches `/^Sender [0-9a-f]{4}$/`; same for `'sam@x.com'` (normalization); differs for slug `prntd`; `null`, `''`, `'   '` → `'anonymous'`.
  - Cursor: `decodeCursor(encodeCursor('2026-10-31T12:00:00.000Z'))` round-trips; `decodeCursor('!!!')`, `decodeCursor('')`, base64url of `'{"c":5}'`, base64url of `'not json'`, base64url of `'{"c":"nope"}'` → `null`.
  - Keys: `generateReadKey()` matches `/^lrk_[A-Za-z0-9_-]{22}$/`; two calls differ; `hashReadKey('lrk_x')` is 64 hex chars and deterministic; `readKeyMatches(k, hashReadKey(k))` true; wrong key false; `''` false; a stored hash that is not 64 hex chars → false (no throw).
- [ ] **Step 2: Run** `npx vitest run lib/feedback/__tests__/read-crypto.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** in `lib/feedback/read-crypto.ts`. `readKeyMatches` hashes `presented` to a Buffer, decodes `storedHashHex` with `Buffer.from(hex,'hex')`, returns false unless both are 32 bytes, then `timingSafeEqual`. Comment: comparing digests keeps the lengths equal so `timingSafeEqual` cannot throw. Follow `lib/feedback/identity.ts` style.
- [ ] **Step 4: Run** the same command. Expected: PASS.
- [ ] **Step 5: Commit** `feat(loop-read): sender tag, cursor and key helpers (#237)`.

### Task 3: Read key store

**Files:**
- Create: `lib/feedback/read-keys.ts`
- Test: `lib/feedback/__tests__/read-keys.test.ts`

**Interfaces:**
- Consumes: Task 2 `generateReadKey`, `hashReadKey`, `readKeyMatches`.
- Produces (all take `db: Firestore` first, like `findAppBySlug` in `lib/api/apps.ts`; collection name `READ_KEYS_COLLECTION = 'loop_read_keys'`):
  - `interface ReadKeyStatus { exists: boolean; created_at: string | null; last_used_at: string | null }`
  - `mintReadKey(db, slug: string, actorUid: string, now?: Date): Promise<{ key: string; created_at: string; rotated: boolean }>` (`set` replaces the doc, dropping any `last_used_at`; `rotated` = a doc existed before)
  - `revokeReadKey(db, slug): Promise<boolean>` (true if a doc was deleted)
  - `getReadKeyStatus(db, slug): Promise<ReadKeyStatus>`
  - `verifyReadKey(db, slug, presented: string): Promise<{ last_used_at: string | null } | null>` (null when no doc or no match)
  - `touchReadKey(db, slug, lastUsedAt: string | null, now?: Date): void` (fire-and-forget `update({ last_used_at })` only when `lastUsedAt` is null or older than `LAST_USED_THROTTLE_MS = 5 * 60 * 1000`; swallows and `console.warn`s errors with the slug only)

- [ ] **Step 1: Write the failing tests** with a small in-memory fake: `{ collection: (name) => ({ doc: (id) => ({ get, set, update, delete }) }) }` backed by a `Map`, asserting the collection name is `loop_read_keys`. Cases: mint stores `key_hash === hashReadKey(key)`, `created_by`, `created_at`, and never the key itself (assert `JSON.stringify(stored)` does not contain the key); second mint returns `rotated: true`, a different key, and the first key no longer verifies; `verifyReadKey` with the right key returns `{ last_used_at: null }`; wrong key, `''`, `'short'`, and a key for slug A presented for slug B → `null`; revoke then verify → `null`, revoke twice → second returns `false`; `getReadKeyStatus` before mint → `{ exists:false, created_at:null, last_used_at:null }` and never returns `key_hash`; `touchReadKey` with `null` updates, with a value 1 minute old does not update, with 6 minutes old updates; an `update` that rejects does not throw.
- [ ] **Step 2: Run** `npx vitest run lib/feedback/__tests__/read-keys.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** `lib/feedback/read-keys.ts`, plus `LAST_USED_THROTTLE_MS`. Add `ReadKeyStatus` to `lib/types/index.ts` next to `AppAdmin` and import it from there (the UI uses it).
- [ ] **Step 4: Run** the same command. Expected: PASS.
- [ ] **Step 5: Commit** `feat(loop-read): read key store in loop_read_keys (#237)`.

### Task 4: `GET /api/feedback/read`

**Files:**
- Create: `app/api/feedback/read/route.ts`
- Modify: `lib/feedback/limits.ts` (add `READ_RATE_LIMIT_PER_MINUTE = 60`, `READ_LIMIT_DEFAULT = 20`, `READ_LIMIT_MAX = 50`, `READ_SCAN_BATCH = 100`, `READ_SCAN_MAX_BATCHES = 5`; plus `parseReadLimit(raw: string | null): number`)
- Test: `app/api/feedback/read/__tests__/route.test.ts`, `lib/feedback/__tests__/limits.test.ts` (new) for `parseReadLimit`

**Interfaces:**
- Consumes: Tasks 1–3; `isValidAppSlug` from `lib/api/apps.ts`; `checkRateLimit`, `_resetRateLimit` from `lib/api/rate-limit.ts`; `getAdminDb` from `@/lib/firebase/admin`.
- Produces: response `{ items: ReadItem[]; next_cursor: string | null }` where `ReadItem = { id, type, summary, platform, created_at, status, loop_url, sender }` (add `ReadItem` to `lib/types/index.ts`). `loop_url` = `${process.env.NEXT_PUBLIC_APP_URL || 'https://ibuild4you.com'}/admin/apps/${slug}?id=${id}` (preview links stay on preview).

Order of checks: `LOOP_SENDER_TAG_SECRET` → 503; `app` valid slug and `Authorization` scheme `Bearer` (case-insensitive, token trimmed) present → else 404; `verifyReadKey` → else 404; rate limit → 429; `before` decode → 400 `{ error: 'Invalid cursor' }`; query. The `app` param is the canonical slug only (a legacy slug finds no key doc and is 404; say so in READ.md). All responses carry `Cache-Control: no-store`.

Query loop (spam excluded in code, so the existing `project_id asc + created_at desc` index serves it and no new index or deploy is needed): `db.collection('feedback').where('project_id','==',slug).orderBy('created_at','desc')`, `.startAfter(cursorOrLastScanned)` when set, `.limit(READ_SCAN_BATCH)`; keep non-spam rows until `limit + 1` are collected, a batch returns fewer than `READ_SCAN_BATCH`, or `READ_SCAN_MAX_BATCHES` batches ran. Return the first `limit`; `next_cursor = encodeCursor(items[limit-1].created_at)` if an extra item was found or the scan stopped on the batch cap, else null. After the response is built, `touchReadKey(...)` and log `loop_read`.

- [ ] **Step 1: Write the failing tests.** Mock `@/lib/firebase/admin` the way `app/api/feedback/__tests__/route.test.ts` does, with a `loop_read_keys` doc store and a `feedback` query fake that honours `where`/`orderBy`/`startAfter`/`limit` over an in-memory array sorted by `created_at` desc. Set `process.env.LOOP_SENDER_TAG_SECRET` in `beforeEach`, `_resetRateLimit()` too. Cases:
  - secret unset → 503 `{ error: 'not_configured' }`
  - no header; `Basic x`; wrong key; key minted for `prntd` used on `app=byside`; `app=Bad_Slug`; `app` missing; app with no key doc → each 404 `{ error: 'Not found' }`, identical bodies
  - `authorization: bearer <key>` (lowercase scheme) works
  - happy path: 3 rows → newest first, each item has exactly the 8 keys above, `sender` is `senderTag(secret,'byside',email)` or `'anonymous'`, and `JSON.stringify(body)` contains no `@` and none of `submitter_email`, `user_agent`, `page_url`, `body`, `internal_notes`
  - spam excluded; 120 spam rows newest then 3 real rows → returns the 3 real rows (spans two batches)
  - paging: 25 rows, `limit=10` → 10 items + cursor; follow cursor twice → 10, then 5 with `next_cursor: null`; no duplicates across pages
  - `before=garbage` with a valid key → 400 `{ error: 'Invalid cursor' }`; with a wrong key → 404
  - 61st request within a minute → 429 with a numeric `Retry-After`; 60 bad-key requests do not consume the app's limit
  - `console.log` called once with `{ event:'loop_read', slug:'byside', count:3 }` and no call's arguments contain the key or an email
  - no `access-control-allow-origin` header
  - `parseReadLimit`: `null` → 20, `'abc'` → 20, `'0'` → 1, `'-5'` → 1, `'999'` → 50, `'2.7'` → 2, `'30'` → 30
- [ ] **Step 2: Run** `npx vitest run app/api/feedback/read lib/feedback/__tests__/limits.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** the route (`export async function GET(request: Request)`) and the limits additions. Header comment: server-to-server only, the privacy rule, why spam is filtered in code, why the rate limit runs after the key check.
- [ ] **Step 4: Run** the same command, then the full `npm test`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(loop-read): GET /api/feedback/read (#237)`.

### Task 5: Admin read-key routes

**Files:**
- Create: `app/api/admin/apps/[slug]/read-key/route.ts`
- Test: `app/api/admin/apps/[slug]/read-key/__tests__/route.test.ts`

**Interfaces:**
- Consumes: Task 3 store functions; `getAuthenticatedUser`, `getAdminDb`, `hasSystemRole` from `@/lib/api/firebase-server-helpers`; `isValidAppSlug` from `@/lib/api/apps`.
- Produces: `GET` → `ReadKeyStatus`; `POST` → 201 `{ key, created_at, rotated }`; `DELETE` → `{ ok: true, revoked: boolean }`. All with `Cache-Control: no-store`. Ctx type `{ params: Promise<{ slug: string }> }` as in `app/api/admin/apps/[slug]/route.ts`.

Checks in order: auth error passthrough (401); not system admin → 403 `{ error: 'Forbidden' }`; invalid slug → 400 `{ error: 'Invalid slug' }`; `apps/{slug}` missing → 404 `{ error: 'App not found' }` (canonical slug only); then act. POST and DELETE log `loop_read_key_minted` (with `rotated`) / `loop_read_key_revoked` with `slug` and `actor: auth.uid`.

- [ ] **Step 1: Write the failing tests**, mocking `@/lib/api/firebase-server-helpers` as `app/api/admin/apps/[slug]/admins/__tests__/route.test.ts` does (`hasSystemRole` driven by `auth.systemRoles`), and `@/lib/feedback/read-keys` with `vi.fn`s. Cases: 401 passthrough; owner without `admin` system role → 403 on GET, POST, DELETE and the store is never called; `Bad_Slug` → 400; unknown app → 404; GET returns the status object and its JSON has no `key`/`key_hash`; POST → 201 with the key, `cache-control: no-store`, log line has slug + actor and does not contain the key; DELETE → `{ ok:true, revoked:true }` and logs.
- [ ] **Step 2: Run** `npx vitest run "app/api/admin/apps/[slug]/read-key"`. Expected: FAIL.
- [ ] **Step 3: Implement** `GET`, `POST`, `DELETE` in the route file.
- [ ] **Step 4: Run** the same command. Expected: PASS.
- [ ] **Step 5: Commit** `feat(loop-read): admin mint, rotate, revoke routes (#237)`.

### Task 6: Read key section on the app page

**Files:**
- Create: `components/admin/ReadKeyPanel.tsx`
- Modify: `lib/query/keys.ts` (add `appReadKey: (slug: string | undefined) => ['app-read-key', slug] as const`), `lib/query/hooks.ts` (after the app-admins hooks), `lib/copy.ts` (`adminApps`), `app/admin/apps/[slug]/page.tsx`

**Interfaces:**
- Consumes: Task 5 routes; `ReadKeyStatus` from `lib/types`.
- Produces: `useAppReadKey(slug)` (query, `retry: false`), `useMintAppReadKey(slug)` (mutation returning `{ key, created_at, rotated }`, invalidates `appReadKey`), `useRevokeAppReadKey(slug)`; `ReadKeyPanel({ slug }: { slug: string })`. Mirror `useAppAdmins` / `useGrantAppAdmin` exactly (`apiFetch`, `HttpError`).

Copy keys (add to `adminApps`, English only; admin pages are not localized):
`readKeyHeading: 'Read key'`, `readKeyNote: 'Lets this app’s server read its own feedback through /api/feedback/read. Server-to-server only, never put it in a browser. Sender emails are never returned.'`, `readKeyNone: 'No key yet.'`, `readKeyMinted: 'Minted'`, `readKeyLastUsed: 'last used'`, `readKeyNeverUsed: 'never used'`, `readKeyMint: 'Mint key'`, `readKeyRotate: 'Rotate key'`, `readKeyRevoke: 'Revoke'`, `readKeyConfirmRotate: 'Rotate the key? The current key stops working immediately.'`, `readKeyConfirmRevoke: 'Revoke the key? The host app loses access immediately.'`, `readKeyRevealNote: 'Copy it now. It will not be shown again.'`, `readKeyCopy: 'Copy'`, `readKeyCopied: 'Copied'`, `readKeyError: 'Could not change the read key.'`.

Panel behaviour: a `bg-white rounded-lg border border-gray-200 p-4 space-y-3` section like `ManageAdmins`; status line `readKeyNone`, or `Minted <date> · last used <date>` / `never used` (dates via the same `Intl.DateTimeFormat('en-US', { timeZone: 'America/Los_Angeles' })` as `ManageAdmins`); button Mint (no key) or Rotate (`window.confirm(readKeyConfirmRotate)`); Revoke with `window.confirm(readKeyConfirmRevoke)`, shown only when a key exists; after a mint, a read-only monospace `<input>` holding the key (`aria-label={t.readKeyHeading}`) with a Copy button (`navigator.clipboard.writeText`) and `readKeyRevealNote`. The revealed key lives only in component state and is cleared on revoke or unmount. Errors in a `role="alert"` line.

On the page, render `{app.access === 'admin' && <ReadKeyPanel slug={app.slug} />}` directly after the `ManageAdmins` line.

- [ ] **Step 1:** Pure UI layout, no unit test (TDD exception per CLAUDE.md); Task 8 covers it on preview.
- [ ] **Step 2: Implement** the keys, hooks, copy, component and page line.
- [ ] **Step 3: Verify** with `npm run lint` and the build + type-check command in Global Constraints. Expected: clean.
- [ ] **Step 4: Commit** `feat(loop-read): Read key panel on the app page (#237)`.

### Task 7: Contract doc, Loop doc, CLAUDE.md

**Files:**
- Create: `lib/feedback/READ.md`
- Modify: `docs/loop.md` (row in "Moving parts" + a short `## Reading feedback from a host server` section before "Changing the contract", pointing at `lib/feedback/READ.md`), `lib/feedback/README.md` (one line near the top pointing at `READ.md`), `CLAUDE.md`

`READ.md` sections, in this order: purpose (one paragraph, musicforge is the first consumer); the privacy rule verbatim from the spec ("Submitter email addresses stay in Loop…"); getting a key (a system admin mints it at `/admin/apps/<slug>`, shown once, store it in the host's secret manager, Rotate replaces it immediately, Revoke ends access); request (`GET https://ibuild4you.com/api/feedback/read?app=<slug>&limit=20&before=<cursor>`, `Authorization: Bearer lrk_…`, canonical slug only, `limit` 1–50 default 20, out-of-range clamped, `before` opaque, pass back `next_cursor` unchanged); response shape with a JSON example of one item and every field explained (summary rule, platform values, sender tag is stable per person per app and not reversible, `"anonymous"` when no email, `loop_url` opens the item in Loop for an admin, spam never listed); example `curl` on one line with `$LOOP_READ_KEY`; errors table (404 `Not found` for every auth/app failure, 400 `Invalid cursor`, 429 with `Retry-After`, 503 `not_configured`); rate limit 60/min per app; server-to-server only, no CORS.

CLAUDE.md: in Data Model, one line after **garm_denials**: `- **loop_read_keys** — one per Loop app, doc id = canonical slug: \`{ key_hash (sha256 hex), created_at, created_by, last_used_at? }\`. The key itself is shown once at mint on \`/admin/apps/<slug>\` (system admin) and never stored. Used by \`GET /api/feedback/read\` (contract \`lib/feedback/READ.md\`).` In Env vars, after `GARM_LOOP_KEY`: `- \`LOOP_SENDER_TAG_SECRET\` — HMAC secret for the sender tags \`GET /api/feedback/read\` returns in place of emails. Value in 1Password \`op://dev-secrets/ibuild4you-loop-sender-tag-secret/password\`. Never logged. Unset → the endpoint answers 503 \`not_configured\`. Set on Production and Preview (a different value is fine: tags only need to be stable within one deployment environment). Changing it changes every tag.`

Env templates: the committed `.env.preview.tpl` and `.env.ops.tpl` hold service-account references for scripts, and the secrets hook blocks agents from reading them. Do not try to work around that. Leave them alone and list in the PR description that Nico should add `LOOP_SENDER_TAG_SECRET=op://dev-secrets/ibuild4you-loop-sender-tag-secret/password` to a template only if it lists runtime secrets, and must create the 1Password item and set the var on Vercel Preview and Production.

- [ ] **Step 1: Write** the three docs and the two CLAUDE.md lines.
- [ ] **Step 2: Verify** with `npx prettier --check lib/feedback/READ.md docs/loop.md` (or `npm run format` limited to those files). Expected: clean.
- [ ] **Step 3: Commit** `docs(loop-read): read contract, Loop doc, CLAUDE.md (#237)`.

### Task 8: Preview e2e script

**Files:**
- Create: `scripts/e2e-loop-read-key.mjs`

**Interfaces:**
- Consumes: `readToken`, `launchLoggedIn`, `BASE` from `scripts/lib/preview-login.mjs`; `initFixtureDb` from `scripts/fixtures/db.mjs`; the admin Bearer captured from a page request the way `scripts/e2e-229-notes.mjs` does (`resp.request().headers()['authorization']`), sent with `page.request.fetch`; errors cut to their first line so headers never print.

Usage header, as in `scripts/e2e-loop-apps.mjs`: `op run --env-file=.env.preview.tpl -- node scripts/with-preview-env.mjs node scripts/e2e-loop-read-key.mjs`. Needs `.ibuild4you-bypass`, `.test-admin-password`, `npm i --no-save playwright`, and `LOOP_SENDER_TAG_SECRET` set on Vercel Preview (else step 3 gets 503, report that explicitly).

Flow (each step a PASS/FAIL line, process exits 1 on any FAIL):
1. Create app `e2e-read-key-<Date.now()>` via `POST /api/admin/apps` as the admin (Garm is skipped on preview).
2. `POST /api/admin/apps/<slug>/read-key` → 201, key matches `/^lrk_[A-Za-z0-9_-]{22}$/`. Never print the key.
3. `POST /api/feedback` with `projectId: slug`, `submitterEmail: 'e2e-read@example.com'`, an iPhone UA, `body: 'e2e read key check\nsecond line'`, `_ts: Date.now() - 5_000`, bypass header → 201.
4. Plain `fetch` (bypass header + `Authorization: Bearer <key>`) `GET /api/feedback/read?app=<slug>` → 200, one item with `summary === 'e2e read key check'`, `platform === 'ios'`, `sender` matches `/^Sender [0-9a-f]{4}$/`, `loop_url` ends with `/admin/apps/<slug>?id=<id>`, `next_cursor === null`, and the raw body text contains no `@`.
5. Open `/admin/apps/<slug>` and check the `Read key` heading and a `last used` status are visible.
6. Wrong key (`lrk_` + 22 `A`s) → 404 `{ error: 'Not found' }`.
7. Rotate (POST again): old key → 404, new key → 200.
8. `DELETE …/read-key` → 200; new key → 404.
9. `finally`: delete the app's feedback rows, `loop_read_keys/<slug>`, and `apps/<slug>` via the fixture db; close the browser.

- [ ] **Step 1: Write** the script.
- [ ] **Step 2: Verify** `node --check scripts/e2e-loop-read-key.mjs`. Expected: no output.
- [ ] **Step 3: Commit** `test(loop-read): preview e2e for the read key (#237)`.
- [ ] **Step 4 (after the branch is on preview and the secret is set):** run the usage command. Expected: all PASS, cleanup line printed.

---

## After the branch

- Nico: create `op://dev-secrets/ibuild4you-loop-sender-tag-secret/password` (e.g. 32 random bytes hex), set `LOOP_SENDER_TAG_SECRET` on Vercel Preview and Production, push to preview, run Task 8.
- No Firestore index deploy is needed (spam is filtered in code).
- Once merged and a key is minted for `musicforge`, post `lib/feedback/READ.md` on the `ibuild4you-musicforge` handoff channel; hand the key over out of band.
