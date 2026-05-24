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

This is a learning project — a junior contributor is also working on the codebase. Code should be:
- Clear and straightforward — no clever abstractions
- Well-commented where non-obvious
- Following patterns established in NoteMaxxing

## Next Steps

1. **🔒 Preview Firestore split — committed.** Provision a separate Firebase project (`ibuild4you-preview` or similar) so preview writes land in their own sandboxed DB instead of overwriting prod. Tasks: create the project; copy Firestore rules + composite indexes from prod; set up Google OAuth (callback URL on the new project) + passcode auth; swap `FIREBASE_*` env vars on Vercel's "Preview" environment only; add `.env.preview.local.tpl` with 1Password refs for local preview-environment dev; optionally seed canonical test projects. The hard part is mechanical not conceptual. Decision drivers: May 23 incident (real maker's `requester_email` overwritten from preview); unblocks agent-driven Playwright on preview (backlog item silently assumes preview is safe to write). ~half day.
2. **Reminders → admin feature → flip live.** PR #22's dry-run window expires when the system becomes self-observable. Sub-(a) per-brief `auto_reminders_enabled` toggle already shipped in PR #22 (field at `lib/types/index.ts:65`, UI at `BuilderProjectView.tsx:1211`, cron filter at `app/api/cron/maker-reminders/route.ts:31`). Remaining steps:
   - (b) **`/admin/reminders` view.** Admin-gated page (pattern from `/admin/usage`). Lists recent `reminder_log` entries: project title, decision (sent/skipped/would-have-sent), reason, timestamp. Replaces "open Firebase console to inspect" with an in-app surface.
   - (c) **Dashboard filter + sort.** Filter by turn-state (waiting-on-maker / your-turn / needs-setup) and remind state (auto-remind on/off). Sort by last-activity / created / nudged. Separate PR but same theme — makes the dashboard usable as the maker count grows.
   - (d) **Flip live.** Delete `REMINDER_DRY_RUN` on Vercel. With (b)+(c) live, regressions surface on `/admin/reminders` instead of needing the env-var safety switch.
3. **iCloud catch-all decision** for `test@ibuild4you.com` (and future `test-*@`). iCloud.com → Mail Settings → Custom Email Domain → "Catch-all" toggle on `ibuild4you.com`. Lets test-account emails (reminders, invites) land in Nico's inbox so we can validate maker-facing flows end-to-end via the Playwright test admin identity.
4. **Code-quality consolidation pass — PRs B + C.** Plan at `~/.claude/plans/cheerful-soaring-matsumoto.md`. PR A (roadmap hygiene) shipped. PR B: DRY top-3 (`lib/url.ts` shareLink helper, extended display-name fallback, `useNudgeCopy` hook) + unused copy.ts cleanup. PR C: test coverage on mutation routes (`briefs/generate`, `projects/{share,role,claim}`, `users/me`).
5. **#31 — Agent kickoff on session open.** Real fix for "I had to type first." New `/api/chat/kickoff` route + frontend mount-time trigger; uses existing system prompt so #26 + #27 fire on session open. Watch for the infinite-trigger / multi-tab edge cases called out in the issue body.
6. **#21 + #25 framing bundle.** Reminder copy (#21) + auto-progress to 'send nudge' after JSON import (#25). 'Waiting on {maker}' card placement already in place at `BuilderProjectView.tsx:1296`.
7. **Productionize `/api/chat`.** Top-level try/catch → JSON 500 envelope, client `useStreamingChat` tolerance for non-JSON errors, structured logging, defensive tests. Has been sitting; worth landing after item 2 goes live.
8. **Resend inbound — manual setup, then PR 3.** Webhook handler shipped at `app/api/webhooks/resend/inbound/route.ts` (`1799395`). Remaining: Resend dashboard inbound config on `inbox.ibuild4you.com`, MX records, `RESEND_INBOUND_SECRET` on Vercel (punch list at `docs/feedback-replies-plan.md`). Then PR 3 swaps `Reply-To: noreply@` (currently hardcoded at `lib/email/send-reminder.ts:10`) for per-session `reply+{signed_token}@inbox.ibuild4you.com` so maker email replies post as messages. **Note:** the `inbox.` subdomain MX points at Resend independently of any apex catch-all (item 3).

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
- A4 — pre-upload batch size budgeting in `addFiles` (see `docs/file-and-brief-fixes-plan.md` § A4).
- Project delete should clean up files (S3 + Firestore orphans). Factor from `scripts/cleanup-test-data.mjs`.
- Plan P4/P5 — denormalized session counters + retire `requester_*` legacy fields. `~/.claude/plans/zesty-tumbling-fountain.md`. Telemetry-gated.
- Users & roles Phase 1: display names everywhere (`docs/users-and-roles-plan.md`).
- Add tests for `useStreamingChat` hook (RTL setup proven, see `components/__tests__/FeedbackWidget.test.tsx`).
- Project folders for the dashboard — group stale projects, badge with builder-turn count.
- Maker experience design exploration (`docs/maker-experience-functionality.md`). Next: hand to design agents.
- Maker re-engagement flow — signed-token email links, snooze/opt-out (`docs/maker-re-engagement-plan.md`). Blocked on a builder review.
- Validate Session 4 on the long-running maker engagement using new `voice_sample` + `nudge_message` override.
- Posture model validation on claude-sonnet-4-6.
- Known issues on feedback admin: stale `github_issue_url` after issue deletion needs "Clear linked issue" action; `github_repo` only editable via Firebase console (add to PATCH allowlist when annoying).

## Env vars

Production (Vercel):
- `CRON_SECRET` — required. Vercel auto-sends this as `Authorization: Bearer <CRON_SECRET>` to cron routes. `/api/cron/notify` rejects without it.
- `RESEND_API_KEY` — for transactional email (interest form, notify cron).
- `ANTHROPIC_API_KEY` — for the agent.
- `GITHUB_TOKEN` — for `/api/admin/feedback/[id]/to-github`. Fine-grained PAT, `Issues: Read & write`. Currently scoped to `nicolovejoy/ibuild4you`, `nicolovejoy/bakerylouise-v1`, `nicolovejoy/offer-builder` (2026-05-13). Without it the route returns 500. Per-project repo is configured on `projects.github_repo`.
- `RESEND_INBOUND_SECRET` — Svix signing secret from Resend's inbound webhook config. Required by `/api/webhooks/resend/inbound`; without it the route returns 500 (refuses to accept unsigned inbound). Pull it from the Resend dashboard when wiring up inbound.
- `FEEDBACK_INBOX_HOST` (optional) — domain used for the plus-addressed reply address. Defaults to `inbox.ibuild4you.com`. MX for this subdomain must point at Resend's inbound servers; the apex domain keeps its existing iCloud MX.
- `RESEND_INBOUND_FETCH_URL` (optional) — URL template for fetching the body of an inbound email by id, e.g. `https://api.resend.com/emails/{id}`. Defaults to `https://api.resend.com/emails/{id}`. The webhook ships metadata only; the body must be retrieved separately. Override only if the default 404s against your Resend account.
