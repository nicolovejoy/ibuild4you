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
- Firebase Auth with Google OAuth + email/password login (passcodes retired 2026-07-17, Garm PR D — `/api/auth/passcode` answers 410)
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
- `lib/hooks/` — React hooks (`useAuth`, `useDebounce`)
- `lib/query/` — React Query client config and hooks
- `lib/types/` — TypeScript types for all entities
- `lib/copy.ts` — All user-facing text centralized in one file for easy editing
- `lib/agent/` — Agent system prompt, prep prompt, welcome message generator, constants
- `components/ui/` — Reusable UI primitives (Button, Modal, Card, StatusMessage, etc.)
- `components/builder/` — Builder project view (sessions, brief, setup tabs)
- `components/maker/` — Maker project view (chat, brief card)
- `components/` — App-level components (ErrorBoundary, UserMenu)
- **Loop** — the feedback mechanism: a widget embedded on host apps → `/api/feedback` → admin inbox at `/admin/feedback` → optional GitHub issue. Overview + how to embed: `docs/loop.md`. Wire contract: `lib/feedback/README.md`.

Key pattern: clients call `apiFetch()` which attaches the Firebase Bearer token. API routes call `getAuthenticatedUser(request)` to verify the token server-side before accessing Firestore via `getAdminDb()`.

## Data Model

