# Reliability hardening — fail-closed crons, Garm liveness, grant reconcile

**Status:** ready to execute
**Origin:** 2026-08-22. A real maker was locked out of prod for 3 days. `syncGarmGrantForEmail`
never created their Garm grant; Garm has been the fail-closed sign-in authority since PR G
(`59505eb`), so the swallowed dual-write failure became a permanent lockout with no detector.
Repaired by hand with one grant upsert. Full write-up in the handoff channel
(`~/src/.handoff/ibuild4you-prompt-lab.md`, entry dated 2026-08-22).

## The pattern

All three tasks below are the same defect class: **code that was correct when written, and
became wrong when something else changed underneath it.**

- `lib/garm-grants.ts`'s swallowed `catch` was right while Firestore was authoritative — a
  missed mirror was cosmetic. PR G made Garm the fail-closed gate and silently promoted every
  swallowed failure to a permanent lockout.
- `app/api/health/route.ts` checked everything that mattered when written; Garm did not exist.
- `if (secret && authHeader !== ...)` was reasonable when `CRON_SECRET` was the whole auth story.

None of these is a regression. The tests still pass — they assert the *old* contract. So the fix
is not "be more careful", it is adding the machinery that makes such transitions safe.

## Global Constraints

1. **TDD.** Write the failing test first, then the implementation. This repo is at 572+ tests and
   `npm test` must be green at every commit. Per-task tests live beside the code they cover, in
   the `__tests__/` convention already used in that directory.
2. **No secret material in code, tests, logs, or commits.** No real emails, no keys. Garm-related
   logging in this repo logs booleans/roles/counts only, never an email address — match that.
   Tests use `@example.com` addresses.
3. **PII rule.** No individual maker/builder names or addresses in code, comments, docs, or test
   fixtures. They live only in briefs and Firestore.
4. **Fail closed.** Every guard added or touched by this plan denies when its configuration is
   absent. Absent config is never a reason to skip a check.
5. **No new dependencies.** Everything here uses what is already in the repo.
6. **Verify before claiming.** `npm test`, `npm run type-check`, and `npm run lint` all pass
   before a task reports DONE. Paste the actual command output in the report.
7. Do not modify `vercel.json` cron schedules for existing routes. Task 3 adds one entry.

---

## Task 1: Make all four cron routes fail closed on missing `CRON_SECRET`

**Batch task — four files, one identical change each. One dispatch, one review.**

### Problem

Every cron route guards with the same shape:

```ts
const authHeader = request.headers.get('Authorization')
const secret = process.env.CRON_SECRET
if (secret && authHeader !== `Bearer ${secret}`) {
  // 401
}
```

If `CRON_SECRET` is unset or removed on Vercel, `secret` is falsy, the condition short-circuits,
and **the route becomes publicly callable by anyone on the internet.** For
`/api/cron/notify` (schedule `*/5 * * * *`) that is a remotely-triggerable path into the
brief-regen billing runaway this repo has already had twice (June 2026, ~$8.4/day on one project).

### Files (exact lines as of this plan)

- `app/api/cron/notify/route.ts:16-18`
- `app/api/cron/notify-digest/route.ts:23-25`
- `app/api/cron/maker-reminders/route.ts:34-36`
- `app/api/cron/expire-captures/route.ts:14-16`

### Required change

Extract one shared helper rather than editing the same expression four times. Create
`lib/api/cron-auth.ts`:

```ts
/**
 * Cron route authorization. Vercel sends `Authorization: Bearer <CRON_SECRET>`.
 *
 * FAILS CLOSED: an unset CRON_SECRET denies every request rather than disabling
 * the check. The previous `if (secret && ...)` shape silently made these routes
 * public whenever the env var went missing — see docs/reliability-hardening-plan.md.
 */
export function isAuthorizedCron(request: Request): boolean
```

Return `true` only when `CRON_SECRET` is a non-empty string AND the `Authorization` header
equals `Bearer ${CRON_SECRET}` exactly. Then replace the guard in all four routes with it,
preserving each route's existing 401 response body and status verbatim.

### Tests

New `lib/api/__tests__/cron-auth.test.ts` covering, at minimum:

