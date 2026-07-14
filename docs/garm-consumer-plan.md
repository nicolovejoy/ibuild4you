# Garm consumer track — ibuild4you plan (drafted 2026-07-13)

Companion to `~/src/garm/docs/build-plan.md` + `~/src/garm/docs/consuming.md`. This plan covers everything that happens in THIS repo: passcode retirement, `project_members` untangling, and consuming `/gnipahellir`. Phases 1–3 don't depend on Garm existing and can start immediately; Phases 4–5 gate on Garm deployed.

**Garm status 2026-07-13:** phases 0–3 built (repo https://github.com/nicolovejoy/garm, 76 tests green); Phase 4 (Vercel + Neon deploy, `ibuild4you` consumer key mint, live smoke) pending in the garm session. Don't edit that repo from here — relay via Nico.

Recon basis: full auth/membership touchpoint map, 2026-07-13 (passcode minted in 5 routes; verified in 1; displayed in ShareModal + People panel + dashboard preview; emailed via `copy.invite.body`; **~40 e2e scripts authenticate via passcode** through `scripts/lib/preview-login.mjs`; `projects.requester_id`/`requester_email` is a live parallel authz fallback).

## Decisions

**D1 — Garm grain: one Garm project = one app.** ibuild4you is a single Garm project (`ibuild4you`); briefs are NOT Garm projects. Garm answers "may this email use ibuild4you at all, and how coarsely" — replacing `approved_emails` and the app-level gate. Per-brief membership (`project_members`) stays wholly local. Rationale: the needs-assessment's own finding #3 (every app's richness stays local — byside's roles are app-wide, matching this grain); brief-grain would pollute the ecosystem-wide project namespace with hundreds of ibuild4you-internal slugs and bloat Garm with rows only one consumer understands. ⚠️ This narrows the kickoff's "replace the project_members role lookup" — per-brief roles stay local by design. **Confirmed-with-Nico required before Phase 4.**

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

## Phase 4 — Garm shadow mode (PR F; gate: Garm deployed + `ibuild4you` consumer key minted)

- Copy-in client: the reference implementation already exists in garm's `docs/consuming.md` (`garmCheck` with 60s TTL cache + per-call `failOpen` opt) — copy as `lib/garm/client.ts`, hardcode project `ibuild4you`, gate on `allowed` only. Env (matching the reference): `GARM_URL`, `GARM_KEY` (Vercel, both environments; preview points at the same prod Garm — it's config data, not user data).
- Seed script `scripts/seed-garm-grants.mjs`: derive app-level grants from live data per D2 (any active builder/owner membership or admin → collaborator/owner; any active maker/apprentice membership or approved_email → viewer), POST to Garm admin API. Idempotent, re-runnable.
- Shadow wiring: `isApprovedEmail()` and the app-entry gate keep answering from local data, but also fire `garmCheck` and log agreements/mismatches (console + a counter — measurement-minimalism: one log line per mismatch, no dashboard). Run for a week of real traffic.
- Dual-write: membership create/remove and approved-email writes also upsert/revoke the corresponding Garm grant (fire-and-forget with logged failure — local remains source of truth in this phase).

## Phase 5 — Garm authoritative (PR G, then PR H cleanup)

- `isApprovedEmail()` → `garmCheck(email, 'viewer')`. The `/api/approved-emails` GET (the `useApproval` client gate) answers from Garm. Admin implicit-owner can migrate from the `ADMIN_EMAILS` constant to a Garm `'*'` owner grant (keep the constant as break-glass).
- Fail mode per D5/Q2. Writes: Garm becomes the primary for app-level access; `approved_emails` collection frozen (export to `exports/`, then stop writing; delete later — no rush).
- PR H: remove shadow-mode logging, dead approved_emails code paths, update CLAUDE.md data model + firestore.rules notes.

## Explicitly out of scope

Per-brief role ladder migration (stays local forever per D1), Howl, the prompt-labs.org admin UI, other repos' consumption, `getViewerBriefRole`'s missing removed-filter (pre-existing quirk — file an issue, don't fold in).

## Sequencing & effort

PRs A→B→C→D are strictly ordered; E is independent (anytime); F→G→H after Garm ships. A/B/C/E are Sonnet-suitable with this plan; D is a wide mechanical sweep (Sonnet fine, big diff); F/G touch the security gate — Opus recommended. Each PR: TDD, preview e2e, confirm before merge (D and G especially — D locks out anyone unmigrated, G changes the front-door gate).

## Open questions for Nico

1. **D1 grain confirm**: Garm project = the ibuild4you app (briefs stay local). OK? (This narrows the original kickoff wording — reasoning above.)
2. **Endgame fail mode** when Garm is unreachable and cache is cold: (a) fail-closed (locked out until Garm recovers — pure, but your friends hit errors on a Garm blip), or (b) fail-open to the last-known local membership row (approved_emails is gone, but `project_members` still exists locally and can serve as the degraded-mode answer). Recommend (b) for this app's stakes.
3. **Timing**: start Phase 1 (PR A) now, before Garm ships? It's pure ibuild4you work with no Garm dependency.

If Q1 confirms D1 (app grain), one relay to the garm agent: its `docs/build-plan.md` first-consumer section still says "`project_members.role` reads replaced by a gnip check" — should read "`approved_emails` + the app-level gate replaced; per-brief roles stay local."
