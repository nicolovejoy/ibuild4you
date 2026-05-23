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
  "title": "Jamie's Bakery App",
  "requester_email": "jamie@example.com",
  "requester_first_name": "Jamie",
  "requester_last_name": "Baker",
  "context": "Background info the agent uses to skip basic discovery questions.",
  "welcome_message": "Hey Jamie — tell me about your bakery idea!",
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
        { "type": "hero", "label": "Welcome", "description": "Hero with bakery photos" },
        { "type": "gallery", "label": "Menu", "description": "Cake portfolio with prices" }
      ]
    }
  ],
  "brief": {
    "problem": "Customers can't order online",
    "target_users": "Local bakery customers",
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

This is a learning project (Max, 19, college freshman, is contributing). Code should be:
- Clear and straightforward — no clever abstractions
- Well-commented where non-obvious
- Following patterns established in NoteMaxxing

## Next Steps

1. **PR #22 auto-reminders → go live.** `REMINDER_DRY_RUN=true` is set on Vercel. Merge PR #22, watch Vercel runtime logs + the new `reminder_log` Firestore collection for ~2 days, then **delete** the env var to flip live. First live send: confirm BCC lands at `nicholas.lovejoy@gmail.com`.
2. **Smoke #26/#27 in prod.** PR #30 shipped 2026-05-22. Open a session, type → confirm agent verifies name ("got you as X — is that right?"). Open a session you started >1hr ago → confirm agent recaps the immediate thread instead of continuing mid-thought. #28 (yield) already confirmed working.
3. **#31 — Agent kickoff on session open.** Real fix for "I had to type first." New `/api/chat/kickoff` route + frontend mount-time trigger; uses existing system prompt so #26 + #27 fire on session open. Watch for the infinite-trigger / multi-tab edge cases called out in the issue body.
4. **Productionize `/api/chat`.** Top-level try/catch → JSON 500 envelope, client `useStreamingChat` tolerance for non-JSON errors, structured logging, defensive tests. Has been sitting; worth landing after PR #22 goes live.
5. **Resend inbound webhook — manual setup, then PR 3.** Resend dashboard inbound config on `inbox.ibuild4you.com`, MX records, `RESEND_INBOUND_SECRET` on Vercel (punch list at `docs/feedback-replies-plan.md`). After that, PR 3 swaps PR #22's `Reply-To: noreply@` for per-session `reply+{signed_token}@inbox.ibuild4you.com` so maker email replies post as messages.
6. **Brief regen — tool-use refactor.** Beyond the hot-patch: switch `regenerateBriefForProject` to Anthropic tool use with a forced schema so JSON.parse can't fail mid-truncation. Reduce `BRIEF_MAX_TOKENS`. Closes the door on the cron-loop class of bugs.
7. **Issue framing PRs — #20 (Share modal copy) + #21 (reminder copy + UI placement) + #25 (auto-progress after JSON import).** Small. Bundle as a cleanup PR.
8. **PR 2 of cost tracking** — admin `/admin/usage` rollup page over the `api_usage` collection. `scripts/api-usage-rollup.mjs` is the basis. Useful as a prevention tool now that the loop is fixed.

**Shipped 2026-05-22 (late):** PR #30 agent-behavior pass merged to main (`1142525`). "Maker direction wins" rule in shared GUARDRAILS; `## Maker` section + name-verify guardrail; `## Returning after a break` recap when gap ≥ 1hr. Chat route captures `last_maker_message_at` **before** the update — naive read would always be ~0 and #26 would silently never fire. Filed #29 (explore session mode, between discover/converge — prototype as discover-variant first) and #31 (agent kickoff on session open with typing indicator).

**Shipped 2026-05-21 (cost incident):** Hot-patched 4 brief-regen-looped projects via `scripts/touch-stuck-briefs.mjs`. Diagnostic scripts `api-usage-rollup.mjs` + `api-usage-by-project.mjs` committed to main (`a29fb1c`). Root cause: conversational `next-convo-prompt` truncated at `BRIEF_MAX_TOKENS=4096` → `JSON.parse` throws → brief never updated → cron retries every 5 min. PR #5 tool-use fix above is the structural close-out.

**Shipped 2026-05-22:** PR #19 outbound-templates rip-out merged (-516 LoC; killed AI invite/nudge/reminder and the `/api/projects/outbound-message` route — was the source of "weeks now" wrong-context copy). PR #22 maker-auto-reminders cron opened (2/5/10d cadence, cap 3, BCC builder, `REMINDER_DRY_RUN` flag for staged rollout). Filed issues #23–#28 from a maker-experience screenshot review.

## Backlog (deeper queue)

- Validate Matt's PDF flow end-to-end (cache_control fix `a8d9c94` unverified). Tune `lib/agent/system-prompt.ts` if agent ignores/hallucinates PDF content.
- A4 — pre-upload batch size budgeting in `addFiles` (see `docs/file-and-brief-fixes-plan.md` § A4).
- Project delete should clean up files (S3 + Firestore orphans). Factor from `scripts/cleanup-test-data.mjs`.
- Plan P4/P5 — denormalized session counters + retire `requester_*` legacy fields. `~/.claude/plans/zesty-tumbling-fountain.md`. Telemetry-gated.
- Users & roles Phase 1: display names everywhere (`docs/users-and-roles-plan.md`).
- Add tests for `useStreamingChat` hook (RTL setup proven, see `components/__tests__/FeedbackWidget.test.tsx`).
- Project folders for the dashboard — group stale projects, badge with builder-turn count.
- Smoke-test prep-prompts split in prod (commit `21f4c10`) — eight cases queued.
- Maker experience design exploration (`docs/maker-experience-functionality.md`). Next: hand to design agents.
- Maker re-engagement flow — signed-token email links, snooze/opt-out (`docs/maker-re-engagement-plan.md`). Blocked on Ryan.
- Validate Session 4 with Matt using new `voice_sample` + `nudge_message` override.
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
