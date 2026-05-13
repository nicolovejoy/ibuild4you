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

0. **URGENT — Firestore quota incident**. App-wide 401s on 2026-05-12/13 traced to Firestore daily read cap (50K free) being hit, masked as "Invalid token" by a misleading catch block in `lib/api/firebase-server-helpers.ts`. Blaze plan applied 2026-05-13. Full incident writeup + concrete fix plan in `docs/firestore-quota-incident.md`. Ship in order: P1 split catch block, P2 cut `/api/projects` read fan-out, P3 cache user doc in `getAuthenticatedUser`. P4 = synthetic monitoring + read-count test.
1. Validate Matt's PDF flow end-to-end. Cache_control fix (`a8d9c94`) is live but unverified against real Matt traffic — need to see his next chat return 200 AND the agent reference actual PDF content (form name, clause), not just acknowledge files exist. Tune `lib/agent/system-prompt.ts` if it ignores/hallucinates. Cron + B1 idle brief regen are firing cleanly with no errors but also pending Matt activity for full confirmation.
2. A4 — pre-upload batch size budgeting. `addFiles` currently checks per-file >25MB; extend to running batch total so the picker rejects before the init round-trip. See `docs/file-and-brief-fixes-plan.md` § A4. (A3 atomic upload semantics shipped 2026-05-09 in commit `5ce0c52`.)
3. Project delete should clean up files. Today DELETE `/api/projects` removes sessions/messages/briefs/members but leaves the `files` Firestore docs and S3 objects orphaned. Extend the delete handler to also delete `files` docs and the matching `s3://ibuild4you-files/projects/<id>/` prefix. The cleanup logic in `scripts/cleanup-test-data.mjs` is the reference — factor its S3+Firestore delete steps into a shared helper.
4. Watch for `verifyIdToken` errors in prod logs. Diagnostic logging added 2026-05-13 (`c7d9b2d`). The "Invalid token" 401s seen overnight 2026-05-12→13 self-resolved (likely a transient Vercel runtime issue fetching Firebase JWKs). If it recurs, real error message will now be in `vercel logs`.
5. Validate posture model with real sessions on claude-sonnet-4-6 — watch first few conversations for behavior shifts vs 4.0, tune prompts if agent over-challenges or misreads signals.
6. Users & roles Phase 1: display names everywhere (see `docs/users-and-roles-plan.md`).
7. Add tests for `useStreamingChat` hook (needs React Testing Library setup).
8. Project folders for the dashboard — group stale projects into folders, show a badge on each folder with count of projects where it's the builder's turn. Design questions open: per-builder vs shared, one folder vs many, default folder, drag-drop vs menu.
9. Smoke-test the prep-prompts split in prod (commit `21f4c10`). Eight cases listed in conversation: happy paths for both flows, mismatch rejection both ways, backward-compat with no `_payload_type`, `seed_questions` round-trip, `open_risks` preservation, code-fence tolerance. Watch for any rough edges in the receiving Claude's adherence to the new JSON shape (does it actually put `_payload_type` first?).
10. Maker experience design exploration. `docs/maker-experience-functionality.md` is the implementation-agnostic functional spec. Next: hand to one or two design agents to propose interface concepts. Open questions listed in §8 of that doc.
11. Maker re-engagement flow — signed-token email action links (3/7/14/30 day snooze + opt-out → feedback page). See `docs/maker-re-engagement-plan.md`. Blocked on conversation with Ryan re: snooze values, feedback chips, cadence. Once unblocked, sequencing in the doc: schema → cron sends maker email → action endpoint + landing pages → builder dashboard surfaces → share modal rework.
12. Validate Session 4 with Matt using new `voice_sample` + `nudge_message` override. First real test of voice-anchored AI outbound copy and verbatim override — watch whether output feels less generic than the prior listy "we'll cover X, Y, and Z" pattern.

## Env vars

Production (Vercel):
- `CRON_SECRET` — required. Vercel auto-sends this as `Authorization: Bearer <CRON_SECRET>` to cron routes. `/api/cron/notify` rejects without it.
- `RESEND_API_KEY` — for transactional email (interest form, notify cron).
- `ANTHROPIC_API_KEY` — for the agent.
