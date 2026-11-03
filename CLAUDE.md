# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Is

iBuild4you.com — an AI-powered project intake system. A conversational agent guides non-technical users through discovery and produces a structured "living brief" that evolves over multiple sessions. Builders review briefs and annotate them; those annotations inform the agent's next session with the requester.

## Three Roles

- **Requester** — non-technical person with an app/website idea, chats with the agent
- **Agent** — conducts conversations, extracts structure, produces/updates the living brief
- **Builder** — reviews briefs on a dashboard, adds annotations that feed back into agent context

## Stack

- Next.js App Router on Vercel
- Firestore (`ibuild4you-a0c4d` Firebase project) — all DB access through API routes using Firebase Admin SDK, never from client components
- Firebase Auth with Google OAuth + email/password login (passcodes retired 2026-07-17, Garm PR D; the old `/api/auth/passcode` route is gone)
- Shared `apiFetch()` client helper with Bearer tokens
- React Query for state management
- Tailwind CSS v4 with @theme inline tokens
- Claude API (Sonnet) for agent conversations via SSE streaming

Architecture is cloned from NoteMaxxing (`/Users/nico/src/notemaxxing`). NoteMaxxing patterns are the reference for how things should be done here.

## Commands

```
npm run dev          # Start dev server
npm run build        # Production build
npm run lint         # ESLint
npm run lint:fix     # ESLint with auto-fix
npm run type-check   # TypeScript check (tsc --noEmit)
npm run format       # Prettier format all files
npm test             # Run tests (vitest)
npm run test:watch   # Run tests in watch mode
```

## Architecture

- `app/` — Next.js App Router pages and API routes
- `app/api/` — All data access goes through API routes using Firebase Admin SDK
- `lib/firebase/` — Client SDK (`client.ts`), Admin SDK (`admin.ts`), `apiFetch()` helper
- `lib/s3/` — S3 client for file storage (uploads go to `ibuild4you-files` bucket)
- `lib/api/` — Server-side auth helpers (`getAuthenticatedUser`, `requireAdmin`)
- `lib/hooks/` — React hooks (`useAuth`)
- `lib/query/` — React Query client config and hooks
- `lib/types/` — TypeScript types for all entities
- `lib/copy.ts` — All user-facing text centralized in one file for easy editing
- `lib/agent/` — Agent system prompt, prep prompt, welcome message generator, constants
- `components/ui/` — Reusable UI primitives (Button, Modal, Card, StatusMessage, etc.)
- `components/builder/` — Builder project view (sessions, brief, setup tabs)
- `components/maker/` — Maker project view (chat, brief card)
- `components/` — App-level components (ErrorBoundary, UserMenu)
- `lib/integration/` + `app/api/integrations/` — stars-demo round-two integration (see Data Model).
- **Loop** — the feedback mechanism: a widget embedded on host apps → `/api/feedback` → admin inbox at `/admin/feedback` (per-app at `/admin/apps/<slug>`; apps are created and configured at `/admin/apps`) → optional GitHub issue. Overview + how to embed: `docs/loop.md`. Wire contract: `lib/feedback/README.md`.

Key pattern: clients call `apiFetch()` which attaches the Firebase Bearer token. API routes call `getAuthenticatedUser(request)` to verify the token server-side before accessing Firestore via `getAdminDb()`.

## Data Model

