# Garm 2/4 — seed script (DECIDED plan, ready to execute)

Second of the 4-item Garm consumption track (full track: `~/src/.handoff/ibuild4you-prompt-lab.md`, "2026-07-14 garm to ibuild4you"). 1/4 (client wiring) shipped in PR #153. This is **Sonnet-suitable**, TDD.

**Goal:** one-time (re-runnable) script that reads current app membership and seeds one Garm grant per person on the `ibuild4you` project, so 3/4's `garmCheck` gate has data to resolve against. **Reads app data read-only; writes only to Garm** (never to Firestore).

## Contract (from garm repo `docs/build-plan.md`)

- Admin API auth: `Authorization: Bearer <GARM_ADMIN_KEY>` (env; from 1Password `op://dev-secrets/garm/password`). **Not** the consumer key. Never print it.
- `POST {GARM_URL}/api/grants` `{ email, project, role, actor }` — upsert: atomically revoke any active grant for `(email, project)` + insert the new one. **Re-run safe / idempotent.**
- `GET {GARM_URL}/api/grants?project=ibuild4you` — list active grants (for post-run verification).
- `GARM_URL` = `https://garm.prompt-labs.org` (canonical). Roles: `viewer | collaborator | owner`.

## The one real decision — collapsing per-brief roles to an app-level role

Garm's `ibuild4you` project is **app-level**; this app's membership is **per-brief**. A person can be `owner` on one brief and `maker` on another. The seed must produce **one** role per email. Decided rule:

1. **Role source = highest `project_members.role` across the person's active rows** (`removed_at == null`), by rank `owner > builder > apprentice > maker`.
2. **Map to Garm:** `owner → owner`, `builder → collaborator`, `apprentice → viewer`, `maker → viewer` (locked mapping from the handoff).
3. **System admins** (`ADMIN_EMAILS` in `lib/constants.ts`, plus any `users.system_roles` containing `admin`) → **`owner`**, overriding (2).
4. **In `approved_emails` but no active member row** (invited-but-inactive, or admin-only) → **`viewer`** (app-approved, no elevated role).
5. **Dedup by `normalizeEmail`** (use the new `lib/email/normalize.ts`). Excluded/removed rows never contribute.

> Confirm rule (1) with Nico before the `--live` run — "highest role wins" is the judgment call. Everything else is mechanical.

**Subject set = union of** `approved_emails` docs + active `project_members` emails + `ADMIN_EMAILS`, normalized + deduped.

## Build (TDD)

1. **Pure planner** — `lib/garm/seed-plan.ts` (mirrors `lib/members/lifecycle.ts` style):
   `buildGrantPlan({ approvedEmails: string[], members: {email,role,removed_at}[], adminEmails: string[], systemAdminEmails: string[] }): { email: string, role: 'viewer'|'collaborator'|'owner' }[]`
   - Implements rules 1–5 above. Deterministic, sorted by email for stable dry-run diffs.
   - Unit tests: highest-role-wins across two briefs; admin override beats a low brief role; approved-only → viewer; removed rows excluded; case/whitespace email variants collapse to one entry; each MemberRole maps correctly; empty inputs → `[]`.
2. **Script** — `scripts/garm-seed-grants.mjs`:
   - Read-only Firestore via `scripts/fixtures/db.mjs` / `with-prod-env-ro.mjs` (reads `approved_emails`, `project_members`, `users`). No Firestore writes.
   - Build the plan via the pure module.
   - **Dry-run by default:** print the `{email → role}` table + count. `--live` POSTs each grant (`actor: 'seed-script'`, Bearer `GARM_ADMIN_KEY`) to `{GARM_URL}/api/grants`.
   - `GARM_URL` + `GARM_ADMIN_KEY` from env; refuse to run `--live` if `GARM_ADMIN_KEY` unset. Never log the key.
   - After a `--live` run: `GET /api/grants?project=ibuild4you`, assert active count == planned count, print PASS/FAIL.

## Pass criteria (from the handoff)

- Dry-run output matches the membership list exactly, incl. role mapping.
- After `--live`: `GET /api/grants?project=ibuild4you` count matches the plan.
- Re-run is safe (upsert) — a second `--live` produces the same active-grant set, no duplicates.

## Notes / gotchas

- **Admin key needs to reach the runner.** It's Vercel-only for the service; for a local script, Nico injects it: `export GARM_ADMIN_KEY=$(op read "op://dev-secrets/garm/password")` before running (or pipe). The script reads `process.env.GARM_ADMIN_KEY`.
- Firestore read-only key already exists (`with-prod-env-ro.mjs`, datastore.viewer).
- No PII in logs/commits: dry-run prints emails to Nico's terminal only — fine locally, but don't paste the output into issues/PRs.
- This does **not** touch call sites or the allowlist — that's 3/4 (Opus, gated on passcode retirement).
