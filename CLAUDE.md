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

1. **RAAC Phase 3 — 3c role-assignment UX remaining (3a + 3b SHIPPED).** 3a (PR #47, `73522ce`): `brief_role` on `project_members`; `lib/roles/brief-role.ts`; backfill applied to prod 2026-05-30 (31 members). **3b SHIPPED to prod (PR #49, `8ecbb21`, 2026-06-07):** `lib/roles/display.ts` (`briefRoleLabel`/`briefRoleShort`/`viewerBriefRole`); chrome role badges Maker/Builder → Originator/Reviewer in maker header, builder console (rail+mobile), dashboard card; removed legacy glossary keys. Verified on preview via the new e2e harness. **3c (next)** = per-member role-assignment UX (setup-tab Roles panel + share-modal selector; extend `/api/projects/role` to write `brief_role`) — the natural moment to build a multi-role `seed-test-cast` (originator/contributor/reviewer/owner) so role flows are testable. 3c only earns its keep once roles *do* something behaviorally, i.e. design it alongside 5b, not before. Full plan at `~/.claude/plans/quiet-shimmering-roan.md`. Unblocks #44.
2. **Voice attribution (issue #43) — PARKED.** Cheap part SHIPPED: a one-line function-based disclosure on the About page (`copy.about.voiceNote` under the signature). The hard part — section-level provenance strips on brief sections (`authored_by`/`drafted_by`/`last_edited_by`/`last_edited_at` schema + UI) — is **parked until the brief editor gets its next substantive pass** (the only moment the schema earns its keep). Research/recommendation preserved on issue #43; don't rebuild it. Intention is sound, no plan yet — deliberately not carrying it as active work. Avoid per-sentence/paragraph badges per over-marking research.
3. **🔒 Preview Firestore split — SHIPPED & VERIFIED (2026-06-06).** Preview deploys now write to a sandboxed `ibuild4you-preview` Firebase project, not prod. Provisioned via CLI (project + Firestore `nam5` + rules/indexes), Auth initialized + Google enabled + `preview.ibuild4you.com` authorized, 5 `FIREBASE_*`/`NEXT_PUBLIC_FIREBASE_*` vars split per-environment on Vercel (Preview→preview, Prod→prod, Dev left on prod). Code fix: `next.config.ts` `/__/auth/*` rewrite now derives from `NEXT_PUBLIC_FIREBASE_PROJECT_ID` (was hardcoded to prod — would've routed preview sign-in through prod). Verified: preview dashboard shows only the seeded test project; prod untouched. Test admin (`test@ibuild4you.com` + passcode in 1P `dev-secrets`) seeded into preview. Tooling: `scripts/with-preview-env.mjs` + gitignored `.env.preview.local`. Ops + gotchas: `docs/preview-firestore-split.md`. Closes the May 23 incident; unblocks RAAC 3b (now testable on preview) + agent-driven Playwright on preview.
4. **Reminders — SHIPPED & live (2026-06-06).** Flip complete: `REMINDER_DRY_RUN` deleted + prod redeployed (env-var changes need a redeploy to take effect — the gotcha). Validated end-to-end via a real send-to-self (`test-at-airport`, `nlovejoy@me.com`). prntd safe (maker responded → cron correctly skips). Admin per-brief toggle added on `/admin/reminders` (`GET /api/admin/reminders/projects` + Switch; flip reuses `PATCH /api/projects`, admin = implicit owner). Rollback = re-add `REMINDER_DRY_RUN=true` **and redeploy**. How-it-works + ops: `docs/reminders-plan.md`. Remaining (Backlog): dashboard filter/sort; reminder copy (#21).
5. **UX rethink — assisted multi-human conversation is the headline. 5a SHIPPED; 5b is the direction.** The assistant is now **Sam** (chat) / **Sam Scribe** (About) — "Roan" retired, illustrations removed (PR #49, `8ecbb21`, shipped to prod 2026-06-07; de-persona on purpose — a label, not a mascot). **5a SHIPPED to prod (PR #49):** the builder nav was mislabeled — relabeled "Conversations"→**Sessions** and "Next Conversation" (really a Settings/config drawer: agent setup, seed questions, directives, auto-reminders, github_repo)→**Setup**; swept conversation→session copy. The builder loop is still fundamentally *state-store + clipboard* for an external reasoning round-trip (export brief JSON → think with an outside agent → paste back config). **5b (the real product direction, still EXPLORATION not code):** the key feature is **2+ humans in a conversation that Sam assists** (not solo maker↔AI). Next unit of work isn't "3c the dropdown" — it's "make a brief support a second human in a defined role, end to end" (invite as contributor → they join → Sam mediates → attribution shows); the multi-role `seed-test-cast` is the cheapest 5b prototype. Open product Qs before designing: fixed cast vs. people flowing in/out? can one person hold two roles (owner+originator)? Active artifact: ChatGPT journey-cartoon prompts (cast: two people + Sam; idea "a cozy Italian café in Seattle") — prompt A done; B/C (without-vs-with-Sam contrast, returning-after-break) pending. TODO once liked: save experience spec + prompts to `docs/`.
6. **BUG (parked) — "Needs setup" badge disagrees with dashboard.** On Lori's brief page the header showed "Needs setup" while the dashboard card showed "Waiting on Lori" for the same project. Logic at `lib/turn-indicator.ts:20` keys on `!requester_email || !session_count`. The single-project GET *does* run `enrichProjects` (`app/api/projects/route.ts:157`), so the cause isn't obviously missing enrichment — likely the brief page renders from a different/cached/realtime project object lacking `session_count`. Real symptom, cause unpinned. (Earlier #24 closed this as working-as-intended — may have been wrong.)
7. **iCloud catch-all decision** for `test@ibuild4you.com` (and future `test-*@`). iCloud.com → Mail Settings → Custom Email Domain → "Catch-all" toggle on `ibuild4you.com`. Lets test-account emails (reminders, invites) land in Nico's inbox so we can validate maker-facing flows end-to-end via the Playwright test admin identity.
8. **Code-quality consolidation — remaining bits.** PRs A + B + C SHIPPED (PR #46, `aba5f16`): DRY top-3 (`lib/url.ts` `getProjectShareLink`, `getMakerShortName`, `useNudgeCopy`) + mutation-route tests (`briefs/generate`, `projects/{claim,role}`, `users/me`). Plan at `~/.claude/plans/cheerful-soaring-matsumoto.md`. **Still open:** `projects/share` POST route test (deferred — same `resolveBriefRole`/role logic covered elsewhere); `copy.ts` unused-key deletion (deferred as regression-prone — verify each key with grep first); remaining untested routes (`files/*`, `auth/passcode`, `interest`, `users`, `approved-emails`).
9. **#31 — Agent kickoff on session open.** Real fix for "I had to type first." New `/api/chat/kickoff` route + frontend mount-time trigger; uses existing system prompt so #26 + #27 fire on session open. Watch for the infinite-trigger / multi-tab edge cases called out in the issue body.
10. **#21 + #25 framing bundle.** Reminder copy (#21) + auto-progress to 'send nudge' after JSON import (#25). 'Waiting on {maker}' card placement already in place at `BuilderProjectView.tsx:1249` (`RenudgeCard`).
11. **Productionize `/api/chat`.** Top-level try/catch → JSON 500 envelope, client `useStreamingChat` tolerance for non-JSON errors, structured logging, defensive tests. Has been sitting; worth landing soon.
12. **Resend inbound — manual setup, then PR 3.** Webhook handler shipped at `app/api/webhooks/resend/inbound/route.ts` (`1799395`). Remaining: Resend dashboard inbound config on `inbox.ibuild4you.com`, MX records, `RESEND_INBOUND_SECRET` on Vercel (punch list at `docs/feedback-replies-plan.md`). Then PR 3 swaps `Reply-To: noreply@` (currently hardcoded at `lib/email/send-reminder.ts:27`) for per-session `reply+{signed_token}@inbox.ibuild4you.com` so maker email replies post as messages. **Note:** the `inbox.` subdomain MX points at Resend independently of any apex catch-all (item 5).

## Recent context

Full dated history: `docs/changelog.md`. Most recent below.

**Shipped 2026-06-07 (PR #49 `8ecbb21` — RAAC vocab, merged to prod):** RAAC 3b role badges (Maker/Builder→Originator/Reviewer via `lib/roles/display.ts`), assistant rename Roan→**Sam** / **Sam Scribe** + illustrations removed, 5a nav reframe (Conversations→Sessions, Next Conversation→Setup). 584 green; verified on preview via the new harness, then prod-verified ("Sam Scribe" live on `/about`). **New agent-driven e2e capability:** `scripts/e2e-preview-login.mjs` logs in headlessly as the passcode test admin on preview (needs `.ibuild4you-bypass` Vercel token + `.test-admin-passcode`, both gitignored; `npm i --no-save playwright`); `seed-test-admin.mjs` now deterministic via `SEED_PASSCODE` (fixes prod/preview passcode drift; preview passcode in 1P as its own item).

**Shipped 2026-06-06 (reminders flip live + admin toggle + docs scrub):** commit `3d0bf64`. Reminders went live (deleted `REMINDER_DRY_RUN` + **redeployed** — env-var changes need a redeploy; validated a real send-to-self via `test-at-airport`; prntd safe — she'd replied so the cron skips). Admin per-brief auto-reminders Switch on `/admin/reminders` (`GET /api/admin/reminders/projects` + reuses `PATCH /api/projects`; TDD, 576 green). Docs scrub: moved the dated changelog here → `docs/changelog.md`; rewrote `reminders-plan.md` to an ops reference; accuracy-only pass on `iteration-architecture.md` / `conversational-posture-model.md` / `users-and-roles-concept.md`.

## Backlog (deeper queue)

- **Agent-driven Playwright on preview.** Set up a Vercel "Protection Bypass for Automation" token + a clean pattern for the agent to access `test@ibuild4you.com`'s passcode (currently blocked by the secrets hook). With both, the agent owns end-to-end UI verification on `preview.ibuild4you.com` instead of relying on copy-paste between Claude Code and Claude.ai's browser MCP. Docs: https://vercel.com/docs/deployment-protection/methods-to-bypass-deployment-protection/protection-bypass-automation. Pair with a session memory + a thin helper script that builds the bypassed URL (`?x-vercel-set-bypass-cookie=true&x-vercel-protection-bypass=$TOKEN`).
- **Dashboard filter + sort (reminders follow-up).** Filter by turn-state + remind-state; sort by last-activity/created/nudged. Separate PR; makes the dashboard scale with maker count.
- **#40 — Architectural drift: `useRealtimeMessages` bypasses API-route layer.** Client-direct Firestore subscription. Low severity; works today; replace with SSE-via-API when convenient.
- **Bigger drag-and-drop zone for chat file attach.** Drop target is currently just the composer row (`MakerProjectView.tsx` `handleDrop` on the input container) — Nico had to aim at the text box. Expand the dashed/highlighted drop area to the whole chat panel. Small, isolated UX win; own PR + preview re-test.
- **Reply to Manine** that file uploads are fixed (agent now reads Word docs/text/images; clear message for unsupported). Her feedback drove PR #48.
- **#38 — PDF upload validation (cache_control fix unverified end-to-end).** Likely subsumed by PR #48's type validation + `{blocks, dropped}` reporting — re-check before working.
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
