# Garm consumer track — ibuild4you plan (drafted 2026-07-13; reconciled to reality 2026-07-15)

Companion to `~/src/garm/docs/build-plan.md` + `~/src/garm/docs/consuming.md`. This plan covers everything that happens in **the ibuild4you repo** (this one): passcode retirement, `project_members` untangling, and consuming `/gnipahellir`. The Garm service itself lives in `~/src/garm` and is that agent's job — don't edit it from here, relay via Nico.

## Two words that are not the same word

**Passcode** = the thing being killed. Our hand-rolled per-member shared secret, minted in 5 routes, pasted into invite emails, stored plaintext on `project_members` rows (`lib/passcode.ts`, `POST /api/auth/passcode`).

**Password** = one of the two things replacing it (Firebase email/password auth, shipped #104), alongside Google.

So "passcode retirement → makers on password" is a real sentence, not a typo. See D3/D4.

## Garm status (2026-07-15)

**Phases 0–4 COMPLETE.** Live in prod at https://garm.prompt-labs.org (canonical; `garm-seven.vercel.app` still resolves as a fallback alias). Neon attached, full smoke passed, `ibuild4you` consumer key minted.

**Nothing on the Garm side blocks us** — confirmed by the garm agent 2026-07-15: `/api/health` green, denials landing in the table correctly. The check path we actually depend on works. Everything remaining is ibuild4you-local work.

Howl (daily denial-digest email) shipped 2026-07-14 but its first live digest never arrived; the garm agent is debugging. **Irrelevant to us** — Howl is an alerting layer downstream of the check path, not part of it. Don't let its status read as a Garm blocker.

## Numbering: the 4-step track vs this doc's phases

Two overlapping schemes exist and they confuse people (they confused Nico on 2026-07-15). The handoff channel's "Garm 1/4 … 4/4" track is a **compressed view of Phases 4–5 only** — it silently assumes Phases 1–3 already happened. Mapping:

| handoff track | this doc | status |
| --- | --- | --- |
| — | Phase 1–2 (PRs A–D): passcode retirement | **not started** |
| — | Phase 3 (PR E): `requester_*` fallback | **not started** |
| **1/4** client wiring | Phase 4, client copy-in | **SHIPPED** (`lib/garm.ts`, PR #153) |
| **2/4** seed script | Phase 4, seed script | **SHIPPED + run live** (32/32 grants) |
| **3/4** cutover | Phase 5 (PR G) | blocked — see below |
| **4/4** retire allowlist | Phase 5 (PR H) | after 3/4 |

**Why 3/4 is "gated on passcode retirement":** Garm's front door answers "may this email use ibuild4you at all." A live `POST /api/auth/passcode` is a *second* front door that never asks Garm — anyone holding a passcode authenticates straight past the gate. Installing the lock while the side door stands open buys nothing. So Phases 1–3 (kill the passcode path, kill the `requester_*` parallel authz path) must land before Phase 5 flips the gate.

That's the real reason. The garm-side note phrases the prerequisite as "all subjects email-keyed," which is thin — passcode auth *is* email-keyed. The side-door framing is the one that actually bites.

Recon basis: full auth/membership touchpoint map, 2026-07-13 (passcode minted in 5 routes; verified in 1; displayed in ShareModal + People panel + dashboard preview; emailed via `copy.invite.body`; **~40 e2e scripts authenticate via passcode** through `scripts/lib/preview-login.mjs`; `projects.requester_id`/`requester_email` is a live parallel authz fallback).

## Decisions

**D1 — Garm grain: one Garm project = one app.** ibuild4you is a single Garm project (`ibuild4you`); briefs are NOT Garm projects. Garm answers "may this email use ibuild4you at all, and how coarsely" — replacing `approved_emails` and the app-level gate. Per-brief membership (`project_members`) stays wholly local. Rationale: the needs-assessment's own finding #3 (every app's richness stays local — byside's roles are app-wide, matching this grain); brief-grain would pollute the ecosystem-wide project namespace with hundreds of ibuild4you-internal slugs and bloat Garm with rows only one consumer understands. ⚠️ This narrows the kickoff's "replace the project_members role lookup" — per-brief roles stay local by design. **CONFIRMED 2026-07-15** — the 2/4 seed shipped and ran live on exactly this grain (32 app-level grants, one per email, role-collapsed across briefs), so D1 is settled in code, not just on paper.

**D2 — Role mapping (app-level, for Garm grants).** Nico/admins → `(email, '*', 'owner')`. People who build/configure briefs → `(email, 'ibuild4you', 'collaborator')`. Makers + apprentices → `(email, 'ibuild4you', 'viewer')`. The 4-tier per-brief ladder (maker < apprentice < builder < owner) is finer than Garm's 3 tiers and stays in `project_members.role`, gated behind Garm's coarse check. Garm's `allowed` gates entry; local role ranks within.

**D3 — Passcodes die entirely.** No dual-run forever: a transition window, then the route is disabled and `passcode` fields are scrubbed from member rows (scrubbing a plaintext credential field is PII hygiene, not a hard delete of a record — the no-hard-deletes convention applies to rows, not credentials). Makers are Nico's friends; he emails them personally about the change — no elaborate in-app migration ceremony needed.

**D4 — Replacement login: Google or email/password, required (decided 2026-07-13).** Both already shipped (#104). Magic links rejected (per-login friction); passkeys deferred (no first-class Firebase support — hand-rolling WebAuthn is the sus kind of hand-rolled auth).

**D5 — Fail mode for Garm checks: fail-open to local data during transition, fail-closed after cleanup — but see Q2.** During Phases 4 (shadow) and early 5, `project_members`/`approved_emails` remain the fallback when Garm is unreachable. Endgame TBD with Nico.

## Migration asset already in hand

Every passcode maker **already has a real Firebase Auth uid** — `/api/auth/passcode` (app/api/auth/passcode/route.ts:42-49) get-or-creates the Auth user by email on first login. So this is credential *attachment*, not account migration. Gaps to close, not blockers:
- Passcode-only makers usually have **no `users` doc** (created only via the display-name gate `PATCH /api/users/me` or Google's displayName upsert in `/api/approved-emails` GET).
- `project_members.user_id` stays `''` until `/api/projects/claim` stamps it; access resolution falls through to email matching (fine — Garm is email-keyed anyway).

## Phase 1 — New-credential onramp (passcodes still work)

**PR A — invite flow mints a password-setup link instead of leaning on passcodes.**
- At invite/participant-create time, server ensures a Firebase Auth account exists: `createUser({ email, password: <random 32 chars> })` (or `updateUser` if the account exists without the password provider). The account now has the password provider, so `adminAuth.generatePasswordResetLink(email)` is guaranteed to work; embed that link in our Resend invite email as "Set your password", alongside "or sign in with Google". Closed signup is preserved — only invited emails ever get accounts.
- ⚠️ Build-time verification (do this FIRST, it shapes the code): (1) confirm `generatePasswordResetLink` behavior for accounts *without* the password provider — if it works provider-less, skip the temp-password step; (2) confirm Google sign-in on an existing email-only account keeps the same uid (Firebase one-account-per-email + trusted-provider takeover) — expected yes, verify on preview.
- `lib/copy.ts` `copy.invite.body` drops the `Email:`/`Passcode:` lines for a link-first body. Reset-link expiry: Firebase oob links expire (~1h–days depending on config) — invite copy must say "link expired? use Forgot password on the sign-in page", which works from then on.

**PR B — migrate existing makers.**
- Post-passcode-login prompt: a maker signed in via passcode sees a dismissible "Passcodes are going away — set a password or connect Google" banner → `SetPasswordModal` (already exists; `linkWithCredential` works for custom-token sessions — verify recent-login is satisfied, expected yes since the sign-in just happened) or Google connect.
- Admin audit script `scripts/audit-auth-providers.mjs`: lists every active maker email + their Firebase Auth providers (password? google.com? none?) so Nico can see who's migrated and nudge his friends personally.
- Login page maker flow (`app/auth/login/page.tsx:44` `isMakerFlow`): passcode form gets a deprecation notice; Google + password promoted.
- **Nico action:** email the makers (they're friends). Draft to send when PR B ships:
  > Heads up — I'm retiring the passcode login on ibuild4you. Next time you open your brief, either tap "Continue with Google" or hit "Set a password" (or use the link in this email). Same account, nothing else changes. Yell at me if anything breaks.

**PR C — e2e harness off passcodes.** `scripts/lib/preview-login.mjs` `launchLoggedIn()` switches from the passcode form to email/password sign-in (the test admin's password is already set via Admin SDK by `e2e-104-full-signin.mjs`'s machinery — reuse that: seed script sets password, gitignored `.test-admin-password` file replaces `.test-admin-passcode`). All ~40 e2e scripts ride the shared helper, so this is one change + a sweep for stragglers that hand-roll login. Test-cast fixtures (`multi-human-cast.mjs`) get Admin-SDK-set passwords instead of passcode fields. **Must merge before PR D or the whole verification fleet goes dark.**

## Phase 2 — Flip: passcodes off (PR D)

Gate: provider audit shows all active makers have password or Google (Nico confirms; his friends, his call on stragglers — the reset-link path can rescue anyone mid-flight).
- Disable `POST /api/auth/passcode` (410 + friendly copy), remove the login-page passcode form, ShareModal/People-panel passcode UI, dashboard invite-preview passcode, the per-member passcode route, all mint sites (create/share/email routes), `lib/passcode.ts`, related hooks/tests.
- Scrub `passcode` fields from all `project_members` rows (one-time script, prod + preview).
- Invite/re-key flows (#12 email re-key, #81 creds re-copy) become link-based: re-key = update email + fresh password-setup link; "copy creds" becomes "copy sign-in link".

## Phase 3 — Pre-Garm authz hygiene (independent of Garm, do anytime)

**PR E — retire the `requester_*` legacy fallback.** `getProjectRole` step 5 (firebase-server-helpers.ts:118-126), the dashboard legacy queries (app/api/projects/route.ts:117-127), and the claim route all honor `projects.requester_id`/`requester_email` directly — a parallel authz path that would silently undermine Garm. Run/verify `scripts/backfill-project-members.mjs` (every project with `requester_*` has a real member row), then delete the fallback. Keep `requester_*` as display-only denormalization.

**Untangling inventory (post-PR-D the row is already cleaner):** `project_members` then holds: authz (`role`), participation (`brief_role`), per-viewer state (`archived_at`, `removed_at`/`removed_by`), identity link (`email`, `user_id`). Credential is gone (passcode scrubbed). Decision: **no collection split** — the remaining fields are all legitimately per-(person, brief) participation state; the conflation problem was the credential + the app-level allowlist, both of which leave. Renaming/refactoring for its own sake is churn.

## Phase 4 — Garm shadow mode (PR F) — client + seed DONE, shadow wiring remains

- ~~Copy-in client~~ **SHIPPED as `lib/garm.ts`** (Garm 1/4, PR #153) — not `lib/garm/client.ts` as originally planned. `garmCheck(email, project, minRole, {failOpen})`: 60s TTL cache, 2s abort timeout, `cache:'no-store'`, deny-by-default field reads, no negative caching. Env `GARM_URL=https://garm.prompt-labs.org` + `GARM_KEY`. **No call sites yet** — that's the point of 3/4.
- ~~Seed script~~ **SHIPPED as `scripts/garm-seed-grants.mjs`** + pure planner `scripts/lib/garm-seed-plan.mjs` (Garm 2/4; plain JS, not the TS this doc first assumed — this repo has no TS script runner). Ran `--live` 2026-07-14: **32/32 grants posted**, verified via `GET /api/grants?project=ibuild4you`. Idempotent upsert — **re-run it whenever membership changes meaningfully** until 3/4 wires live sync.
  - Seeding caught a real gap: `nlovejoy@me.com` had no `system_roles` doc and wasn't in `ADMIN_EMAILS` — the app's only admin gate never recognized it. Fixed (`73f3c8a`). Also skips 2 malformed `approved_emails` rows rather than seeding garbage.
- **Shadow wiring — SHIPPED 2026-07-15.** `lib/garm-shadow.ts`: `isApprovedEmail()` computes its local answer first and returns it unconditionally, then fires `garmCheck` via Next's `after()` and logs **only on disagreement** (booleans + display-only role, never the email — Vercel runtime logs aren't a safe place for PII). `after()` rather than a bare un-awaited promise because serverless freezes the invocation post-response and would silently drop the check — the exact failure the garm repo hit on its denial-log write; falls back to fire-and-forget outside a request scope. Kill switch `GARM_SHADOW` must be exactly `'on'`; **default off**. 17 tests incl. the backlog's `garmCheck` TTL-expiry case.
  - **Next action: flip `GARM_SHADOW=on` in Vercel, let it run ~a week of real traffic, then read the mismatches.** Free signal that de-risks PR G, and costs nothing to leave off if you'd rather not.
  - Still not done in Phase 4: **dual-write** (membership/approved-email writes upserting Garm grants). Deliberately deferred — it touches the same route files PR A was editing. Until it lands, re-run `scripts/garm-seed-grants.mjs --live` when membership changes.
- Dual-write: membership create/remove and approved-email writes also upsert/revoke the corresponding Garm grant (fire-and-forget with logged failure — local remains source of truth in this phase).

## Phase 5 — Garm authoritative (PR G = track's 3/4, then PR H = 4/4 cleanup)

**Gate: Phases 1–3 complete** (passcode path gone, `requester_*` fallback gone). Don't start before then — see the side-door reasoning at the top.

- `isApprovedEmail()` → `garmCheck(email, 'viewer')`. The `/api/approved-emails` GET (the `useApproval` client gate) answers from Garm. Admin implicit-owner can migrate from the `ADMIN_EMAILS` constant to a Garm `'*'` owner grant (keep the constant as break-glass).
- Fail mode per D5/Q2. Writes: Garm becomes the primary for app-level access; `approved_emails` collection frozen (export to `exports/`, then stop writing; delete later — no rush).
- PR H: remove shadow-mode logging, dead approved_emails code paths, update CLAUDE.md data model + firestore.rules notes.

## Explicitly out of scope

Per-brief role ladder migration (stays local forever per D1), Howl, the prompt-labs.org admin UI, other repos' consumption, `getViewerBriefRole`'s missing removed-filter (pre-existing quirk — file an issue, don't fold in).

## Sequencing & effort

PRs A→B→C→D are strictly ordered; E is independent (anytime); F→G→H after Garm ships. A/B/C/E are Sonnet-suitable with this plan; D is a wide mechanical sweep (Sonnet fine, big diff); F/G touch the security gate — Opus recommended. Each PR: TDD, preview e2e, confirm before merge (D and G especially — D locks out anyone unmigrated, G changes the front-door gate).

## Open questions for Nico

1. ~~**D1 grain confirm**~~ **ANSWERED 2026-07-15** — app grain, confirmed by the live 32-grant seed. Briefs stay local.
2. **Endgame fail mode** when Garm is unreachable and cache is cold: (a) fail-closed (locked out until Garm recovers — pure, but your friends hit errors on a Garm blip), or (b) fail-open to the last-known local membership row (approved_emails is gone, but `project_members` still exists locally and can serve as the degraded-mode answer). Recommend (b) for this app's stakes. **Still open** — needed before PR G, not before PR A.
3. **Timing — this is the live decision.** Start Phase 1 (PR A) now? It's pure ibuild4you work, zero Garm dependency, and it's the long pole: everything downstream (3/4, 4/4) waits on it. Garm has been ready since 2026-07-14 and the track is stalled here.

**Relay to the garm agent (still needed):** its `docs/build-plan.md:138` first-consumer section says "`approved_emails` allowlist + `project_members.role` reads replaced by a gnip check" — should read "`approved_emails` + the app-level gate replaced; per-brief roles stay local" (D1, now confirmed). Its decision #10 (line 18) is fine as written.
