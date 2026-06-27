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
    "decisions": [{ "topic": "Payment", "decision": "Stripe only", "locked": true }]
  },
  "session_opener": "Alias for welcome_message (either works)"
}
```

Side effects on create: generates slug, creates owner membership, creates maker membership + approves email (if `requester_email`), creates first session (snapshots config), adds welcome message as first agent message, creates initial brief (if `brief` provided).

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

## Code Style

Keep the code approachable — clarity over cleverness. Code should be:
- Clear and straightforward — no clever abstractions
- Well-commented where non-obvious
- Following patterns established in NoteMaxxing

## Next Steps

> Shipped history lives in `docs/changelog.md`. This section is **live work only**. The open-issue queue on GitHub (`gh issue list`) is the canonical backlog; key threads: **#23** (files folders, P2), **#29** (explore mode), **#39** (prep-prompt ferry spot-checks), **#40** (realtime drift), **#43** (voice attribution, parked), **#61** (fixtures shims), **#72** (richer prototype perception), **#81** (re-copy member invite creds), **#83**/**#84** (artifacts store / MCP authoring bridge), **#103** (badge-vs-dashboard bug).

1. **Multi-human briefs (5b) — next slice.** Phase 1 + 1.5 shipped (Sam mediates 2+ humans; identity-aware kickoff). Next (exploration): member "move out" flow + dual-role question (the bigger membership-lifecycle slice); attribution-in-UI polish. Journey-cartoon prompts B/C pending; save experience spec to `docs/` once liked. Cast fixture: `scripts/seed-test-cast.mjs`.
2. **#43 voice attribution — PARKED.** Cheap disclosure shipped (`copy.about.voiceNote`). Hard part — section-level provenance schema + UI on brief sections — parked until the brief editor gets its next substantive pass (the only moment the schema earns its keep). Research preserved on #43; don't rebuild. Avoid per-sentence/paragraph badges per over-marking research.
3. **#12 Resend inbound — manual setup, then PR 3.** Webhook handler shipped (`app/api/webhooks/resend/inbound/route.ts`). Remaining: Resend dashboard inbound config on `inbox.ibuild4you.com`, MX records, `RESEND_INBOUND_SECRET` on Vercel (punch list: `docs/feedback-replies-plan.md`). Then PR 3 swaps `Reply-To: noreply@` (`lib/email/send-reminder.ts`) for per-session `reply+{signed_token}@inbox.ibuild4you.com` so maker email replies post as messages.
4. **Code-quality tail.** Still open: `projects/share` POST route test (deferred); `copy.ts` unused-key deletion (regression-prone — grep each key first); untested routes (`files/*`, `auth/passcode`, `interest`, `users`, `approved-emails`). Plan: `~/.claude/plans/cheerful-soaring-matsumoto.md`.
5. **🔥 OPERATIONAL RUNBOOK — brief-regen cost runaway (fixed PR #78, keep this).** If Anthropic costs spike: query the **`api_usage`** Firestore collection grouped by route+project, look for a project stuck at the cron interval (was `route='brief.generate'` retrying every 5-min tick, ~$8.4/day). Gate lives at `lib/api/brief-regen-gate.ts` (breaker holds after 3 fails); emergency stop: `scripts/stop-regen-loop.mjs <projectId> --apply`.
6. **⚠️ Preview gotcha — deployment protection is ON.** Opening `preview.ibuild4you.com` hits the Vercel SSO gate before app login. Real cast/UI testing needs a Vercel login or the `.ibuild4you-bypass` automation token (see `reference_e2e_preview` memory). Prod unaffected.

## Recent context

Full dated history: `docs/changelog.md`. Most recent below.

**Shipped 2026-06-25 (#21 + voice_sample to prod; #23a Phase 0 in review):** **#21 (PR #99, `a78dceb`, merged):** reminder copy → short/personal `"{Name}, your next conversation (#n) awaits:"`; `send-reminder.ts` de-duped onto `copy.nudge.reminder`; conversation number via a denormalized `session_count` (set at session-create + project-create; older briefs omit it until next session); "Waiting on {maker}" card pinned to top of Next round. **voice_sample** now editable in Agent setup → Advanced. Closed #21. **#23a (PR #100, OPEN):** delete a file — `DELETE /api/files/[fileId]` (builder+, S3 object + Firestore doc, tolerant) + shared `deleteS3Object` + `useDeleteFile` + Delete/confirm in `FilePreviewModal`. Plan: `docs/files-delete-folders-plan.md`. 801 green, type-check + build clean. Both preview-verified 4/4 via new harness (`seed-waiting-brief.mjs`, `e2e-21-waiting-reminder.mjs`, `e2e-23a-file-delete.mjs`). **Gotcha:** Playwright `getByRole({name})` is substring — a fixture filename containing "delete" matched the file card; keep test fixtures clear of UI keywords. **Next: merge #100, then #23 P1 — S3-orphan cleanup on brief delete.**

**Shipped 2026-06-24 (3 roadmap small-wins to prod):** **#12 (PR #97, `506720b`):** edit requester email as an auth re-key — `PATCH /api/projects/share` takes `new_email`, re-keys `project_members` + `approved_emails` + `project.requester_email`, reissues passcode; "Edit email" in the share modal. Decision: regenerate passcode (a typo'd invite to a wrong real inbox stops working; you re-send to the corrected address anyway); old `approved_emails` left in place. **#16 (PR #98, `426757b`):** retired the dashboard-card delete (one mis-click from Archive) → owner-only "Delete brief" relocated to brief → Agent setup → Advanced → Danger zone. Archive (per-viewer hide) stays the everyday action; a deliberate purge path is kept because archive only hides. S3-orphan cleanup left to backlog. **#11 tail (`a226e0a`, direct-to-main):** chat top-level error log now carries `session_id`/`project_id` via a `ctx` filled in `handleChat`. 794 green throughout; all Playwright-verified on preview (#16 incl. a full create→delete cycle). **Phase 2 next:** #21 reminder copy + voice_sample per-brief override.

**Shipped 2026-06-17 (#65 cross-brief digest):** **#65 (PR #80, `e500943`):** replaced per-brief notify spam with one daily cross-brief digest. New `lib/api/notify-digest.ts` `buildDigest()` (pure, TDD) + `app/api/cron/notify-digest/route.ts` (daily 15:00 UTC) querying `notify_pending_since` (`> ''`), sending ONE email for all pending briefs, clearing markers in a batch post-send; `/api/cron/notify` keeps only idle brief-regen. 716 green; merged + prod-verified by firing the live cron (`{"sent":false,"checked":0}` empty, then `sent:true` after seeding a real marker). **Gotcha learned:** `CRON_SECRET` and `RESEND_API_KEY` are **Vercel-only** — NOT in `.env.preview.local` / `.env.production.local`, so local scripts can't auth the cron or send email; fire via the deployed route with `vercel env pull` (see `reference_vercel_only_secrets`). **Filed #81** (Setup→People re-copy member invite creds). **Unblocked Scott on the prod BySide brief** — he already had his own `project_members` row + passcode; the share UI only surfaced the originator's creds, and `/api/auth/passcode` matches email+passcode together so a shared passcode logs you in as that other person.

**Shipped 2026-06-15 late (multi-person invite + PR #77 merge):** **Multi-person invite (PR #79, `3735dec`):** once a brief had a `requester_email`, the Setup People-panel "+ Invite" reopened `ShareModal` but only showed the "Shared with X" confirmation — no form to add a 2nd person; and `share/route.ts` always overwrote `project.requester_email` (would clobber the originator). Fix: `ShareModal` gains `mode` ('maker' | 'add') — add mode always shows a blank form (defaults role Contributor) + shows the new person's own link/passcode; "+ Invite" opens add mode. `share/route.ts` only stamps `requester_email`/`shared_at` on the **first** share (or re-share of the same person); additional invitees live as `project_members` rows. `useShareProject` now invalidates the members query. TDD'd (`share-post.test.ts` — 2nd invite doesn't clobber), 708 green; preview-verified end-to-end (Firestore showed requester_email unchanged + new member as `brief_role: contributor`). **Also merged PR #77** (Phase-0 sweep) to prod. **Non-finding:** the reported auto-reminders toggle persistence bug did NOT reproduce — drove the live preview UI (PATCH→hard-refresh→soft-nav all persist) and the data layer is correct; likely an older deploy / different brief at the time. Found one harmless latent defect (`useUpdateProject` invalidates `resolveProject(docId)` while the query is keyed on the slug — masked by React Query refetch). **Next: #65 cross-brief digest.**

**Shipped 2026-06-15 PM (#70 welcome-replay + 🔥 cost-runaway fix; Phase-0 sweep PR #77 open):** **#70 (PR #76, `672303f`):** stop replaying the static `welcome_message` on every new session — `app/api/sessions/route.ts` inserts the canned welcome only on the project's first session; return sessions start empty and the kickoff recaps (kickoff now judges prior maker history at the **project** level). Playwright-verified on preview (created session 2 → 0 canned messages → maker saw "Hey Mara, welcome back…"). **🔥 Cost runaway FIXED (PR #78, `f1b8177`):** one prod brief called `brief.generate` 229×/day at the 5-min cron interval (~$8.4/day, found via the `api_usage` collection). A brief over `BRIEF_MAX_TOKENS` always fails regen, and the circuit breaker kept a stale `failures_since` so it cleared-and-retried forever. Fix: pure tested gate `lib/api/brief-regen-gate.ts` (breaker that holds), `BRIEF_MAX_TOKENS` 2048→8192, cron skips all-archived briefs; `scripts/stop-regen-loop.mjs` halted the live loop. 689 green. **Phase-0 sweep PR #77 (open, on preview):** #66 already shipped (verified); #67 reminder-status strip (`nextReminderAt()`); #68 tolerant JSON import (`parseLooseJson`). **Process:** spawned 5 read-only investigation agents to scope #65/#66/#67/#68/#71/#72 and reconciled into a phased plan (Phase 0 done → #65 → #71 → #72). **Next: merge #77, then #65 digest.**

**Shipped 2026-06-15 AM (Matt/BySide maker feedback — 3 PRs to prod):** Triaged a real multi-session intake transcript into 4 GitHub issues (#69–72). **#69 (PR #73, `d89476c`):** agent self-awareness — Sam declares "I'm intake, I hand this to your developer" up front (DEFAULT_IDENTITY + first-session intro + welcome generator) and admits it can't see the running prototype (offers screenshot path) instead of faking a walkthrough; guardrails in both modes. **#74 (PR #74, `9ff1b68`):** fixed a prod 500 on `/api/projects/[id]/members` — `getUserDisplayName` now guards an empty `uid` (a not-yet-signed-in member made Firestore `.doc('')` throw → "Failed to load members"). **#75 (PR #75, `857fa1a`):** builders email the maker **directly via Resend** (invite/nudge/reminder) — `POST /api/projects/[id]/email`, `lib/email/send-maker-email.ts`, a Modal-confirm `SendToMakerButton` (replaced a confusing inline confirm); To: maker, BCC+Reply-To: builder; honors `nudge_message` override + mints invite passcode; extracted `lib/passcode.ts` + `getServerShareLink`. 669 green. **Email DNS verified** (sending ✅ via Resend DKIM/SES; DMARC missing — optional add; `test@ibuild4you.com` doesn't receive so preview BCC bounces, prod unaffected). **Next: #70 welcome-replay** — plan at `docs/archive/welcome-replay-plan.md` (approach A).

**Shipped 2026-06-14 (#44 dashboard restructure + per-viewer archiving + fixtures consolidation — 4 PRs to prod):** **#44 (PR #60, `f0a86fc`):** sectioned dashboard by role/turn-state (`lib/dashboard/group-briefs.ts`, TDD) + amber "Awaiting you" + collapsed Done + `shouldFlatten` low-N fallback; Phase 0 threaded `viewer_brief_role`/`state`. **Archive (PR #64, `eda1151`):** per-viewer `archived_at` on `project_members` → `viewer_archived` through both GET list paths; `PATCH /api/projects/archive`; `archived` bucket (wins over Done); all sections collapsible w/ localStorage. **Bug caught via Playwright:** the admins-see-all GET branch wasn't threading `viewer_archived` (archiving did nothing for admins) — fixed. **Fixtures (#62 `451ab97` + #63 `bb85e19`):** shared `scripts/fixtures/db.mjs` (init + preview-guard + doc builders) + `seed_tag`/`seed_scenario` stamping + `cleanAll`; unified `scripts/seed.mjs` runner (list/`<scenario>`/reset) with scenario registry; migrated dashboard-buckets + multi-human-cast (seed-test-cast now a shim). 650 green. **Verification:** agent-driven Playwright on preview now proven (`.ibuild4you-bypass` + `.test-admin-passcode` + capture `/api/projects` response). **Filed 4 feedback issues #65–68** (prioritized in Next Steps item 15); #61 tracks remaining fixture migrations.

**Shipped 2026-06-13 (#56 account identity + #11 chat hardening — 2 PRs to prod) + #44 planned:** **#56 (PR #58, `a0165b8`):** `UserMenu` now shows an identity pill (`account_label ?? first_name ?? email-prefix`) instead of a bare icon; new self-assigned `account_label` on the `users` doc, editable inline in the menu; `PATCH /api/users/me` became a partial update. Preview-verified all 5 steps. **#11 (PR #59, `9de605a`):** productionized `POST /api/chat` — thin `handleChat()` wrapper returns JSON 500/400 envelopes (never HTML) + logs `chat_request_error`; client `errorMessageFromResponse()` (`lib/hooks/chat-error.ts`) tolerates non-JSON error bodies. +6 tests, 633 green. **#44 (next):** wrote `docs/archive/dashboard-restructure-plan.md` (Hybrid grouping, Phases 0–2, decisions locked) — **awaiting Nico's clearance before coding.** Process note: local `main` diverged twice after squash-merges (never-pushed `486003c` folded into #58's squash) — reconciled via `git reset --hard origin/main` each time.

**Shipped 2026-06-13 (brief-identity system + #25 + brief switcher — 3 PRs to prod):** Every brief now has a stable, **PII-free visual identity** — color + 4-char code + glyph from `briefIdentity(docId)` (`lib/brief-identity.ts`; `components/ui/BriefBadge.tsx`). Doc-id derived (never title/name/slug) → survives renames + safe on the **unauthenticated, scraper-cached OG route**. **#54 (`b519c44`):** util + dashboard cards (accent strip + badge) + maker/builder/brief headers + per-brief OG link-preview card (`app/projects/[id]/opengraph-image.tsx`, nodejs runtime; glyphs as Satori-safe inline SVG; generic fallback). Prod-verified. **#55 (`b5e1a06`, #25):** JSON-import dead-end fixed — import lands the builder on Setup with prep auto-expanded. **#57 (`a9ea120`):** brief switcher in the header (badge → dropdown of your other briefs). 623 green. Kept separate from #53 bubble colors. **Cut #56** (account identity in top nav + nameable accounts). Skipped the planned admin/nav IA cleanup as low-value churn. Memory: `project_brief_identity`.

**Shipped 2026-06-08 (PR #53 — agent kickoff + multi-human UX polish, merged to prod `1a0e7bc`):** `POST /api/chat/kickoff` greets returning makers by name on session open (typing indicator + recap) — the real fix for "I had to type first" (#31); the #26/#27 system-prompt rules now fire on open. Returning-after-a-break only (`lib/agent/kickoff.ts`), identity-aware in multi-human briefs (greets whoever opened), `last_kickoff_at` guards the reload/multi-tab loop. Bundled: first-name address ("Mara" not "Mara O"), per-participant bubble colors, self-explaining "Needs setup" badge (`TurnBadge`), maker-header user menu (email+sign out). 614 green; preview-verified live with the seeded cast (`scripts/backdate-cast-session.mjs` primes a stale session to force the greeting). Separately shipped OG/Twitter cards on the home page direct-to-main (`96a1881`; `app/opengraph-image.tsx` + `metadataBase`, verified absolute `og:image` 200 on prod). **Process note:** discovered preview deployment protection is ON (Vercel SSO gate before app login) — see Next Steps item 3.

**Shipped 2026-06-07 (PRs #50 + #52 — multi-human briefs, merged to prod):** **#50 (`aa50a75`, 5b Phase 1):** Sam now mediates 2+ humans in one brief — `chat/route.ts` name-tags user turns when 2+ distinct senders post + builds a participant roster; `system-prompt.ts` adds a "Who's in this conversation" mediation block. **#52 (`32e0077`, RAAC 3c):** role badge reads stored `brief_role` (fixes Contributor-as-Originator), `GET /api/projects/[id]/members`, `PATCH /api/projects/role` for `brief_role`, share-modal role selector, Setup-tab People panel. 601 green. Both verified on preview with a seeded multi-role cast (`scripts/seed-test-cast.mjs`, `e2e-cast-chat.mjs`, `e2e-cast-verify.mjs`) before merge. Sam, talking to two real logins: *"Hey Tomas, good to have you here too. Mara, what do you think about Tomas's catering idea?"*

**Shipped 2026-06-07 (PR #49 `8ecbb21` — RAAC vocab, merged to prod):** RAAC 3b role badges (Maker/Builder→Originator/Reviewer via `lib/roles/display.ts`), assistant rename Roan→**Sam** / **Sam Scribe** + illustrations removed, 5a nav reframe (Conversations→Sessions, Next Conversation→Setup). 584 green; verified on preview via the new harness, then prod-verified ("Sam Scribe" live on `/about`). **New agent-driven e2e capability:** `scripts/e2e-preview-login.mjs` logs in headlessly as the passcode test admin on preview (needs `.ibuild4you-bypass` Vercel token + `.test-admin-passcode`, both gitignored; `npm i --no-save playwright`); `seed-test-admin.mjs` now deterministic via `SEED_PASSCODE` (fixes prod/preview passcode drift; preview passcode in 1P as its own item).

**Shipped 2026-06-06 (reminders flip live + admin toggle + docs scrub):** commit `3d0bf64`. Reminders went live (deleted `REMINDER_DRY_RUN` + **redeployed** — env-var changes need a redeploy; validated a real send-to-self via `test-at-airport`; prntd safe — she'd replied so the cron skips). Admin per-brief auto-reminders Switch on `/admin/reminders` (`GET /api/admin/reminders/projects` + reuses `PATCH /api/projects`; TDD, 576 green). Docs scrub: moved the dated changelog here → `docs/changelog.md`; rewrote `reminders-plan.md` to an ops reference; accuracy-only pass on `iteration-architecture.md` / `conversational-posture-model.md` / `users-and-roles-concept.md`.

## Backlog (deeper queue)

- **Agent-driven Playwright on preview.** Set up a Vercel "Protection Bypass for Automation" token + a clean pattern for the agent to access `test@ibuild4you.com`'s passcode (currently blocked by the secrets hook). With both, the agent owns end-to-end UI verification on `preview.ibuild4you.com` instead of relying on copy-paste between Claude Code and Claude.ai's browser MCP. Docs: https://vercel.com/docs/deployment-protection/methods-to-bypass-deployment-protection/protection-bypass-automation. Pair with a session memory + a thin helper script that builds the bypassed URL (`?x-vercel-set-bypass-cookie=true&x-vercel-protection-bypass=$TOKEN`).
- **Dashboard filter + sort (reminders follow-up).** Filter by turn-state + remind-state; sort by last-activity/created/nudged. Separate PR; makes the dashboard scale with maker count.
- **#40 — Architectural drift: `useRealtimeMessages` bypasses API-route layer.** Client-direct Firestore subscription. Low severity; works today; replace with SSE-via-API when convenient.
- **Bigger drag-and-drop zone for chat file attach.** Drop target is currently just the composer row (`MakerProjectView.tsx` `handleDrop` on the input container) — Nico had to aim at the text box. Expand the dashed/highlighted drop area to the whole chat panel. Small, isolated UX win; own PR + preview re-test.
- **Reply to Manine** that file uploads are fixed (agent now reads Word docs/text/images; clear message for unsupported). Her feedback drove PR #48.
- **#39 — Smoke-test prep-prompts split in prod (commit `21f4c10`) — eight cases queued.**
- A4 — pre-upload batch size budgeting in `addFiles` (see `docs/archive/file-and-brief-fixes-plan.md` § A4).
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