- **users** — identity (email, first_name, last_name), auto-populated from Google sign-in
- **approved_emails** — allowlist for sign-in (invite-only)
- **project_members** — role-based membership (owner, builder, apprentice, maker); makers sign in with Google or a password-setup link (passcodes retired, PR D)
- **projects** — one per maker engagement, includes agent config (session_mode, directives, opener), requester name/email, tracking fields (shared_at, last_nudged_at)
- **sessions** — each conversation between maker and agent, snapshots agent config at creation
- **messages** — individual messages within a session, role (user/agent) and timestamp, optional file_ids
- **files** — uploaded files (metadata in Firestore, bytes in S3 at `ibuild4you-files` bucket), scoped to project
- **briefs** — living brief for a project, structured and versioned, updated after each session
- **reviews** — builder annotations on a brief, feed back into agent context for next session

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
  "context": "Background info the agent uses to skip basic discovery questions.",
  "welcome_message": "Hey Sam — tell me about your cafe idea!",
  "nudge_message": "Optional. When set, used verbatim as the outbound nudge text for the next session and skips AI generation. Leave blank to let the AI draft.",
  "voice_sample": "Optional. One paragraph showing how you'd text this person by hand. Used as a style anchor for AI-generated outbound copy (nudge/invite/reminder). Ignored when nudge_message is set.",
  "session_mode": "discover",
  "seed_questions": [
    "What problem are you trying to solve?",
    "Who are your customers?"
  ],
  "builder_directives": [
    "Focus on the ordering workflow",
    "Do not suggest technologies"
  ],
  "layout_mockups": [
    {
      "title": "Homepage",
      "sections": [
        { "type": "hero", "label": "Welcome", "description": "Hero with cafe photos" },
        { "type": "gallery", "label": "Menu", "description": "Drinks and pastries with prices" }
      ]
    }
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

**Participants.** `participants[]` seeds any number of people on a brief in one payload — each `{ email (required), first_name?, last_name?, role?, brief_role? }`. `role` is a `MemberRole` (`maker` | `apprentice` | `builder` | `owner`; default `maker`); `brief_role` defaults from role (maker→originator, apprentice→contributor, builder→reviewer). The legacy `requester_email`/`requester_first_name`/`requester_last_name` (+ `brief_role`) still work and are folded in as the first participant. Rules: dedup by lowercased email; the creator's own email is skipped (already the owner); the project doc's displayed requester is the first `maker` participant (else the first overall); **soft cap 20** (more → 400). No hard limit elsewhere — the chat roster name-tags arbitrarily many distinct senders. The response includes a `members: [{ email, role, brief_role }]` array (passcodes no longer minted or returned, PR D).

A decision may carry `"locked": true` — a durable constraint (locked convention / do-not-use rule). Locked decisions survive brief regen verbatim (code-side merge in `regenerateBriefForProject`, never dropped by the model) and the agent must reconcile new intake against them: a maker statement contradicting a locked decision triggers an explicit confirm instead of a silent overwrite (#71). Set via the create payload or the Brief-tab JSON paste (`PUT /api/briefs`).

### Update (PATCH /api/projects)

Requires `project_id`. Only these fields are accepted: `title`, `context`, `welcome_message`, `nudge_message`, `voice_sample`, `session_mode`, `seed_questions`, `builder_directives`, `layout_mockups`, `requester_first_name`, `requester_last_name`, `last_nudged_at`, `last_builder_activity_at`, `identity`. Changing `title` regenerates the slug.

## Agent Behavior Rules

- Neutral, non-opinionated tone; slightly mirrors requester's writing style
- Plain language only — never UX jargon like "user journeys" or "microservices"
- Early sessions: broad discovery. Later sessions: more specific as brief fills in
- At natural checkpoints, summarize back for validation ("So you want X and Y but not Z, right?")
- System prompt includes: current living brief, builder review annotations, prior session history

## MVP Scope

Conversational intake → structured living brief → builder review → next session picks up where left off.

NOT in MVP: process flow diagrams, data architecture drafts, microservice sketches, comparable app analysis, whiteboard UI mockups.

## Testing & Deployment

- **Preview environment**: Stable URL at `preview.ibuild4you.com`, aliased to the `preview` git branch. To eyeball any feature branch on preview: `git push origin <branch>:preview --force`. Vercel rebuilds within ~1–2 min. Wired 2026-05-15 (DNS via Cloudflare → Vercel; Firebase Auth + GCP OAuth domains authorized; Vercel Deployment Protection off for previews).
- **Production-first testing has been retired** for risky changes — ship via PR + preview-test instead. Trivial / doc-only changes can still go direct-to-main.
- **CI/CD**: GitHub Actions runs `type-check`, `lint`, `build`, `test` on PRs and pushes to main. Vercel handles deploys (preview per branch, prod on main).
- **TDD when possible**: Write tests before implementation. Skip only when it genuinely doesn't fit (pure UI layout, exploratory prototyping).
- **Agent-driven e2e (headless Playwright).** The agent can log into preview/prod as the test admin and drive the UI. Shared helper: `scripts/lib/preview-login.mjs` — `launchLoggedIn()` returns an authenticated `{ browser, page }` (bypass-cookie + **email/password** login, handles the #104 dual-email-field selector gotcha). New e2e scripts are a few lines (see `scripts/e2e-preview-login.mjs`). Requires gitignored `.ibuild4you-bypass` (Vercel Protection Bypass token) + `.test-admin-password` (seed the user via `scripts/seed-test-admin.mjs`, then set its password via `scripts/seed-test-admin-password.mjs`), and `npm i --no-save playwright`. Env overrides: `E2E_BASE` (prod URL), `E2E_PASSWORD_FILE` (`.test-admin-password-prod` for prod), `E2E_EMAIL`. **Garm PR C (2026-07-16):** the harness moved off passcode login onto password login ahead of PR D retiring the passcode route entirely — `loginWithPassword()` is the underlying primitive if you need to sign in as a non-admin seeded identity (e.g. a test-cast member; passwords for those live in `.test-cast-passwords.json`, seeded alongside `.test-cast-passcodes.json` by `scripts/fixtures/scenarios/multi-human-cast.mjs`). **Note:** Google sign-in works on preview since #107 but Playwright can't drive Google; password is the headless path. **PR D (2026-07-17, `b4ae8d4`) retired passcodes entirely** — the route answers 410, nothing mints the field, and all e2e scripts (harness + product-flow) sign in via password.

## Code Style

Keep the code approachable — clarity over cleverness. Code should be:
- Clear and straightforward — no clever abstractions
- Well-commented where non-obvious
- Following patterns established in NoteMaxxing

## Next Steps

> Shipped history lives in `docs/changelog.md` (newest first; `/handoff` prepends new entries there). This section is **live work only**. Canonical backlog: `gh issue list --state open`.

**Garm cutover is live** (fail-closed sign-in gate since 2026-07-29, PRs #166/#167). Off-boarding/revoke verified end-to-end; email aliasing (#169) shipped both sides 2026-07-30. **Next: PR H (~Aug 5, after a week of quiet denial logs)** — remove shadow logging + the local-allowlist path + `GARM_GATING` kill switch; freeze/export `approved_emails`; update the Data Model section above; decide the `resolveCanonicalEmail` guard in `lib/garm.ts`. If a real member is falsely denied before then: set `GARM_GATING=off` in Vercel prod + redeploy. Scott's Google-identity alias was requested from Garm 2026-07-30 — verify it landed.

**Password-reset + invite email reworked end to end** (2026-07-30, PRs #171/#172/#173) — sent from our own domain via Resend, hosted at `/auth/action`, links rewritten at mint time. **The Firebase console refuses to save a custom action URL for a non-Hosting project — don't retry it**, `rewriteActionLink` is the permanent fix.

**Key open threads** (full backlog: `gh issue list --state open`):
- **#84** — JSON-blob/chat authoring pivot (north star; also carries #133's deferred write path)
- **#122** — `inherits_from` + round-timeline view, gated on the next new-brief-with-predecessor moment
- **#72 B3/B5** — watch the byside pilot before building the capture-button/screenshot slices
- **#29** — explore mode
- **#116** — PAT rotation reminder — don't surface before ~Jun 2027

**🔥 Runbook — brief-regen cost runaway** (fixed PR #78, keep this): if Anthropic costs spike, query the `api_usage` Firestore collection grouped by route+project for one stuck at the cron interval. Gate: `lib/api/brief-regen-gate.ts` (breaker holds after 3 fails). Emergency stop: `scripts/stop-regen-loop.mjs <projectId> --apply`.

**⚠️ Preview gotchas.**
(a) Vercel SSO gate is on — headless Playwright needs `.ibuild4you-bypass` + `.test-admin-password` (preview) / `.test-admin-password-prod` (prod).
(b) Email/password auth is enabled on both Firebase projects (`ibuild4you-preview` + `ibuild4you-a0c4d`).
(c) Google sign-in works on preview (authDomain + GCP redirect URI wired) but Playwright can't drive it — password login is the headless path.
(d) `NEXT_PUBLIC_APP_URL` is set on Preview (`https://preview.ibuild4you.com`). Without it, every `continueUrl`-bearing link mint (invite, password reset) fails `auth/unauthorized-continue-uri` **silently** — both helpers fail soft to null so the route still answers 200. **Lesson: a route that fails soft to avoid leaking info can't be verified by its status code** — grep `vercel logs <deployment> --expand` for the `*_failed` event instead.

## Recent context

Dated history moved to `docs/changelog.md`.


## Backlog (deeper queue)

- **Dashboard filter + sort (reminders follow-up).** Filter by turn-state + remind-state; sort by last-activity/created/nudged. Separate PR; makes the dashboard scale with maker count.
- **#40 — Architectural drift: `useRealtimeMessages` bypasses API-route layer.** Client-direct Firestore subscription. Low severity; works today; replace with SSE-via-API when convenient.
- **Reply to Manine** that file uploads are fixed (agent now reads Word docs/text/images; clear message for unsupported). Her feedback drove PR #48.
- A4 — pre-upload batch size budgeting in `addFiles` (see `docs/archive/file-and-brief-fixes-plan.md` § A4).
- Plan P4/P5 — denormalized session counters + retire `requester_*` legacy fields. `~/.claude/plans/zesty-tumbling-fountain.md`. Telemetry-gated.
- Users & roles Phase 1: display names everywhere (`docs/users-and-roles-plan.md`).
- **Garm `garmCheck` TTL-expiry test.** `lib/__tests__/garm.test.ts` covers cache-hit *within* TTL but not that the cache re-fetches *after* 60s. Add a fake-timers case (`vi.useFakeTimers` + `vi.advanceTimersByTime(61_000)` → second call re-fetches). Small, closes the one gap in a security-critical module.
- **Garm gating fail-closed tests (do WITH Garm 3/4).** Once `garmCheck` wires into the session/page-load boundaries, add tests asserting each boundary denies (a) a grantless signed-in email and (b) an unreachable Garm (fail-closed) — this is a security-regression surface, so it shouldn't ship on manual smoke alone. Plan: `docs/archive/garm-2-seed-plan.md` (2/4) → then 3/4.
- Project folders for the dashboard — group stale projects, badge with builder-turn count.
- Maker experience design exploration (`docs/maker-experience-functionality.md`). Next: hand to design agents.
- Maker re-engagement flow — signed-token email links, snooze/opt-out (`docs/maker-re-engagement-plan.md`). Blocked on a builder review.
- Validate Session 4 on the long-running maker engagement using new `voice_sample` + `nudge_message` override.
- Posture model validation on claude-sonnet-4-6.
- Known issues on feedback admin: stale `github_issue_url` after issue deletion needs "Clear linked issue" action. (`github_repo` is now in the PATCH allowlist + editable in the builder Setup tab — earlier "Firebase console only" note was stale.)

## Env vars

Production (Vercel):
- `CRON_SECRET` — required. Vercel auto-sends this as `Authorization: Bearer <CRON_SECRET>` to cron routes. `/api/cron/notify` rejects without it.
- `RESEND_API_KEY` — for transactional email (interest form, notify cron).
- `ANTHROPIC_API_KEY` — for the agent.
- `GARM_URL` — Garm authz service base URL. Canonical: `https://garm.prompt-labs.org` (custom domain, cert live; `/api/health?db=1` → `{"ok":true,"db":true}`). The `https://garm-seven.vercel.app` alias still resolves but don't wire it into anything new. Read by `lib/garm.ts` (`garmCheck`). Unset → the client denies by default (fail-closed). **Since PR G (2026-07-29) `isApprovedEmail()` gates sign-in on Garm** — see `GARM_GATING`.
- `GARM_GATING` — PR G cutover kill switch. Must be **exactly `'off'`** to disable Garm gating; any other value (including unset, the prod default) means **Garm is the authoritative sign-in gate** in `isApprovedEmail()` — fail-CLOSED per the ratified Q2 decision (Garm unreachable + cold cache → deny; no local-fallback branch, by design). Admins (`ADMIN_EMAILS`/`system_roles`) short-circuit before Garm as break-glass. **Set to `off` on Preview** (deliberately, since 2026-07-29): preview has no `GARM_URL`/`GARM_KEY`, so the Garm path there would deny every non-admin and dark the e2e fleet; preview runs the pre-cutover local allowlist path. One-release switch — PR H removes it together with the local allowlist path.
- `GARM_SHADOW` — shadow-mode kill switch (Garm Phase 4). Must be **exactly `'on'`** to enable; unset or any other value → off, and `garmCheck` is never called. When on, `isApprovedEmail()` fires a Garm check alongside its local answer and logs one line **only on disagreement** (`[garm-shadow] mismatch: local=… garm=… role=… route=isApprovedEmail` — booleans + display-only role, never the email). **Changes no security decision** — the local answer is returned unconditionally; acting on Garm is PR G, gated on passcode retirement. Fires on every sign-in, so turning it on in Vercel is a deliberate flip. Run ~a week, read the mismatches, then decide.
- `GARM_KEY` — Garm consumer key (`garm_…`) for this app; Bearer on the `/gnipahellir` check. Value in 1Password `op://dev-secrets/garm-consumer-ibuild4you/password`. Never logged. Unset → fail-closed.
- `GARM_ADMIN_KEY` — Garm admin key, distinct from `GARM_KEY` (the read-only consumer key). Bearer on the grants-write endpoints (`POST`/`DELETE /api/grants`) used by `lib/garm-grants.ts` dual-write and `scripts/garm-seed-grants.mjs --live`. Value in 1Password `op://dev-secrets/garm/password`. Never logged. Unset → dual-write is a silent no-op (one debug log), never an error.
- `GARM_DUAL_WRITE` — dual-write kill switch (Garm Phase 4). Must be **exactly `'on'`** to enable; unset or any other value → off, and `lib/garm-grants.ts` never calls Garm. When on, every membership/approved-email write (create, share/invite, role change, remove, restore, rekey) recomputes that email's app-level role and upserts or revokes its Garm grant via Next's `after()` — fire-and-forget, local Firestore stays the source of truth, a Garm failure is logged (booleans/role only, never the email) and never blocks or unwinds the local write.
- `FEEDBACK_NOTIFY_SUPPRESS` — kill switch for the `/api/feedback` admin-notification email. Must be **exactly `'on'`** to suppress; unset or any other value → notify sends normally. **Set on preview (deliberately, since 2026-07-29)** so e2e feedback POSTs never email `NOTIFICATION_EMAILS`; never set on prod. Ships with PR #165 (`b9946d3`).
- `GITHUB_TOKEN` — for `/api/admin/feedback/[id]/to-github`. Fine-grained PAT `ibuild4you-feedback-to-issues`, `Issues: Read & write`, scoped to `nicolovejoy/ibuild4you`, `nicolovejoy/bakerylouise-v1`, `nicolovejoy/prntd`, `nicolovejoy/byside`. Regenerated 2026-07-04 (value in 1Password); expires ~Jul 2027 — rotation runbook is issue #116. Without it the route returns 500. Per-project repo is configured on `projects.github_repo` (set for byside + prntd 2026-07-04).
- `RESEND_INBOUND_SECRET` — Svix signing secret from Resend's inbound webhook config. Required by `/api/webhooks/resend/inbound`; without it the route returns 500 (refuses to accept unsigned inbound). Pull it from the Resend dashboard when wiring up inbound.
- `FEEDBACK_INBOX_HOST` (optional) — domain used for the plus-addressed reply address. Defaults to `inbox.ibuild4you.com`. MX for this subdomain must point at Resend's inbound servers; the apex domain keeps its existing iCloud MX.
- `RESEND_INBOUND_FETCH_URL` (optional) — URL template for fetching the body of an inbound email by id, e.g. `https://api.resend.com/emails/{id}`. Defaults to `https://api.resend.com/emails/{id}`. The webhook ships metadata only; the body must be retrieved separately. Override only if the default 404s against your Resend account.

<!-- SHARED-CONVENTIONS:BEGIN v=d5e16e653242 — auto-managed, do not edit here; source: prompt-lab/workflow/claude-md-shared.md (edit + re-sync) -->
## Shared conventions

<!-- These are Nico's cross-repo output rules. They're materialized into each repo's
CLAUDE.md so every agent (local, cloud, third-party) sees them as plain text. Source
of truth: prompt-lab/workflow/claude-md-shared.md — edit there and re-sync, never here. -->

- **Clickable URLs.** When pointing at any web destination (dashboard, repo, PR, deploy, settings, docs, localhost), print the full bare URL — `https://example.com` or `http://localhost:8080` — on its own, never just the page's name and never a markdown `[label](url)` link. Nico's terminal auto-linkifies raw `https://` text, so a bare URL is one-click and stays copyable.

- **Number your questions.** Any time you ask Nico more than one question, present them as a numbered list (1., 2., 3.) so he can answer by number with no ambiguity. A single standalone question needs no number.

- **Self-contained smoke-test instructions.** When you ask Nico to manually test or verify an app or website, assume zero carried-over context — he should never scroll back or recall a URL/path/credential from earlier. Always include: the exact URL (full `https://…` or `http://localhost:…`, restated even if mentioned above), the precise steps in order, and what a pass vs. fail looks like. Repetition here is a feature, not clutter.

- **No marker before a copy-paste command block.** Nico's terminal renders markdown bullets (`-`, `*`, `•`) as `●`, which breaks paste into zsh. The line directly above a fenced command block must be a plain-text label ending in a colon — never a bullet, dash, asterisk, or number. For loud copy targets, lead the label with `📋` + bold `COPY THE BELOW`, then a colon, then the block.
<!-- SHARED-CONVENTIONS:END -->
