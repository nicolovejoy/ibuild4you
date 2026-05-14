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

- **Production-first testing**: We test in prod. No staging environment. This is fine while the app is invite-only and low-stakes — revisit when risk profile changes (payments, sensitive data, larger user base).
- **CI/CD**: GitHub Actions runs `type-check`, `lint`, `build`, `test` before deploying to Vercel.
- **TDD when possible**: Write tests before implementation. Skip only when it genuinely doesn't fit (pure UI layout, exploratory prototyping).

## Code Style

This is a learning project (Max, 19, college freshman, is contributing). Code should be:
- Clear and straightforward — no clever abstractions
- Well-commented where non-obvious
- Following patterns established in NoteMaxxing

## Next Steps

1. **Feedback widget — finish issue #3.** Done end-to-end (verified in prod 2026-05-13): (a) admin UI at `/admin/feedback` with project/status/type filters + inline status/notes edit; (b) `<FeedbackWidget>` at `components/FeedbackWidget.tsx`, shared validator/payload helper at `lib/feedback/payload.ts`, RTL smoke tests, wire-contract spec at `lib/feedback/README.md`; (c) `POST /api/admin/feedback/[id]/to-github` route + per-row Convert button, idempotent via `github_issue_url`; (e) embedded on `bakerylouise-v1` (PR #15 there) gated by `?feedback=on` localStorage flag. Remaining: (d) **Resend inbound webhook → `feedback/{id}/replies` subcollection** so submitter email replies land in the dashboard (`FeedbackReply` type already defined). Also small known-issues: (i) deleted GitHub issues leave a stale `github_issue_url` showing "Open GitHub issue" pointing at a 404 — add a "Clear linked issue" admin action when this bites; (ii) `github_repo` is only editable via Firebase console — add to PATCH allowlist + setup UI when it gets annoying.
3. Validate Matt's PDF flow end-to-end. Cache_control fix (`a8d9c94`) is live but unverified against real Matt traffic — need to see his next chat return 200 AND the agent reference actual PDF content (form name, clause), not just acknowledge files exist. Tune `lib/agent/system-prompt.ts` if it ignores/hallucinates.
4. A4 — pre-upload batch size budgeting. `addFiles` currently checks per-file >25MB; extend to running batch total so the picker rejects before the init round-trip. See `docs/file-and-brief-fixes-plan.md` § A4.
5. Project delete should clean up files. Today DELETE `/api/projects` removes sessions/messages/briefs/members but leaves the `files` Firestore docs and S3 objects orphaned. Reference: `scripts/cleanup-test-data.mjs` — factor its S3+Firestore delete steps into a shared helper.
6. Plan P4/P5 (denormalized session counters + retire `requester_*` legacy fields). Plan file: `~/.claude/plans/zesty-tumbling-fountain.md`. Both gated on telemetry — only worth doing if post-PR-#4 dashboard reads are still high. Check Firestore usage before committing time.
7. Validate posture model with real sessions on claude-sonnet-4-6 — watch first few conversations for behavior shifts vs 4.0, tune prompts if agent over-challenges or misreads signals.
8. Users & roles Phase 1: display names everywhere (see `docs/users-and-roles-plan.md`).
9. Add tests for `useStreamingChat` hook. RTL setup is now proven (see `components/__tests__/FeedbackWidget.test.tsx`): use `// @vitest-environment jsdom` pragma, `import '@testing-library/jest-dom/vitest'`, and call `cleanup()` in `afterEach` (RTL doesn't auto-clean with our vitest config).
10. Project folders for the dashboard — group stale projects into folders, badge on each folder with count of projects where it's the builder's turn. Design questions open: per-builder vs shared, one folder vs many, default folder, drag-drop vs menu.
11. Smoke-test the prep-prompts split in prod (commit `21f4c10`). Eight cases listed in prior conversation: happy paths for both flows, mismatch rejection both ways, backward-compat with no `_payload_type`, `seed_questions` round-trip, `open_risks` preservation, code-fence tolerance.
12. Maker experience design exploration. `docs/maker-experience-functionality.md` is the implementation-agnostic functional spec. Next: hand to one or two design agents to propose interface concepts. Open questions in §8.
13. Maker re-engagement flow — signed-token email action links (3/7/14/30 day snooze + opt-out → feedback page). See `docs/maker-re-engagement-plan.md`. Blocked on conversation with Ryan re: snooze values, feedback chips, cadence.
14. Validate Session 4 with Matt using new `voice_sample` + `nudge_message` override. First real test of voice-anchored AI outbound copy and verbatim override.

## Env vars

Production (Vercel):
- `CRON_SECRET` — required. Vercel auto-sends this as `Authorization: Bearer <CRON_SECRET>` to cron routes. `/api/cron/notify` rejects without it.
- `RESEND_API_KEY` — for transactional email (interest form, notify cron).
- `ANTHROPIC_API_KEY` — for the agent.
- `GITHUB_TOKEN` — for `/api/admin/feedback/[id]/to-github`. Fine-grained PAT, `Issues: Read & write`. Currently scoped to `nicolovejoy/ibuild4you`, `nicolovejoy/bakerylouise-v1`, `nicolovejoy/offer-builder` (2026-05-13). Without it the route returns 500. Per-project repo is configured on `projects.github_repo`.
