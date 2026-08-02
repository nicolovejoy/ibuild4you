# Plan: Normalize email comparisons in authz paths (issue #155)

> Status: DECIDED (audit run 2026-07-16, read-only against prod). Build from this doc — the analysis need not be re-derived. Sonnet-suitable.

## 0. Executive summary

- All five sites named in the issue are real. The audit found **four additional read sites and two additional write sites** the issue missed (Section 2).
- **Live prod data is 100% clean**: 0 non-normalized rows in `project_members.email` (0/53), `projects.requester_email` (0/25), `approved_emails` doc IDs and `email` field (0/33), and `users.email` (0/27). Verified 2026-07-16 via `scripts/with-prod-env-ro.mjs` with a read-only audit script.
- Therefore: **no backfill is required**. The correct move is normalize-on-read AND normalize-on-write in a single deploy, plus a committed verify script (with an idempotent `--fix` mode) run before and after deploy to close the race window.
- The single highest-leverage change is normalizing at the token boundary: `lib/api/firebase-server-helpers.ts:224` (`const email = decoded.email ?? ''` → `normalizeEmail(decoded.email)`). Every `auth.email` read and write site inherits the fix. Per-site normalization is then added at the five issue sites as defense in depth (this matches the repo's existing "normalize again defensively" convention, see `app/api/projects/route.ts:479`).

## 1. Audit of the 5 issue sites (read/write pair analysis)

### Site 1 — `isAdminEmail()` (`lib/constants.ts:8-9`)
```ts
export function isAdminEmail(email: string | null): boolean {
  return !!email && ADMIN_EMAILS.includes(email)
}
```
- **"Write" side**: the hardcoded `ADMIN_EMAILS` constant (`lib/constants.ts:1`) — all three entries are already lowercase, but nothing enforces this.
- **Read side**: callers pass `decoded.email` straight off the Firebase ID token — `firebase-server-helpers.ts:84` (`getProjectRole` implicit-owner), `:246` (system_roles fallback in `getAuthenticatedUser`), `:322` (`computeLocalApprovedAnswer` — the approval gate), and `app/api/approved-emails/route.ts:26`.
- **Failure mode**: if the token email ever carries different case/whitespace, the gate **fails closed** — Nico locked out of admin (the #152 lockout class), and via the `:246` fallback he'd also get `systemRoles: []`, cascading to every `hasSystemRole(auth, 'admin')` check. There is no fail-open risk from normalizing: trim+lowercase never collapses two distinct legitimate addresses into an admin address.
- **Fix**: normalize inside the function; add an invariant test that every `ADMIN_EMAILS` entry equals its normalized form.

### Site 2 — `getProjectRole()` (`lib/api/firebase-server-helpers.ts:107-128`)
- **Reads**: `where('email', '==', email)` at `:110`; raw `data.requester_email === email` at `:124`. `email` comes from `auth.email` (unnormalized token) at every call site.
- **Writes to `project_members.email`** (audited each):
  - `app/api/projects/share/route.ts:70` — normalized ✓ (post-#152)
  - `app/api/projects/route.ts:469` (participants) — normalized ✓
  - `app/api/projects/route.ts:449` (owner row) — **RAW `auth.email`** ✗ (issue site 5)
  - `app/api/projects/claim/route.ts:62` (legacy-migration row) — **RAW `auth.email`** ✗
  - `app/api/projects/archive/route.ts:66` (fallback row) — **RAW `auth.email`** ✗ (missed by issue)
  - `app/api/projects/share/route.ts:311` (rekey) — normalized ✓
  - `scripts/backfill-project-members.mjs:76` — `.toLowerCase()` only, no trim (near-ok; script is one-shot, PR E territory)
- **Writes to `projects.requester_email`**: `projects/route.ts:433` (normalized ✓ — comes from `primary.email`), `share/route.ts:99` (normalized ✓), `share/route.ts:314` rekey (normalized ✓). Note `projects/route.ts:348-351` copies `body.requester_email` **trimmed but not lowercased** into `projectData` — but line 433 overwrites it with the normalized participant email, and line 440 deletes it when no participant resolves, so the stored value is always normalized. No change needed, but worth a comment.
- **Failure mode**: writes are normalized, read passes raw token email → mixed-case token email = unreachable membership = access denied (fail closed / lockout). The `requester_email ===` at `:124` is the same, but is slated for deletion in Garm PR E — normalize the comparison, don't invest beyond that.
- **Fix**: normalize the `email` param at the top of `getProjectRole` — and of **`getViewerBriefRole` (`:138-161`)**, which has the identical pattern at `:155` and was missed by the issue.

### Site 3 — `app/api/projects/claim/route.ts:35,40`
- Read `:35` `where('email', '==', auth.email)` and read `:40` `requester_email === auth.email` — raw both. Plus the **write** at `:62` (`email: auth.email`) which mints new non-normalized rows — the issue mentioned only the reads here.
- **Fix**: normalize once at the top (`const email = normalizeEmail(auth.email)`), use for both reads and the write.

### Site 4 — `app/api/users/route.ts` PATCH (`:120-160`)
- `targetEmail = email || ''` raw from the admin UI request body; used four ways: `getUserByEmail(targetEmail)` (`:128`), the sanitized doc ID (`:134`), the stored `users.email` field (`:145`), and `where('email', '==', targetEmail)` against `project_members` (`:156`).
- **Write side of what it reads**: `project_members.email` (mixed provenance, see Site 2). In practice the GET handler in the same file emits already-normalized emails back to the admin UI (`:23,33,50`), so the PATCH body is normalized today — but nothing enforces it.
- **Failure mode if only reads normalized**: none (data clean). Failure if left raw: an admin typing/pasting `" Sam@X.com "` silently fails to sync `user_id` onto member rows, and creates a `users` doc with a divergent email and a differently-derived doc ID.
- **Fix**: `const targetEmail = normalizeEmail(email)`. Note: this changes the derived doc ID for mixed-case input — safe because prod `users` docs are clean (no orphaning).

### Site 5 — owner-membership write (`app/api/projects/route.ts:446-455`)
- `email: auth.email` at `:449`, raw. Inconsistent with the participant rows written at `:469` in the same handler. `creatorEmail` (normalized) already exists at `:395` — **reuse it**. Also normalize the `added_by: auth.email` at `:452/:473/:483` for consistency (audit-trail only, low stakes, free).

## 2. Sites the issue missed

| Site | Kind | Notes |
|---|---|---|
| `app/api/projects/archive/route.ts:53` | read `where('email','==',auth.email)` | fail-closed miss → falls into the `:63` add |
| `app/api/projects/archive/route.ts:66` | **write** `email: auth.email` | mints non-normalized rows |
| `app/api/projects/route.ts:89` (GET, admin branch) | read | admin viewer-role map incomplete |
| `app/api/projects/route.ts:114` (GET) | read | member-by-email project listing — dashboard misses briefs |
| `app/api/projects/route.ts:126` (GET) | read `where('requester_email',...)` | legacy path, PR E will delete — minimal fix only |
| `app/api/users/me/route.ts:~72` | write `set({ email: auth.email })` into `users` | display/seed provenance |
| `app/api/users/me/route.ts:80` | read `where('requester_email','==',auth.email)` | name-sync silently no-ops |
| `lib/api/firebase-server-helpers.ts:155` (`getViewerBriefRole`) | read | same pattern as `getProjectRole` |
| `app/api/chat/route.ts:123` + `:312-320` | write `sender_email: auth.email`, read raw map keys | display-only roster; fixed for free by the central change |

**All of these are `auth.email` consumers**, which is why the central fix at `getAuthenticatedUser` is the right shape: one change covers every missed site plus any future one.

## 3. Prod data findings (read-only audit, 2026-07-16)

Run via `node scripts/with-prod-env-ro.mjs node <scratchpad>/audit-email-case.mjs` (datastore.viewer credential; compared each stored value against `trim().toLowerCase()`):

| Collection / field | Non-normalized | Total with value |
|---|---|---|
| `project_members.email` | **0** | 53 |
| `projects.requester_email` | **0** | 25 |
| `approved_emails` doc IDs | **0** | 33 |
| `approved_emails.email` | **0** | 33 |
| `users.email` (bonus) | **0** | 27 |

Schema note: `approved_emails` is keyed by email doc ID **and** duplicates it in an `email` field; both are clean.

## 4. Backfill vs normalize-on-read — recommendation per collection

- **`project_members.email`**: no backfill needed (0 dirty rows). Normalize reads AND the three raw writes in one deploy. Commit a `scripts/verify-email-normalization.mjs` (check mode default, `--fix` mode doing idempotent field **updates** — consistent with the no-hard-deletes convention) and run check before merge and after deploy to close the race window between this audit and the deploy.
- **`projects.requester_email`**: no backfill; writes already normalized; only reads need the fix. **Do not over-invest** — Garm PR E (docs/garm-consumer-plan.md, Phase 3) retires the `requester_*` authz fallback entirely (`firebase-server-helpers.ts:118-126`, `projects/route.ts:117-127`, claim route). One-line normalize on each read is the ceiling.
- **`approved_emails`**: already fully normalized on both sides post-#152 (`firebase-server-helpers.ts:325` normalizes the doc lookup); no action. Doc-ID renames would be delete+create — avoid; not needed anyway.
- **`users.email`**: clean; normalize the two write sites (`users/me` `:72`, users PATCH `:145`) opportunistically. Reads of it already normalize (`users/route.ts:23`, garm-seed consumes via GET path that normalizes).
- **Garm grants**: already normalized (`lib/garm.ts:79`), nothing to do.

## 5. Step-by-step implementation plan (TDD, one PR)

Test runner is vitest; route tests mock `@/lib/api/firebase-server-helpers` (see `app/api/projects/claim/__tests__/route.test.ts` for the pattern — set `authResult.email` to a mixed-case value and assert on captured `where()` args / `add()` payloads).

**Step 1 — failing tests for `isAdminEmail`** (`lib/api/__tests__/firebase-server-helpers.test.ts`, existing `describe('isAdminEmail')` at `:57`):
- `expect(isAdminEmail(' NLovejoy@Me.com ')).toBe(true)` (mixed case + whitespace)
- Invariant: `ADMIN_EMAILS.every(e => e === normalizeEmail(e))` — guards the constant against a future mixed-case entry, which after Step 2 would create a permanently-unmatchable admin.

**Step 2 — fix `lib/constants.ts:8-9`**: `return !!email && ADMIN_EMAILS.includes(normalizeEmail(email))`. Import from `@/lib/email/normalize` (check for import cycles — `constants.ts` currently imports nothing; `normalize.ts` imports nothing; safe).

**Step 3 — failing test for the token boundary** (same test file, `getAuthenticatedUser` describes exist ~`:388`): mock `verifyIdToken` to return `email: ' Nico@Example.COM '`; assert returned `auth.email === 'nico@example.com'`.

**Step 4 — fix `lib/api/firebase-server-helpers.ts:224`**: `const email = normalizeEmail(decoded.email)`. This is the change that covers all Section 2 sites.

**Step 5 — failing tests for `getProjectRole` / `getViewerBriefRole`**: mock Firestore capturing `where('email', '==', X)`; call with `email = ' Sam@Example.COM '` against a member row stored as `sam@example.com`; assert the query value is normalized and the role is returned. Same for the `requester_email ===` fallback (`:124`) — mixed-case arg vs lowercase stored value must match.

**Step 6 — fix both helpers**: first line of each: `email = normalizeEmail(email)` (or a local const). Normalize the `:124` comparison as `normalizeEmail(data.requester_email) === email`.

**Step 7 — failing tests for claim route** (extend `app/api/projects/claim/__tests__/route.test.ts`): `authResult.email = ' U@IBuild4You.com '`; (a) member row `u@ibuild4you.com` → claim succeeds, `where` got normalized value; (b) legacy path (`requester_email: 'u@ibuild4you.com'`, no member rows) → succeeds AND `mockMemberAdd` payload has `email: 'u@ibuild4you.com'`.

**Step 8 — fix `app/api/projects/claim/route.ts`**: `const email = normalizeEmail(auth.email)` after the auth check; use at `:35`, `:40` (also normalize the stored side: `normalizeEmail(project?.requester_email)`), and `:62`.

**Step 9 — failing test for users PATCH** (new file `app/api/users/__tests__/users-patch.test.ts`): admin PATCH with `email: ' Maker@X.COM '`, mocked `getUserByEmail` resolving a uid → assert `project_members` `where('email','==','maker@x.com')` and users-doc `set` receives `email: 'maker@x.com'`.

**Step 10 — fix `app/api/users/route.ts:120`**: `const targetEmail = normalizeEmail(email)`; keep the `if (!targetEmail)` 400 guard. (`:134` docId and `:145` stored email inherit it.)

**Step 11 — failing test for owner-membership write** (extend `app/api/projects/__tests__/create-project.test.ts`): auth email `' Owner@X.COM '` → owner `project_members.add` payload email is `owner@x.com`.

**Step 12 — fix `app/api/projects/route.ts:449`**: `email: creatorEmail` (already defined at `:395`); also `added_by: creatorEmail` at `:452/:473/:483`.

**Step 13 — sweep fixes covered by Step 4 but worth an explicit defensive normalize where the raw pattern is written into data**: `app/api/projects/archive/route.ts:53,66,68` and `app/api/users/me/route.ts:72,80` (use `normalizeEmail(auth.email)` locally). The pure-read sites (`projects/route.ts:89,114,126`, `chat/route.ts`) are covered by Step 4 — leave as `auth.email`.

**Step 14 — commit the verify script** `scripts/verify-email-normalization.mjs` (plain .mjs, no TS runner). Sketch:

```js
#!/usr/bin/env node
// Usage: node scripts/with-prod-env-ro.mjs node scripts/verify-email-normalization.mjs
//        node scripts/with-prod-env.mjs node scripts/verify-email-normalization.mjs --fix
import { initializeApp, cert } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'
const norm = (e) => (e ?? '').trim().toLowerCase()   // mirror lib/email/normalize.ts
const FIX = process.argv.includes('--fix')
initializeApp({ credential: cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)) })
const db = getFirestore()
const targets = [
  ['project_members', 'email'],
  ['projects', 'requester_email'],
  ['approved_emails', 'email'],   // field only; doc-ID rename = delete+create, out of scope
  ['users', 'email'],
]
let dirty = 0
for (const [coll, field] of targets) {
  const snap = await db.collection(coll).get()
  for (const d of snap.docs) {
    const v = d.data()[field]
    if (typeof v !== 'string' || !v || v === norm(v)) continue
    dirty++
    console.log(`${coll}/${d.id} ${field}: needs normalization`)
    if (FIX) await d.ref.update({ [field]: norm(v), updated_at: new Date().toISOString() })
  }
}
console.log(dirty === 0 ? 'CLEAN' : `${dirty} row(s) ${FIX ? 'fixed' : 'dirty — rerun with --fix'}`)
process.exit(dirty && !FIX ? 1 : 0)
```
Update-only (no deletes), idempotent, exit code usable as a pre-deploy gate. Also flag (report-only) any `approved_emails` doc whose **ID** is non-normalized — none exist today; if one ever appears it needs a manual create-then-supersede decision, not an automated delete.

**Step 15 — rollout order**:
1. `npm test` green locally.
2. Run verify script (RO, check mode) against prod immediately before merge — expect CLEAN (it was on 2026-07-16).
3. Deploy (single deploy — safe because data is clean; there is no read/write ordering hazard).
4. Run verify script again post-deploy; if a mixed-case row landed during the window (only possible from the three raw-write sites), run `--fix` once via `with-prod-env.mjs`.
5. Manual smoke as Nico: admin dashboard loads with all projects (exercises `isAdminEmail` + admin branch).

## 6. Risk notes

- **`isAdminEmail` is the app's only admin gate.** Normalizing the input cannot open the gate (distinct addresses remain distinct under trim+lowercase; case-variants of one mailbox are already treated as one identity repo-wide per `lib/email/normalize.ts`). The dangerous direction is a typo'd/mixed-case entry in `ADMIN_EMAILS` itself — the Step 1 invariant test pins that. Do NOT normalize by mutating the exported `ADMIN_EMAILS` array shape (tests at `app/api/chat/__tests__/chat.test.ts:80` mock it as a plain array).
- **Post-deploy lockout check**: the change is strictly monotone — every comparison that matched before still matches (all stored data and all `ADMIN_EMAILS` entries are already normalized, so normalizing the other side is a no-op for existing matches). The only behavior changes are new matches that previously failed.
- **`users` doc ID derivation** (`users/route.ts:134`): normalizing changes the derived ID for mixed-case input; prod `users` is clean so no orphaned docs exist.
- **auth-cache** (`lib/api/auth-cache`) keys by uid, not email — unaffected.
- **Garm**: don't expand the `requester_email` fallback work; PR E deletes it. Keep those fixes to one-line normalizations so PR E's deletion diff stays clean.
- **`email/route.ts:67`** trims but doesn't lowercase `requester_email` for outbound send — sending is case-insensitive in practice and the `onlyTo` filter at `:94` already normalizes; out of scope.
