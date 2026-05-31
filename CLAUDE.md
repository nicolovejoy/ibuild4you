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
- Firebase Auth with Google OAuth + passcode login
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
- **project_members** — role-based membership (owner, builder, apprentice, maker) with passcode for maker auth
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
    "decisions": [{ "topic": "Payment", "decision": "Stripe only" }]
  },
  "session_opener": "Alias for welcome_message (either works)"
}
```

Side effects on create: generates slug, creates owner membership, creates maker membership + approves email (if `requester_email`), creates first session (snapshots config), adds welcome message as first agent message, creates initial brief (if `brief` provided).

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

## Code Style

Keep the code approachable — clarity over cleverness. Code should be:
- Clear and straightforward — no clever abstractions
- Well-commented where non-obvious
- Following patterns established in NoteMaxxing

## Next Steps

1. **RAAC Phase 3 — display sweep (3b) + role-assignment UX (3c).** Phase 3a SHIPPED (PR #47, `73522ce`): `brief_role: 'originator'|'contributor'|'reviewer'|null` on `project_members` (separate axis from access-tier `role`); `lib/roles/brief-role.ts` helpers; write paths (projects POST, share, claim) persist it; backfill **applied to prod 2026-05-30** (31 members, idempotent). No UI yet. **3b** = display-layer + glossary sweep (`lib/roles/display.ts` `briefRoleLabel`/`briefRoleShort`, remove legacy copy keys, swap chrome labels — do after preview-Firestore split so it's testable on preview safely). **3c** = per-member role-assignment UX (setup-tab Roles panel + share-modal selector; extend `/api/projects/role` to write `brief_role`). Full plan at `~/.claude/plans/quiet-shimmering-roan.md`. Unblocks #44.
2. **Voice attribution (issue #43) — PARKED.** Cheap part SHIPPED: a one-line function-based disclosure on the About page (`copy.about.voiceNote` under the signature). The hard part — section-level provenance strips on brief sections (`authored_by`/`drafted_by`/`last_edited_by`/`last_edited_at` schema + UI) — is **parked until the brief editor gets its next substantive pass** (the only moment the schema earns its keep). Research/recommendation preserved on issue #43; don't rebuild it. Intention is sound, no plan yet — deliberately not carrying it as active work. Avoid per-sentence/paragraph badges per over-marking research.
3. **🔒 Preview Firestore split — committed.** Provision a separate Firebase project (`ibuild4you-preview` or similar) so preview writes land in their own sandboxed DB instead of overwriting prod. Tasks: create the project; copy Firestore rules + composite indexes from prod; set up Google OAuth (callback URL on the new project) + passcode auth; swap `FIREBASE_*` env vars on Vercel's "Preview" environment only; add `.env.preview.local.tpl` with 1Password refs for local preview-environment dev; optionally seed canonical test projects. The hard part is mechanical not conceptual. Decision drivers: May 23 incident (real maker's `requester_email` overwritten from preview); unblocks agent-driven Playwright on preview (backlog item silently assumes preview is safe to write). ~half day.
4. **Reminders → flip live (Phase 2).** Phase 1 SHIPPED (PR #45, `609abd9`): `latest_session_created_at` now persisted on session-create (both paths); cron logs every decision (sent/would_send/skipped/error) to `reminder_log`; `/admin/reminders` observability page live; fixed the dry-run-advances-counters bug (dry-run is now side-effect-free). `scripts/backfill-latest-session.mjs` **APPLIED 2026-05-30** (16 projects set, verified idempotent). Currently **1 brief opted in** (prntd, `manineg@yahoo.com`); Lori's brief disabled per request 2026-05-30. Phase 2 (flip) remaining: generate one dry-run decision row (Vercel → Crons → `maker-reminders` → Run, or wait for the 09:00 PT tick) and eyeball `/admin/reminders`; confirm iCloud catch-all (#7); one controlled live send to `test@`; **delete `REMINDER_DRY_RUN` on Vercel** (rollback = re-add it). Plan: `docs/reminders-plan.md`. NOTE: `reminder_log` was empty as of 2026-05-30 PM because the Phase-1 decision-logging code only deployed that day — the cron hadn't ticked since; first rows land at the next 09:00 PT run. `scripts/trigger-cron.mjs` can fire it manually but needs `CRON_SECRET` (prod-only, not in `.env.local`) — use the Vercel dashboard's Run button instead. **FLIP PAUSED mid-decision (2026-05-31):** verified prntd is DUE for reminder #1 now (first live tick emails the real maker); the flip is GLOBAL (one env var, can't isolate a test send per-project). Choreography + safe test-to-self sequence + what's agent-doable vs Nico-only written up in `docs/reminders-plan.md` § "Flip status + choreography". Resume by picking the sequence (test-to-self vs go-live).
   - (later) **Dashboard filter + sort.** Filter by turn-state + remind-state; sort by last-activity/created/nudged. Separate PR; makes the dashboard scale with maker count.
5. **UX rethink — assisted multi-human conversation is the headline.** Two reframes landed this session (not yet built): (a) the builder brief-view nav is confusing — the "Next Conversation" tab is actually a Settings/config drawer (agent setup, seed questions, directives, auto-reminders toggle, github_repo); the builder loop is really *state-store + clipboard* for an external reasoning round-trip (export brief JSON → think with an outside agent → paste back next-conversation config). (b) The product's key feature is **2+ humans in a conversation that Roan assists** (not solo maker↔AI). Active artifact: ChatGPT journey-cartoon prompts (cast: Manine + her friend Nico + Roan; idea simplified to "a cozy Italian café in Seattle") — drafted, on clipboard, prompt A done; B/C (e.g. without-Roan-vs-with-Roan contrast, returning-after-break) pending. TODO once liked: save experience spec + prompts to `docs/`.
6. **BUG (parked) — "Needs setup" badge disagrees with dashboard.** On Lori's brief page the header showed "Needs setup" while the dashboard card showed "Waiting on Lori" for the same project. Logic at `lib/turn-indicator.ts:20` keys on `!requester_email || !session_count`. The single-project GET *does* run `enrichProjects` (`app/api/projects/route.ts:157`), so the cause isn't obviously missing enrichment — likely the brief page renders from a different/cached/realtime project object lacking `session_count`. Real symptom, cause unpinned. (Earlier #24 closed this as working-as-intended — may have been wrong.)
7. **iCloud catch-all decision** for `test@ibuild4you.com` (and future `test-*@`). iCloud.com → Mail Settings → Custom Email Domain → "Catch-all" toggle on `ibuild4you.com`. Lets test-account emails (reminders, invites) land in Nico's inbox so we can validate maker-facing flows end-to-end via the Playwright test admin identity.
8. **Code-quality consolidation pass — PRs B + C.** Plan at `~/.claude/plans/cheerful-soaring-matsumoto.md`. PR A (roadmap hygiene) shipped. PR B: DRY top-3 (`lib/url.ts` shareLink helper, extended display-name fallback, `useNudgeCopy` hook) + unused copy.ts cleanup. PR C: test coverage on mutation routes (`briefs/generate`, `projects/{share,role,claim}`, `users/me`, `files/*`, `auth/passcode`) — 15 of 30 routes lack `__tests__` per tonight's audit.
9. **#31 — Agent kickoff on session open.** Real fix for "I had to type first." New `/api/chat/kickoff` route + frontend mount-time trigger; uses existing system prompt so #26 + #27 fire on session open. Watch for the infinite-trigger / multi-tab edge cases called out in the issue body.
10. **#21 + #25 framing bundle.** Reminder copy (#21) + auto-progress to 'send nudge' after JSON import (#25). 'Waiting on {maker}' card placement already in place at `BuilderProjectView.tsx:1249` (`RenudgeCard`).
11. **Productionize `/api/chat`.** Top-level try/catch → JSON 500 envelope, client `useStreamingChat` tolerance for non-JSON errors, structured logging, defensive tests. Has been sitting; worth landing after item 4 goes live.
12. **Resend inbound — manual setup, then PR 3.** Webhook handler shipped at `app/api/webhooks/resend/inbound/route.ts` (`1799395`). Remaining: Resend dashboard inbound config on `inbox.ibuild4you.com`, MX records, `RESEND_INBOUND_SECRET` on Vercel (punch list at `docs/feedback-replies-plan.md`). Then PR 3 swaps `Reply-To: noreply@` (currently hardcoded at `lib/email/send-reminder.ts:27`) for per-session `reply+{signed_token}@inbox.ibuild4you.com` so maker email replies post as messages. **Note:** the `inbox.` subdomain MX points at Resend independently of any apex catch-all (item 5).

**Shipped 2026-05-30 (PM — Reminders Phase 1 + UX reframe):** PR #45 (`609abd9`) to prod. **Reminders Phase 1:** persisted `latest_session_created_at` on session-create (`app/api/sessions/route.ts` + project-create path) closing the cron's anchor-on-stale-`shared_at` bug; cron now writes a `reminder_log` row for *every* decision (sent/would_send/skipped/error) → new admin-gated `/admin/reminders` page (mirrors `/admin/usage`) + route; fixed latent bug where dry-run advanced `reminders_sent_count` (would've eaten real makers' 3-send budget before flip) — dry-run is now side-effect-free. `scripts/backfill-latest-session.mjs` (dry-run-validated, 16 projects, not applied). 515 tests green. Disabled auto-reminders on Lori's brief via RO→RW script per request; only prntd opted in now. **Browser/MCP:** confirmed Playwright MCP drives a logged-in-as-Nico browser on prod for collaborative testing. **UX reframe (not built):** see Next Steps #5 (assisted multi-human conversation + builder-nav-as-round-trip) and #6 (parked "Needs setup" badge bug). Drafted ChatGPT journey-cartoon prompts (Manine + friend Nico + Roan; Italian-café idea) — on clipboard.

**Shipped 2026-05-28→30 (Loop + read-only Firestore + groundwork):** 7 commits to prod. **About payload pages** (`405b709`): two copy-pastable payload-reference pages off `/about` (`start-a-brief`, `next-conversation`) via a shared `<PayloadDoc>`. **Loop** (`043e3c1`, `cf5f478`): named the feedback widget mechanism "Loop"; home doc at `docs/loop.md` (overview + host-app embed guide) linking the canonical wire contract at `lib/feedback/README.md`; referenced from CLAUDE.md Architecture; added a `github_repo` builder-setup field so "Convert to GitHub issue" is settable from the UI. **prntd Loop integration validated** — real submission landed in the inbox; real slug is `prntd-mobile-flow-rethink` (not `prntd`). Remaining for prntd→GitHub: set `github_repo` + add the repo to the `GITHUB_TOKEN` PAT scope. **Read-only Firestore** (`e8e3fb1`): `datastore.viewer` service account (`FIREBASE_SERVICE_ACCOUNT_RO` in `.env.local`, 1P backup `ibuild4you-firestore-ro`) + `scripts/with-prod-env-ro.mjs` (write-disabled, no fallback) + `scripts/list-projects.mjs`, allowlisted per-script — agent can now read prod write-safely (see memory `reference_readonly_firestore`). **Preview-split Phase 1** (`e8e3fb1`): `.firebaserc` aliases + `docs/preview-firestore-split.md` runbook; SDKs read config purely from env vars so no app code change needed. **Docs hygiene** (`cf5f478`): archived 4 shipped/resolved plans to `docs/archive/`. **Removed all references to a former contributor** (`3cbf652`) across CLAUDE.md, docs, global config, memory. **Reminders plan** (`77afd6e`): `docs/reminders-plan.md` — flagged that `latest_session_created_at` is never persisted (only computed read-time in `enrich-projects.ts`), so the cron's cadence anchors on `shared_at` not the latest session — fix before flipping live. Closed #24 ('Needs setup' badge, working-as-intended). 506/506 tests green throughout.

**Shipped 2026-05-27 (PM — RAAC Phase 1+2 → prod + About polish + nav refactor):** 10 commits to prod. **RAAC Phase 1+2** (`65e443d`, `27129a9` — from AM session): About page around RAAC vocabulary (Brief / Roan / Originator / Contributor / Reviewer); agent identity flipped to Roan in `lib/agent/constants.ts`; chat header shows Roan avatar; message labels via `copy.chat.agentLabel`; About link in dashboard nav. **About polish** (`7feda70`, `dd44fbe`, `01dda2c`, `6d62250`, `e9b169e`): hero image compressed 1.7MB→49KB webp; real-alpha cut via `rembg` (U²-Net) after ChatGPT export came as RGB-no-alpha with baked-in checkerboard; Meet-Roan flex layout (text-left/image-right on sm+, stacked on mobile); copy typo pass; Nico-Lovejoy signature; on-page glossary list dropped (tooltips still use `copy.glossary`); `copy.glossary` block accidentally dropped mid-session, restored in `6d62250` before any broken push landed on prod. **Nav consistency** (`286e4c0`, `d75ff89`): added consistent header to About; then factored `<SiteHeader />` (logo + About + UserMenu, admin-aware coloring) and `<SectionHeader />` (back-arrow + title + optional icon/meta slots) and applied across `app/dashboard`, `app/about`, all four `app/admin/*` pages, and `app/projects/[id]/brief`. Net +7 lines for two reusable components. 506/506 tests + type-check + lint clean. Issues from AM still open: #43 (voice attribution), #44 (dashboard restructure under RAAC, blocked on Phase 3a). Branch hygiene: stale local branches (`chore/scrub-pii-phase-a` merged via PR #36; `preview` was only a force-push target) deleted; local = `main` only.

**Shipped 2026-05-24:** PII scrub Phase A (PR #36 docs) + Phase B/C (PR #37 placeholders + 20 test files, +162/-162 — pure renames; 506/506 tests pass). Established the PII rule: individual maker/builder names stay out of code, comments, docs, and memory — only in briefs and Firestore. Prompt caching on brief regen (`f8feb76`) — `cache_control` markers on system prompt + prior conversation slash input cost ~90% on repeat calls. Closed stale issues #3 (feedback widget shipped) and #28 (subsumed by PR #30). Filed #38 (PDF upload validation), #39 (prep-prompts smoke), #40 (`useRealtimeMessages` drift) to give backlog items tracking numbers. Codebase audit verdict: structurally healthy, one architectural drift point (#40), some DRY-able patterns, gappy test coverage on mutation routes — consolidation plan at `~/.claude/plans/cheerful-soaring-matsumoto.md`. Roadmap hygiene shipped (PR #41) — struck shipped items, promoted preview-prod-Firestore footgun to a Next-Steps decision. **End-of-day pivot:** preview-prod-Firestore committed for split (incident already happened, unblocks agent-driven Playwright); PR #22 flip-live re-scoped to "promote reminders to admin feature first" — per-brief toggle + `/admin/reminders` view + dashboard filter/sort, then delete `REMINDER_DRY_RUN`.

**Shipped 2026-05-23:** Big day. PR #32 brief-regen tool-use + circuit breaker (`0ba9768`) — kills the JSON.parse-fails-on-truncation loop class; per-project failure counter caps cron retries at 3, auto-clears on next maker turn. Validated post-deploy: 0 brief.generate calls in the 12+ min after deploy, 0 projects in failure state. PR #22 auto-reminders merged (`ec41c029`) → cadence test guard had a time-drift bug that red'd CI on every commit after merge; fixed via PR #34 (`4d215bb`) — `day(n)` was anchored to `Date.now()` while `now` was a fixed Date; both now share a fixed reference. PR #33 `/admin/usage` admin dashboard shipped (`6f66ffb`) — totals + by-route/model/day/project tables + top-10 calls, server-hydrates project titles, admin-gated; validated end-to-end via Playwright. New test infra: `scripts/with-prod-env.mjs` lets the agent run prod-facing scripts without tripping the .env block-secrets hook (Node fs read of .env.local, not Bash); `scripts/seed-test-admin.mjs` creates a dedicated `test@ibuild4you.com` identity (Firebase Auth user + users-doc with `system_roles=['admin']` + approved_emails + project membership) and pbcopy's the generated passcode — never to stdout. Smoke-tested #26 (name verify) + #27 (>1hr recap) in prod — both pass; model wording: *"I've got you listed as TestNameX — is that right?"* and *"Welcome back. We were in the middle of..."*.

**Shipped 2026-05-22 (late):** PR #30 agent-behavior pass merged to main (`1142525`). "Maker direction wins" rule in shared GUARDRAILS; `## Maker` section + name-verify guardrail; `## Returning after a break` recap when gap ≥ 1hr. Chat route captures `last_maker_message_at` **before** the update — naive read would always be ~0 and #26 would silently never fire. Filed #29 (explore session mode, between discover/converge — prototype as discover-variant first) and #31 (agent kickoff on session open with typing indicator).

**Shipped 2026-05-21 (cost incident):** Hot-patched 4 brief-regen-looped projects via `scripts/touch-stuck-briefs.mjs`. Diagnostic scripts `api-usage-rollup.mjs` + `api-usage-by-project.mjs` committed to main (`a29fb1c`). Root cause: conversational `next-convo-prompt` truncated at `BRIEF_MAX_TOKENS=4096` → `JSON.parse` throws → brief never updated → cron retries every 5 min. PR #32 tool-use + circuit breaker (shipped 2026-05-23) is the structural close-out.

**Shipped 2026-05-22:** PR #19 outbound-templates rip-out merged (-516 LoC; killed AI invite/nudge/reminder and the `/api/projects/outbound-message` route — was the source of "weeks now" wrong-context copy). PR #22 maker-auto-reminders cron opened (2/5/10d cadence, cap 3, BCC builder, `REMINDER_DRY_RUN` flag for staged rollout). Filed issues #23–#28 from a maker-experience screenshot review.

## Backlog (deeper queue)

- **Agent-driven Playwright on preview.** Set up a Vercel "Protection Bypass for Automation" token + a clean pattern for the agent to access `test@ibuild4you.com`'s passcode (currently blocked by the secrets hook). With both, the agent owns end-to-end UI verification on `preview.ibuild4you.com` instead of relying on copy-paste between Claude Code and Claude.ai's browser MCP. Docs: https://vercel.com/docs/deployment-protection/methods-to-bypass-deployment-protection/protection-bypass-automation. Pair with a session memory + a thin helper script that builds the bypassed URL (`?x-vercel-set-bypass-cookie=true&x-vercel-protection-bypass=$TOKEN`).
- **#40 — Architectural drift: `useRealtimeMessages` bypasses API-route layer.** Client-direct Firestore subscription. Low severity; works today; replace with SSE-via-API when convenient.
- **#38 — PDF upload validation (cache_control fix unverified end-to-end).**
- **#39 — Smoke-test prep-prompts split in prod (commit `21f4c10`) — eight cases queued.**
- A4 — pre-upload batch size budgeting in `addFiles` (see `docs/archive/file-and-brief-fixes-plan.md` § A4).
- Project delete should clean up files (S3 + Firestore orphans). Factor from `scripts/cleanup-test-data.mjs`.
- Plan P4/P5 — denormalized session counters + retire `requester_*` legacy fields. `~/.claude/plans/zesty-tumbling-fountain.md`. Telemetry-gated.
- Users & roles Phase 1: display names everywhere (`docs/users-and-roles-plan.md`).
- Add tests for `useStreamingChat` hook (RTL setup proven, see `components/__tests__/FeedbackWidget.test.tsx`).
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
- `GITHUB_TOKEN` — for `/api/admin/feedback/[id]/to-github`. Fine-grained PAT, `Issues: Read & write`. Currently scoped to `nicolovejoy/ibuild4you`, `nicolovejoy/bakerylouise-v1`, `nicolovejoy/offer-builder`, `nicolovejoy/prntd` (prntd added 2026-05-30; still need to set `projects.github_repo='nicolovejoy/prntd'` on the prntd brief via the Setup tab). Without it the route returns 500. Per-project repo is configured on `projects.github_repo`.
- `RESEND_INBOUND_SECRET` — Svix signing secret from Resend's inbound webhook config. Required by `/api/webhooks/resend/inbound`; without it the route returns 500 (refuses to accept unsigned inbound). Pull it from the Resend dashboard when wiring up inbound.
- `FEEDBACK_INBOX_HOST` (optional) — domain used for the plus-addressed reply address. Defaults to `inbox.ibuild4you.com`. MX for this subdomain must point at Resend's inbound servers; the apex domain keeps its existing iCloud MX.
- `RESEND_INBOUND_FETCH_URL` (optional) — URL template for fetching the body of an inbound email by id, e.g. `https://api.resend.com/emails/{id}`. Defaults to `https://api.resend.com/emails/{id}`. The webhook ships metadata only; the body must be retrieved separately. Override only if the default 404s against your Resend account.