- `CRON_SECRET` unset → `false` even with a plausible `Authorization` header
- `CRON_SECRET` set to empty string → `false`
- `CRON_SECRET` set, header absent → `false`
- `CRON_SECRET` set, header wrong → `false`
- `CRON_SECRET` set, header exactly `Bearer <secret>` → `true`

The unset case is the whole point of the task — it must be present and must fail before the
implementation exists.

---

## Task 2: Add a Garm liveness check to `/api/health`

### Problem

`app/api/health/route.ts` runs six Firestore checks and **nothing about Garm**. Since
`isApprovedEmail` gates sign-in on Garm fail-closed, Garm being unreachable means *nobody can
sign in* — and `/api/health` still returns 200 green. `.github/workflows/monitor.yml` polls it
every 10 minutes and would be blind to a total sign-in outage.

### Why `garmCheck` cannot be used directly

`garmCheck` fails closed by contract: on timeout, network error, or a 401 it returns
`{ allowed: false, role: null }` — **byte-identical to a legitimate deny.** A health check built
on it cannot tell "Garm is down" from "that address has no grant". This matters concretely: per
the handoff channel, Garm writes no denial row on a 401, so a revoked or mis-scoped consumer key
is a total silent lockout that never reaches Howl either. Our logs and this check are the only
places it can surface.

### Required change

Add an exported probe to `lib/garm.ts`:

```ts
export interface GarmProbeResult {
  ok: boolean        // true only when Garm returned a well-formed 200
  status?: number    // HTTP status when we got one
  error?: string     // transport/timeout/shape failure message
  ms: number
}

/**
 * Liveness probe for the sign-in dependency. Unlike garmCheck (which fails closed
 * to a deny), this distinguishes "Garm answered" from "Garm is unreachable or
 * rejected our key" — a deny is a HEALTHY answer, a 401 is not.
 */
export async function garmProbe(): Promise<GarmProbeResult>
```

Behavior:

- Unset `GARM_URL` or `GARM_KEY` → `ok: false`, error naming which is missing. (Config absent is
  unhealthy, not skippable — Global Constraint 4.)
- POST `/gnipahellir` with `{ email: 'health-probe@example.com', project: GARM_PROJECT,
  min_role: 'viewer' }`, `cache: 'no-store'`, reusing the existing 2s `TIMEOUT_MS`.
- HTTP 200 with a boolean `allowed` field → `ok: true`. **`allowed: false` is a healthy
  result** — it proves URL, key, scope, and Garm's DB are all working.
- Any non-200 (401 especially), timeout, network error, or off-shape body → `ok: false`.
- **Must not populate `garmCheck`'s module-level cache** — a probe every 10 minutes must never
  seed or evict a real sign-in decision. Write the fetch directly rather than routing through
  `garmCheck`.
- Never logs or returns the consumer key.

Then in `app/api/health/route.ts`, add a seventh check named `garm_reachable` using the existing
`runCheck` helper (have the probe throw inside the callback on `!ok` so `runCheck` records the
error, or add the result directly — implementer's choice, but keep the response shape identical).
The existing `allOk` → 200/503 logic then covers it with no further change.

### Tests

New/extended tests for `garmProbe` in `lib/__tests__/` (mock `fetch`, following the existing
`garm.test.ts` patterns):

- unset `GARM_URL` → `ok: false`
- unset `GARM_KEY` → `ok: false`
- 200 `{allowed:true, role:'viewer'}` → `ok: true`
- **200 `{allowed:false, role:null}` → `ok: true`** (a deny is healthy — the load-bearing case)
- 401 → `ok: false`, `status: 401`
- network throw → `ok: false`
- timeout → `ok: false`
- a probe call leaves `garmCheck`'s cache untouched (call `garmProbe`, then assert a subsequent
  `garmCheck` for the same address still performs a fetch)

Plus a test that `/api/health` reports 503 when the Garm check fails, following whatever route-test
pattern already exists in the repo for health or similar routes.

---

## Task 3: Garm ↔ Firestore grant reconcile cron

### Problem

Nothing detects or repairs drift between Firestore membership (the app's source of truth for who
belongs) and Garm grants (the authority for who may sign in). The dual-write is fire-and-forget
with a swallowed catch, so any dropped `after()`, 2s timeout, or 409 produces a silent permanent
lockout. This is exactly what happened on 2026-08-22.

### Required change