- **users** — identity (email, first_name, last_name), auto-populated from Google sign-in
- **approved_emails** — per-email approval record, keyed by normalized email. **Not the sign-in gate** (Garm is, since PR G) except on a preview deployment with no Garm wiring. Still live as an *input* to the Garm grant (dual-write + hourly reconcile): an approved email with no brief gets a viewer grant, and `revoked_at` (off-boarding, #163) drives the revoke. Writers validate address shape (`isValidEmail`, PR H).
- **project_members** — role-based membership (owner, builder, apprentice, maker); makers sign in with Google or a password-setup link (passcodes retired, PR D). Nobody can invite, re-role, remove, restore or re-key onto their own row (`selfEditError`/`isSelfRow` in `lib/members/`, #245); your own People row is read-only.
- **projects** — one per maker engagement, includes agent config (session_mode, directives, opener), requester name/email, tracking fields (shared_at, last_nudged_at), `maker_waiting_since` (server-written by kickoff when it posts the nothing-queued greeting; cleared by the next maker turn or by an import; drives the builder's "Maker waiting" dashboard state).
- **sessions** — each conversation between maker and agent, snapshots agent config at creation
- **messages** — individual messages within a session, role (user/agent) and timestamp, optional file_ids. Optional `kind`: only `unqueued_greeting` today (the canned nothing-queued note, set by kickoff, removed by import).
- **files** — uploaded files (metadata in Firestore, bytes in S3 at `ibuild4you-files` bucket), scoped to project
- **apps** — Loop host apps, doc id = slug (`name`, `github_repo`, `feedback_requires_identity`, `brief_id`, `legacy_slugs` = ids widgets still send, `created_by` provenance only, timestamps). Settings only. Since Phase B an app's admins live only in Garm (owner/collaborator grants on the app slug), read live through Loop's key (`GARM_LOOP_KEY`, `lib/garm-loop.ts`) on every request; nothing about them is stored or cached locally. Ingest resolves a canonical or legacy slug and stores the canonical one on `feedback.project_id`; signing secrets are `loop_signing_secrets/{slug}`.
- **briefs** — living brief for a project, structured and versioned; the comms agent curates it at each paste and the app writes a note after each conversation. Since #194 every overwrite archives the outgoing version to `briefs/{id}/versions/{version}` (`{version, content, updated_at, source, archived_at}`, no cap) and the live doc carries `source` (`create`|`paste`|`regen`|`restore`); `GET /api/briefs/versions` lists them (builder+). Since #229 the app no longer rewrites the brief after a conversation: a `briefs/{briefId}/notes` subcollection holds one short note per conversation stretch (written by the notify cron or the Brief tab's "Write note now", `lib/api/note-writer.ts` / `lib/api/brief-notes.ts`; `folded_at` is set when a curated paste folds it in), `projects.notes_through_at` marks how far notes cover, and a confirmed maker reversal of a locked decision sets `contested` at note time as a version with `source: 'note'` (sources are now `create`|`paste`|`restore`|`note`), and the Brief tab's History → Restore re-submits one through `PUT /api/briefs` with `source: 'restore'`. `open_risks` elements are `string | { text, owner }`. Content may also carry optional `shipped` `[{date, items}]` (dated batches of what went out) and `queued` `[string]` (what is next, not built) (#219).
- **reviews** — builder annotations on a brief, feed back into agent context for next session
- **garm_denials** — counts-only record of sign-in denials keyed by sha256(email); kind unknown-principal | known-member (lib/garm-denials.ts). No addresses stored. The hourly garm_reconcile_log row carries 24h counts of each.
- **loop_read_keys** — one per Loop app, doc id = canonical slug: `{ key_hash (sha256 hex), created_at, created_by, last_used_at? }`. The key itself is shown once at mint on `/admin/apps/<slug>` (system admin) and never stored. Used by `GET /api/feedback/read` (contract `lib/feedback/READ.md`).
- **integration_groups / integration_participants / integration_messages / integration_ops** — stars-demo round-two group conversations, server-to-server only (contract `/Users/nico/src/stars-demo/docs/specs/08a-ibuild4you-contract.md`; plan `docs/superpowers/plans/2026-09-22-stars-demo-round-two-integration.md`). Separate top-level collections on purpose: the client-readable `messages` rule, admin implicit-owner, brief regen, dashboard enrichment and the notify cron never see them. Messages carry an opaque `author_id` + `author_label`, never email or name. Routes under `app/api/integrations/stars-demo/*`, auth in `lib/api/integration-auth.ts`, store in `lib/integration/`.

## Project Setup JSON

Projects can be created and updated via JSON payloads. The dashboard's "Import JSON" tab accepts the create payload directly.

### Create (POST /api/projects)

Only `title` is required. All other fields are optional.

```json
{
  "title": "Sam's Cafe App",
  "requester_email": "sam@example.com",
  "requester_first_name": "Sam",
  "requester_last_name": "Lee",
  "participants": [
    { "email": "sam@example.com", "first_name": "Sam", "last_name": "Lee", "role": "maker" },
    { "email": "dana@example.com", "first_name": "Dana", "role": "apprentice", "brief_role": "contributor" }
  ],
  "context": "Background info the agent uses to skip basic discovery questions. Do not suggest technologies.",
  "welcome_message": "Hey Sam — tell me about your cafe idea!",
  "nudge_message": "Optional. When set, used verbatim as the outbound nudge text for the next session and skips AI generation. Leave blank to let the AI draft.",
  "voice_sample": "Optional. One paragraph showing how you'd text this person by hand. Used as a style anchor for AI-generated outbound copy (nudge/invite/reminder). Ignored when nudge_message is set.",
  "session_mode": "converge",
  "language": "fr",
  "model": "claude-sonnet-5-5",
  "hide_title_in_previews": false,
  "seed_questions": [
    "What problem are you trying to solve?",
    "Who are your customers?"
  ],
  "builder_directives": [
    "Focus on the ordering workflow"
  ],
  "brief": {
    "problem": "Customers can't order online",
    "target_users": "Local cafe customers",
    "features": ["Online ordering", "Pickup scheduling"],
    "constraints": "Must work on mobile",
    "additional_context": "",
    "decisions": [{ "topic": "Payment", "decision": "Stripe only", "locked": true }]
  },
  "session_opener": "Alias for welcome_message (either works)"
}
```

Side effects on create: generates slug, creates owner membership, creates a membership + approves email **for each participant** (see below; sign-in is via Google or the invite flow's password-setup link), creates first session (snapshots config), adds welcome message as first agent message, creates initial brief (if `brief` provided).

An open risk may be a plain string or `{ "text": "…", "owner": "maker" | "builder" }`: maker means only they can settle it, builder means it is the builder's to resolve. The note writer records owners on new risks, and every paste carries an existing owner forward by text match, also from folded notes (#220); the Brief tab lists maker-owned ones with Copy as markdown, and the dashboard row counts them.

**Participants.** `participants[]` seeds any number of people on a brief in one payload — each `{ email (required), first_name?, last_name?, role?, brief_role? }`. `role` is a `MemberRole` (`maker` | `apprentice` | `builder` | `owner`; default `maker`); `brief_role` defaults from role (maker→originator, apprentice→contributor, builder→reviewer). The legacy `requester_email`/`requester_first_name`/`requester_last_name` (+ `brief_role`) still work and are folded in as the first participant. Rules: dedup by lowercased email; the creator's own email is skipped (already the owner); the project doc's displayed requester is the first `maker` participant (else the first overall); **soft cap 20** (more → 400). No hard limit elsewhere — the chat roster name-tags arbitrarily many distinct senders. The response includes a `members: [{ email, role, brief_role }]` array (passcodes no longer minted or returned, PR D).

`language` (optional, `en` | `fr`, default English): the language the maker is addressed in — the agent converses in it from the first message, welcome/nudge copy is written in it, every outbound maker email (invite, nudge, reminder, the cron's reminder digest; `lib/email/outbound-copy.ts`) is sent in it, and link previews use it. The password-reset email follows the sign-in page's locale instead, since it has no brief. The brief itself always stays in English. `hide_title_in_previews` (optional boolean): a shared `/projects/<slug>` link previews with the brief title unless this is true (then the anonymous colour/glyph/code card). Previews are unauthenticated and cached by messaging apps — never names or brief contents.

`model` (optional, `claude-sonnet-4-6` | `claude-sonnet-5-5` | `claude-opus-5-5`; omitted, blank or null = Default) picks the model Sam talks with on this brief (#189). Precedence: the brief's `model` > `CHAT_MODEL` > `AGENT_MODEL`. Chat and kickoff only; welcome, prep and note writing keep their own models. It applies from the next conversation: a session snapshots it as `agent_model`, and sessions created under Default stay Default. Any other value is a 400. It is a Setup-tab setting, not part of the comms-agent payload schemas.

`seed_questions` reach the agent only in `discover` mode and `builder_directives` only in `converge` mode (#192); both are stored regardless, so flipping `session_mode` never loses them. Guardrails that must hold in every session (e.g. "do not suggest technologies") go in `context`, which is always sent. The dashboard Setup tab already shows one or the other per mode; a JSON payload that sets both in `discover` mode simply has its directives held until the mode flips.

`layout_mockups` (retired with the wireframes in #195 phase 2) is no longer accepted since this release (#210): create and PATCH treat it like any other unknown field and ignore it.

A decision may carry `"locked": true` — a durable constraint (locked convention / do-not-use rule). Locked decisions are carried verbatim by the curation prep's rules, and a stamped ferry-desk paste (one carrying a valid `prep_stamp`) cannot drop, reword or unlock one, nor clear or replace its `contested`/`contest_dismissed`: the server restores every lock from the live brief (`restoreLocksOnPaste`, #229). The agent must reconcile new intake against them: a maker statement contradicting a locked decision triggers an explicit confirm instead of a silent overwrite (#71). Set via the create payload or the Brief-tab JSON paste (`PUT /api/briefs`). Since #197 a lock may be **contested** instead: at note time the note writer sets `contested: { proposed, reason }` on the locked decision when the maker explicitly confirmed a reversal in conversation (`lock_reversals`); the text and lock stay verbatim, the chat prompt shows the contest so Sam neither reopens nor adopts it, and the Brief tab shows a `Contested` badge with **Accept, keep locked** / **Accept and unlock** / **Dismiss** (all save through `PUT /api/briefs`, source `paste`). `contested` is only ever kept on a locked decision. Dismiss records `contest_dismissed { proposed, at }` so a later note does not re-raise the same proposal; a different proposal still can.

Decision provenance (#121): code stamps `decided_in_session`/`decided_at` on a new topic and never trusts the model's. Since #218 a changed decision on a known topic (matched by trimmed, case-insensitive `topic`) is a **revision**: the origin stamps stay verbatim and `revised_in_session`/`revised_at` record the latest revision (only the latest is kept; the version history has the trail). A changed decision with no origin stamp gets only `revised_*`. The Brief tab reads `conv 2 · Jul 11, revised conv 4 · Oct 17`; the markdown exports `(decided conv 2, 2026-07-11; revised conv 4, 2026-10-17)`. A History → Restore whose text differs from the live decision reads as a revision today, by design.

The Brief tab's editor (structured or raw) and History → Restore ask first when a save would drop a lock ("This save removes the lock on: …"); those saves are unstamped, so a confirmed unlock goes through. A stamped ferry-desk paste needs no prompt because the server restores its locks and contests. An unstamped paste (old prep, hand-written JSON) and direct PUT callers behave as before: no prompt, and the payload's decisions are saved as sent.

### Update (PATCH /api/projects)

Requires `project_id`. Only these fields are accepted: `title`, `context`, `welcome_message`, `nudge_message`, `voice_sample`, `session_mode`, `seed_questions`, `builder_directives`, `requester_first_name`, `requester_last_name`, `last_nudged_at`, `prep_copied_at`, `payload_pasted_at`, `payload_pasted_version`, `last_builder_activity_at`, `identity`, `github_repo`, `auto_reminders_enabled`, `language` (`en`|`fr`, else 400), `model` (one of the three ids; `''`/null = Default; else 400), `hide_title_in_previews` (boolean, else 400). Changing `title` regenerates the slug.

## Agent Behavior Rules

- Neutral, non-opinionated tone; slightly mirrors requester's writing style
- Plain language only — never UX jargon like "user journeys" or "microservices"
- Early sessions: broad discovery. Later sessions: more specific as brief fills in
- At natural checkpoints, summarize back for validation ("So you want X and Y but not Z, right?")
- Sam asks the maker about maker-owned open risks when it fits, and does not push them on builder-owned ones (#220).
- System prompt includes: current living brief, builder review annotations, prior session history, and (#229) a `## New since the brief was last curated` block of unfolded notes (in the stable, cached system block), so Sam reads what changed since the last curated paste without the brief being rewritten each time
- **Owners and builders can write in the conversation** from the Conversations tab (#245). The composer has a "Sam replies" checkbox (on by default); off posts a note with no model call (`reply: false` on `POST /api/chat`). Their messages are labelled Builder in Sam's roster and in the note writer's input, as guidance rather than the maker's own words.
- **Who speaks first.** A conversation opens with the builder's `welcome_message` **word for word**: always on a brief's first session (default copy if none is set), and on session 2+ only when that welcome is new for this round — one an earlier conversation already used is stale and is not replayed (`lib/sessions/welcome.ts`, applied at session creation and on share). The kickoff never greets into a session that already opens with a welcome. Otherwise, on session 2+ the agent greets via kickoff (`lib/agent/kickoff.ts` decides client-side, `/api/chat/kickoff` is the authority): always on an **empty** return session with prior maker history (PR #177), otherwise only ≥1hr after the maker's last message. Kickoff is maker-only — builder-side roles (incl. admins, who resolve to `owner`) never trigger it. When the ferry desk has not stamped a paste newer than the maker's last message (`isPayloadQueued`), kickoff posts a canned "nothing queued yet" note on an empty return session, or once the builder has copied the next-convo prep after the maker's last message (`isUnqueuedReturn`), instead of a model greeting, sets `maker_waiting_since` and emails the builder; the next import replaces it with the new welcome (#214; `scripts/e2e-214-stale-greeting.mjs`).

## MVP Scope

Conversational intake → structured living brief → builder review → next session picks up where left off.

NOT in MVP: process flow diagrams, data architecture drafts, microservice sketches, comparable app analysis, whiteboard UI mockups.

## Testing & Deployment

- **Preview environment**: Stable URL at `preview.ibuild4you.com`, aliased to the `preview` git branch. To eyeball any feature branch on preview: `git push origin <branch>:preview --force`. Vercel rebuilds within ~1–2 min. Wired 2026-05-15 (DNS via Cloudflare → Vercel; Firebase Auth + GCP OAuth domains authorized; Vercel Deployment Protection off for previews).
- **Production-first testing has been retired** for risky changes — ship via PR + preview-test instead. Trivial / doc-only changes can still go direct-to-main.
- **CI/CD**: GitHub Actions runs `type-check`, `lint`, `build`, `test` on PRs and pushes to main. Vercel handles deploys (preview per branch, prod on main).
- **TDD when possible**: Write tests before implementation. Skip only when it genuinely doesn't fit (pure UI layout, exploratory prototyping).
- **Agent-driven e2e (headless Playwright).** The agent can log into preview/prod as the test admin and drive the UI. Shared helper: `scripts/lib/preview-login.mjs` — `launchLoggedIn()` returns an authenticated `{ browser, page }` (bypass-cookie + **email/password** login, handles the #104 dual-email-field selector gotcha). New e2e scripts are a few lines (see `scripts/e2e-preview-login.mjs`). Requires gitignored `.ibuild4you-bypass` (Vercel Protection Bypass token) + `.test-admin-password` (seed the user via `scripts/seed-test-admin.mjs`, then set its password via `scripts/seed-test-admin-password.mjs`), and `npm i --no-save playwright`. **Rebuilding these on a new machine (done on the laptop 2026-09-17):** bypass token is `op://dev-secrets/ibuild4you-vercel-bypass/password` (`op read … > .ibuild4you-bypass`); test-admin password is `op://dev-secrets/ibuild4you-test-admin-password-preview/password` (`op read -n … > .test-admin-password`); the seed scripts run as `op run --env-file=.env.preview.tpl -- node scripts/with-preview-env.mjs node scripts/<seed>.mjs` (committed template, preview service account; needs an empty-is-fine `.env.preview.local`). The test admin resolves to `owner`, so maker-only behaviour (kickoff greeting) needs a test-cast identity instead. Env overrides: `E2E_BASE` (prod URL), `E2E_PASSWORD_FILE` (`.test-admin-password-prod` for prod), `E2E_EMAIL`. **Garm PR C (2026-07-16):** the harness moved off passcode login onto password login ahead of PR D retiring the passcode route entirely — `loginWithPassword()` is the underlying primitive if you need to sign in as a non-admin seeded identity (e.g. a test-cast member; passwords for those live in `.test-cast-passwords.json`, seeded alongside `.test-cast-passcodes.json` by `scripts/fixtures/scenarios/multi-human-cast.mjs`). **Note:** Google sign-in works on preview since #107 but Playwright can't drive Google; password is the headless path. **PR D (2026-07-17, `b4ae8d4`) retired passcodes entirely** — the route answers 410, nothing mints the field, and all e2e scripts (harness + product-flow) sign in via password.

## Code Style

Keep the code approachable — clarity over cleverness. Code should be:
- Clear and straightforward — no clever abstractions
- Well-commented where non-obvious
- Following patterns established in NoteMaxxing

## Next Steps

> Shipped history lives in `docs/changelog.md` (newest first). **Prepend an entry there at session end — routine `/handoff` no longer touches docs (it only saves the session row), so do it explicitly before closing.** This section is **live work only**. Canonical backlog: `gh issue list --state open`. Durable gotchas and runbooks are in the next section.

**Watch.**
- musicforge's read-key smoke PASSED 2026-11-02 (limit=5: 5 items, sender tags, no email in the body). Still to come: their from-server smoke once the musicforge Fly route ships (#244; key at `op://dev-secrets/loop-read-key-musicforge/password`). Embed spike (Loop Phase 2) only if their panel proves not enough.
- First brief notes on prod (`api_usage` route `brief.note`), and F4FC's first curated paste bringing `l6-shapes-positions-game` under 20,000 chars (#229, PR #239).

**Queue.** Nothing in flight (#232, #246, #189 shipped 2026-11-02). Open follow-up: on the read-key form 1Password also offers "Sign in" with a saved ibuild4you login, which would overwrite the shown-once key; dismiss it, or suppress it if it bites. Conversation-experience brainstorm still open (thumbs up/down exists as #130; question is what to do with the signal).

**Loose ends (no issue).**
- Garm listing contract still unconfirmed (`GET /api/grants?project=X` → `{grants:[...]}`, active-only, unpaginated).

## Gotchas and runbooks

**🔴 `npm run type-check` is NOT equivalent to `npm run build` in a worktree.** `type-check` is `tsc --noEmit`, and tsconfig includes `.next/types/**/*.ts` — absent in a fresh worktree, so Next's route-signature validation silently checks **nothing** (a branch with `export const` in a `route.ts` passed three reviews this way). **In a worktree, run BOTH `npm run build` AND `npm run type-check` before claiming clean**: `build` skips test files (a badly typed test mock passes `build` and fails CI's `tsc`, PR #176); `type-check` skips route-export validation without `.next/types`. Either alone is a false green.

**🔥 Note-writer cost runaway** (the PR #78 breaker, now guarding the note writer): if Anthropic costs spike, query `api_usage` grouped by route+project for one stuck at the cron interval (`scripts/api-usage-by-project.mjs --route brief.note`; older rows from the retired regen are `brief.generate`). Gate: `lib/api/brief-regen-gate.ts` (holds after 3 fails; fields `brief_regen_*`). Read-only dump: `scripts/inspect-brief-health.mjs`. Emergency stop: `scripts/stop-regen-loop.mjs <projectId> --apply`.

**Garm.** Fail-closed sign-in gate since 2026-07-29; since PR H there is **no env-var escape hatch** — if Garm falsely denies a real member, fix the grant in Garm (or Vercel instant-rollback to a pre-PR-H deploy, which still honours `GARM_GATING=off`). Never "fix" an aliasing case by adding a second `project_members` row — it splits one human into two roster participants; revoke the stray grant (`scripts/garm-revoke-grant.mjs`) and alias via `POST /api/aliases` with `GARM_ADMIN_KEY`. Loop admin read-only check: `GARM_LOOP_KEY=op://dev-secrets/garm-consumer-loop/password op run -- node scripts/garm-loop-smoke.mjs`; list apps with `scripts/list-apps.mjs`, verify with `scripts/e2e-loop-apps.mjs`.

**Prod diagnostics.** "Can't open the conversation" reports: `scripts/inspect-project.mjs`, run via `op run --env-file=.env.ops.tpl -- node scripts/with-prod-env-ro.mjs …` (the laptop's local service account has no `private_key`, so `with-prod-env.mjs` alone fails). Prompt-cache misses on back-to-back chat turns: reinstate the fingerprint log (hash + length of system and each message, next to `applyPromptCaching` in the chat route) and diff turns via `vercel logs --expand`; a non-zero `cache_creation` on the turn after a ≥1h gap is by design.

**Email links.** The Firebase console refuses to save a custom action URL for a non-Hosting project — don't retry it; `rewriteActionLink` is the permanent fix.

**stars-demo.** Namespace and round are hard-wired to `stars-demo`/`r2`; a second tenant or round three generalises those two constants first. The secret is on Production only, so `scripts/smoke-stars-integration.mjs` runs against prod with `--allow-prod`. New Firestore composite indexes build asynchronously (lists 503 for a few minutes after deploy).

**Monitoring.** UptimeRobot polls `https://ibuild4you.com/api/health` every 5 min; the GitHub Actions monitor was retired 2026-08-24 for burning Actions minutes. Don't reintroduce a cron workflow for it.

**⚠️ Preview gotchas.**
(a) Vercel SSO gate is on — headless Playwright needs `.ibuild4you-bypass` + `.test-admin-password` (preview) / `.test-admin-password-prod` (prod).
(b) Email/password auth is enabled on both Firebase projects (`ibuild4you-preview` + `ibuild4you-a0c4d`).
(c) Google sign-in works on preview (authDomain + GCP redirect URI wired) but Playwright can't drive it — password login is the headless path.
(d) `NEXT_PUBLIC_APP_URL` is set on Preview (`https://preview.ibuild4you.com`). Without it, every `continueUrl`-bearing link mint (invite, password reset) fails `auth/unauthorized-continue-uri` **silently** — both helpers fail soft to null so the route still answers 200. **Lesson: a route that fails soft to avoid leaking info can't be verified by its status code** — grep `vercel logs <deployment> --expand` for the `*_failed` event instead.

## Env vars

Production (Vercel):
- `CRON_SECRET` — required. Vercel auto-sends this as `Authorization: Bearer <CRON_SECRET>` to cron routes. `/api/cron/notify` rejects without it.
- `STARS_INTEGRATION_SECRET` — shared secret for stars-demo's server-to-server calls to `/api/integrations/stars-demo/*` (header `X-Integration-Secret` + `X-Integration-Namespace: stars-demo`). Fail-closed: unset denies every request. Constant-time compare over SHA-256 digests. One value at a time, rotation is a coordinated cutover (08a §8). Value in 1Password `op://dev-secrets/starsdemo-ibuild4you-integration-secret/credential` (API Credential item; field is `credential`, verified 2026-09-22) (same value in stars-demo's `IBUILD4YOU_INTEGRATION_SECRET`). Never logged.
- `RESEND_API_KEY` — for transactional email (interest form, notify cron).
- `ANTHROPIC_API_KEY` — for the agent.
- `CHAT_MODEL` — optional model override for the chat + kickoff routes only (#184); a brief's own `model` (#189) overrides it. Unset → `AGENT_MODEL` (`claude-sonnet-4-6`). The Sonnet 5.5 trial sets it to `claude-sonnet-5-5` on **Preview** first; promote to prod only after comparing the admin usage page before/after. On a 5.x id the routes drop `temperature` and send `output_config.effort: low` instead (5.x 400s on a non-default temperature) — `lib/agent/model-config.ts`. Brief regen, welcome and prep never read it: they use forced `tool_choice` / a tuned temperature, which 5.x rejects. Any id set here must have a row in `lib/observability/anthropic-pricing.ts` or every call logs `$0`.
- `GARM_URL` — Garm authz service base URL. Canonical: `https://garm.prompt-labs.org` (custom domain, cert live; `/api/health?db=1` → `{"ok":true,"db":true}`). The `https://garm-seven.vercel.app` alias still resolves but don't wire it into anything new. Read by `lib/garm.ts` (`garmCheck`). Unset → the client denies by default (fail-closed). **Since PR G (2026-07-29) `isApprovedEmail()` gates sign-in on Garm** — the only exception is `usesPreviewAllowlist()` (a preview deployment with no Garm wiring).
- `GARM_GATING` / `GARM_SHADOW` — **retired in PR H (2026-10-15)**; nothing reads them, and both are gone from Vercel (checked 2026-11-03).
- `GARM_KEY` — Garm consumer key (`garm_…`) for this app; Bearer on the `/gnipahellir` check. Value in 1Password `op://dev-secrets/garm-consumer-ibuild4you/password`. Never logged. Unset → fail-closed.
- `GARM_LOOP_KEY` — Loop's delegating Garm key (Phase B), distinct from `GARM_KEY` and `GARM_ADMIN_KEY`. Read by `lib/garm-loop.ts`: checks who owns/collaborates on a Loop app, lists and writes app grants. Value in 1Password `op://dev-secrets/garm-consumer-loop/password`. Never logged. Set on Production 2026-10-30. Unset on prod → non-admins see no apps and `POST /api/admin/apps` returns 503; unset on a preview deployment → Garm is skipped. Fail-closed on every check. Never set it on Preview: Garm has no preview instance, so preview would create and change real production apps and grants.
- `LOOP_SENDER_TAG_SECRET` — HMAC secret for the sender tags `GET /api/feedback/read` returns in place of emails. Value in 1Password `op://dev-secrets/ibuild4you-loop-sender-tag-secret/password`. Never logged. Unset → the endpoint answers 503 `not_configured`. Set on Production and Preview (a different value is fine: tags only need to be stable within one deployment environment). Changing it changes every tag.
- `GARM_ADMIN_KEY` — Garm admin key, distinct from `GARM_KEY` (the read-only consumer key). Bearer on the grants-write endpoints (`POST`/`DELETE /api/grants`) used by `lib/garm-grants.ts` dual-write and `scripts/garm-seed-grants.mjs --live`. Value in 1Password `op://dev-secrets/garm/password`. Never logged. Unset → dual-write is a silent no-op (one debug log), never an error.
- `GARM_DUAL_WRITE` — kill switch for **both** the dual-write and the reconcile cron (Garm Phase 4). Must be **exactly `'on'`** to enable; unset or any other value → off, and neither `lib/garm-grants.ts` nor `/api/cron/garm-reconcile` calls Garm at all. Off means Firestore and Garm are allowed to diverge by operator intent, so the reconcile stands down rather than healing that divergence back — but it still writes a `garm_reconcile_log` row each run with `skipped_dual_write_off: true`, so a forgotten flag shows up hourly instead of silently disabling the lockout safety net. When on, every membership/approved-email write (create, share/invite, role change, remove, restore, rekey) recomputes that email's app-level role and upserts or revokes its Garm grant via Next's `after()` — fire-and-forget, local Firestore stays the source of truth, a Garm failure is logged (booleans/role only, never the email) and never blocks or unwinds the local write.
- `FEEDBACK_NOTIFY_SUPPRESS` — kill switch for the `/api/feedback` admin-notification email. Must be **exactly `'on'`** to suppress; unset or any other value → notify sends normally. **Set on preview (deliberately, since 2026-07-29)** so e2e feedback POSTs never email `NOTIFICATION_EMAILS`; never set on prod. Ships with PR #165 (`b9946d3`). Also suppresses the builder's nothing-queued email (#214).
- `GITHUB_TOKEN` — for `/api/admin/feedback/[id]/to-github`. Fine-grained PAT `ibuild4you-feedback-to-issues`, `Issues: Read & write`, scoped to `nicolovejoy/ibuild4you`, `nicolovejoy/bakerylouise-v1`, `nicolovejoy/prntd`, `nicolovejoy/byside`, `nicolovejoy/photomirande` (added 2026-10-24), `nicolovejoy/l6-music`, `nicolovejoy/musicforge`, `nicolovejoy/tideline` (added 2026-10-31). Regenerated 2026-07-04 (value in 1Password); expires ~Jul 2027 — rotation runbook is issue #116. Without it the route returns 500. Per-project repo is configured on `projects.github_repo` (set for byside + prntd 2026-07-04, photomirande 2026-10-24).
- `RESEND_INBOUND_SECRET` — Svix signing secret from Resend's inbound webhook config. Required by `/api/webhooks/resend/inbound`; without it the route returns 500 (refuses to accept unsigned inbound). Pull it from the Resend dashboard when wiring up inbound.
- `FEEDBACK_INBOX_HOST` (optional) — domain used for the plus-addressed reply address. Defaults to `inbox.ibuild4you.com`. MX for this subdomain must point at Resend's inbound servers; the apex domain keeps its existing iCloud MX.
- `RESEND_INBOUND_FETCH_URL` (optional) — URL template for fetching the body of an inbound email by id, e.g. `https://api.resend.com/emails/{id}`. Defaults to `https://api.resend.com/emails/{id}`. The webhook ships metadata only; the body must be retrieved separately. Override only if the default 404s against your Resend account.

<!-- SHARED-CONVENTIONS:BEGIN v=ac9060beffa2 — auto-managed, do not edit here; source: prompt-lab/workflow/claude-md-shared.md (edit + re-sync) -->
## Shared conventions

<!-- These are Nico's cross-repo output rules. They're materialized into each repo's
CLAUDE.md so every agent (local, cloud, headless) sees them as plain text. Source of
truth: prompt-lab/workflow/claude-md-shared.md — edit there and re-sync, never here. -->

- **Clickable URLs.** When pointing at any web destination (dashboard, repo, PR, deploy, settings, docs, localhost), print the full bare URL — `https://example.com` or `http://localhost:8080` — on its own, never just the page's name and never a markdown `[label](url)` link. Nico's terminal auto-linkifies raw `https://` text, so a bare URL is one-click and stays copyable.

- **Number your questions.** Any time you ask Nico more than one question, present them as a numbered list (1., 2., 3.) so he can answer by number with no ambiguity. A single standalone question needs no number.

- **Self-contained smoke-test instructions.** When you ask Nico to manually test or verify an app or website, assume zero carried-over context — he should never scroll back or recall a URL/path/credential from earlier. Always include: the exact URL (full `https://…` or `http://localhost:…`, restated even if mentioned above), the precise steps in order, and what a pass vs. fail looks like. Repetition here is a feature, not clutter.

- **UTC at rest, Pacific on display.** Timestamps are stored in UTC, always. A *calendar day* shown to a human is `America/Los_Angeles` — Nico's day, and the clock the work actually happened on. The two rules that follow are the ones that get broken: never form a date bucket with `new Date(…).toISOString().slice(0,10)` (that is UTC, so every chart axis and "today" silently rolls over at 5pm Pacific — it put a phantom tomorrow bar on the Prompt Lab dashboard), and never bucket UTC-stamped rows with a bare `date(col)` in SQL. Use `Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles' })` in JS and an explicit zone in SQL/Python. Storage in local time is also wrong — it can't be migrated across a DST boundary without loss.

- **No marker before a copy-paste command block.** Nico's terminal renders markdown bullets (`-`, `*`, `•`) as `●`, which breaks paste into zsh. The line directly above a fenced command block must be a plain-text label ending in a colon — never a bullet, dash, asterisk, or number. For loud copy targets, lead the label with `📋` + bold `COPY THE BELOW`, then a colon, then the block. Bracket anything Nico will paste elsewhere (a prompt for another agent, a multi-line command) with a ruler line of `================` above the label and below the closing fence. Rulers go outside the fence so they aren't copied, each with a blank line before it (a `===` line directly under text renders as a heading).

- **No bare backslash in a copy-paste command block.** A `\` is load-bearing shell syntax that renders invisibly and gets silently dropped somewhere between the markdown render, the clipboard, and zsh. `find … -exec test -e {} \; -delete` arrived in the terminal as `… {} ; -delete`, which zsh split into two commands and reported as `find: -exec: no terminating ";"` plus `command not found: -delete` (2026-09-20). Quote it instead — `';'` is exactly equivalent to `\;` and survives any copy path. For the same reason never break a command across lines with a trailing `\`: write one long line, however wide it wraps.

- **Reader-facing text lives in content or copy files, not inline in components.** Some repos ship French alongside English (selected-projects mirrors the site under `/fr`; ibuild4you has French public pages). There, every new string goes in the repo's strings/copy module or content folder, with its translation, and an English copy edit means updating the French twin too. Elsewhere, keeping text out of components is what makes `/localize` cheap later. Terms and register: `prompt-lab/workflow/localization/fr-glossary.md`.

- **A review another agent must act on goes on the PR.** A review that another agent must act on, or that must outlive the session, is posted as a PR comment (`gh pr comment`), where the next session or agent finds it. Live, in-session reviews between Nico and the agent stay in chat. There is no devlog.md: the history DB is the one session record.

- **Browser testing runs headless.** A headed browser takes focus on Nico's Mac. Run Playwright headless, with Edge (`channel: 'msedge'`) for desktop runs wherever a config picks a browser. Never use `headless: false`, `--headed`, `--debug`, `--ui` or `PWDEBUG` unless Nico asks for it in this session. For a visual check, take a screenshot or record a trace (`trace: 'on-first-retry'` or `'on'`) instead of opening a window. The Claude-in-Chrome extension is the one thing that drives Nico's real Chrome, on purpose.
<!-- SHARED-CONVENTIONS:END -->