New route `app/api/cron/garm-reconcile/route.ts`.

**Auth:** use `isAuthorizedCron` from Task 1. Same 401 shape as the other cron routes.

**No new authz logic.** Reuse the exported, already-unit-tested `computeGrantDecision` from
`lib/garm-grants.ts`. This task computes the same answer the dual-write computes; it does not
invent a second opinion.

**Algorithm:**

1. Read all `project_members` and all `approved_emails` from Firestore.
2. Build the set of distinct normalized emails across both.
3. For each email, call `computeGrantDecision({ isAdmin, members, isApproved })` — the same
   inputs `syncGarmGrantForEmail` assembles.
4. `GET {GARM_URL}/api/grants?project=ibuild4you` with `GARM_ADMIN_KEY` for actual active grants.
5. Diff expected vs actual into three buckets: `missing` (expected upsert, no active grant),
   `role_mismatch` (grant exists at the wrong role), `extra` (active grant with no expectation).

**Healing policy — additive only:**

- `missing` and `role_mismatch` → **upsert**, actor `ibuild4you-reconcile`.
- `extra` → **report only, never auto-revoke.** Rationale: a Firestore read that fails or returns
  empty would compute "revoke everyone" and mass-lock-out every user. A stale grant is a lesser
  harm than a mass lockout, and the human-facing report makes it visible. Off-boarding already has
  a deliberate revoke path (`/api/approved-emails` DELETE, #163) — this cron is a safety net for
  the *grant-missing* failure mode, not a second off-boarding mechanism.

**Safety cap:** if `missing.length + role_mismatch.length` exceeds `RECONCILE_MAX_HEALS = 10`,
write **no** grants, log loudly, and record the run as `capped`. Healing 10+ accounts at once means
the Firestore read or the diff is wrong, not that 10 people were simultaneously locked out.

**Logging:** write one `garm_reconcile_log` Firestore doc per run — `{ ran_at, checked_count,
missing_count, mismatch_count, extra_count, healed_count, capped, error }`. Mirrors the existing
`reminder_log` precedent. **Counts and booleans only — no email addresses** (Global Constraint 2).

**Response:** JSON with the same counts, so a manual trigger is inspectable.

**Schedule:** add to `vercel.json`, daily, at a time that does not collide with the four existing
crons (which occupy `*/5 * * * *`, `0 15`, `30 15`, `0 16`). Use `0 17 * * *`.

### Ruling: ships healing, not dry-run

This ships in healing mode from the first deploy, not behind a dry-run flag. The safety cap, not a
flag, is the protection. Rationale: this repo's reminders feature has been parked "mid-decision"
behind exactly such a flag since May 2026 — a dry-run flag here would most likely mean the
detector never actually protects anyone. Every run is logged, so the first run is auditable after
the fact.

*Cost if wrong:* an incorrect diff could grant up to 10 unintended `viewer` grants before the cap
stops it. `viewer` is the lowest tier and confers only sign-in, grants are individually revocable,
and every heal is recorded in the log — so the blast radius is small, visible, and reversible.

### Tests

New `app/api/cron/garm-reconcile/__tests__/route.test.ts`, mocking Firestore and `fetch`:

- unauthorized (no/incorrect bearer) → 401, no Garm calls
- no drift → zero upserts, log row with all-zero counts
- one missing grant → exactly one upsert with the expected role
- one role mismatch → one upsert at the corrected role
- an `extra` grant → counted in `extra_count`, **no DELETE issued** (assert `fetch` was never
  called with method DELETE — this is the load-bearing safety test)
- drift above `RECONCILE_MAX_HEALS` → no upserts at all, `capped: true` in the log
- a Garm fetch failure → run records `error`, does not throw a 500 loop
- no email address appears in any log payload

---

## Out of scope

- An `/admin/garm-reconcile` observability page (the `/admin/reminders` precedent exists; add later
  if the log proves worth reading in a UI).
- Auto-revoke / off-boarding via reconcile — deliberately excluded above.
- Changing `lib/garm-grants.ts`'s fire-and-forget dual-write itself. The reconcile is the backstop;
  making the write path synchronous is a larger change with its own latency tradeoffs.
- Garm-side changes (denial digest alerting, repeat-offender detection). Raised with the Garm
  agent in the handoff channel; theirs to rule on.
