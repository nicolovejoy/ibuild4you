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

1. **RAAC Phase 3 — 3a/3b/3c all SHIPPED to prod.** 3a (PR #47): `brief_role` on `project_members`. 3b (PR #49): chrome role labels. **3c SHIPPED (PR #52, `32e0077`, 2026-06-07):** badge now reads stored `brief_role` (new `getViewerBriefRole`; `viewerBriefRole(tier, stored?)` prefers stored — fixes the Contributor-shows-as-Originator bug); `GET /api/projects/[id]/members`; `PATCH /api/projects/role` writes `brief_role`; share-modal Originator/Contributor selector; Setup-tab "People on this brief" panel (inline role edit). Verified on preview via `scripts/e2e-cast-verify.mjs`. **Small remaining:** dashboard-card badge still uses the access-tier default (`lib/api/enrich-projects.ts` doesn't carry `brief_role`) — low priority. Unblocks #44.
2. **Voice attribution (issue #43) — PARKED.** Cheap part SHIPPED: a one-line function-based disclosure on the About page (`copy.about.voiceNote` under the signature). The hard part — section-level provenance strips on brief sections (`authored_by`/`drafted_by`/`last_edited_by`/`last_edited_at` schema + UI) — is **parked until the brief editor gets its next substantive pass** (the only moment the schema earns its keep). Research/recommendation preserved on issue #43; don't rebuild it. Intention is sound, no plan yet — deliberately not carrying it as active work. Avoid per-sentence/paragraph badges per over-marking research.
3. **🔒 Preview Firestore split — SHIPPED & VERIFIED (2026-06-06).** Preview deploys now write to a sandboxed `ibuild4you-preview` Firebase project, not prod. Provisioned via CLI (project + Firestore `nam5` + rules/indexes), Auth initialized + Google enabled + `preview.ibuild4you.com` authorized, 5 `FIREBASE_*`/`NEXT_PUBLIC_FIREBASE_*` vars split per-environment on Vercel (Preview→preview, Prod→prod, Dev left on prod). Code fix: `next.config.ts` `/__/auth/*` rewrite now derives from `NEXT_PUBLIC_FIREBASE_PROJECT_ID` (was hardcoded to prod — would've routed preview sign-in through prod). Verified: preview dashboard shows only the seeded test project; prod untouched. Test admin (`test@ibuild4you.com` + passcode in 1P `dev-secrets`) seeded into preview. Tooling: `scripts/with-preview-env.mjs` + gitignored `.env.preview.local`. Ops + gotchas: `docs/preview-firestore-split.md`. Closes the May 23 incident; unblocks RAAC 3b (now testable on preview) + agent-driven Playwright on preview. **⚠️ Gotcha (found 2026-06-08): preview deployment protection is ON** — opening `preview.ibuild4you.com` hits the Vercel SSO gate before the app login. Contradicts older notes that said it's off for previews. Real cast/UI testing needs a Vercel login (or the `.ibuild4you-bypass` automation token). **Prod is unaffected** (no Vercel gate on `ibuild4you.com`). TODO: turn preview protection off for the alias, or accept the bypass-token flow and scrub the stale "off" claims.
4. **Reminders — SHIPPED & live (2026-06-06).** Flip complete: `REMINDER_DRY_RUN` deleted + prod redeployed (env-var changes need a redeploy to take effect — the gotcha). Validated end-to-end via a real send-to-self (`test-at-airport`, `nlovejoy@me.com`). prntd safe (maker responded → cron correctly skips). Admin per-brief toggle added on `/admin/reminders` (`GET /api/admin/reminders/projects` + Switch; flip reuses `PATCH /api/projects`, admin = implicit owner). Rollback = re-add `REMINDER_DRY_RUN=true` **and redeploy**. How-it-works + ops: `docs/reminders-plan.md`. Remaining (Backlog): dashboard filter/sort; reminder copy (#21).
5. **UX rethink — assisted multi-human conversation is the headline. 5a SHIPPED; 5b is the direction.** The assistant is now **Sam** (chat) / **Sam Scribe** (About) — "Roan" retired, illustrations removed (PR #49, `8ecbb21`, shipped to prod 2026-06-07; de-persona on purpose — a label, not a mascot). **5a SHIPPED to prod (PR #49):** the builder nav was mislabeled — relabeled "Conversations"→**Sessions** and "Next Conversation" (really a Settings/config drawer: agent setup, seed questions, directives, auto-reminders, github_repo)→**Setup**; swept conversation→session copy. **⚠️ Superseded:** item 19 Phase 2 (2026-06-22) reverted the nav to **Brief · Conversations · People** — the "Sessions"/"Setup" names are gone. The builder loop is still fundamentally *state-store + clipboard* for an external reasoning round-trip (export brief JSON → think with an outside agent → paste back config). **5b Phase 1 SHIPPED to prod (PR #50, `aa50a75`, 2026-06-07):** 2+ humans in one brief that Sam mediates. `app/api/chat/route.ts` name-tags user turns when 2+ distinct human senders post (solo unchanged); builds a participant roster `{name, brief_role}`; `lib/agent/system-prompt.ts` renders a "Who's in this conversation" mediation block for 2+. Verified on preview: Sam named both humans + surfaced their disagreement instead of picking a side. Fixture/prototype: `scripts/seed-test-cast.mjs` (originator/contributor/reviewer/owner on one preview brief; cast at `preview.ibuild4you.com/projects/test-cast-cafe`; passcodes in gitignored `.test-cast-passcodes.json`). **Product calls locked:** one brief_role per person (no schema change); first slice = both chat in same brief; invite-in only (no member-removal/status yet). **5b Phase-1.5 SHIPPED (PR #53, 2026-06-08):** identity-aware kickoff greeting + first-name address (fixes the "Mara O" oddity) + per-participant bubble colors landed with #31. **5b next (exploration):** member "move out" flow + dual-role question (the bigger membership-lifecycle slice); attribution-in-UI polish. Journey-cartoon prompts B/C still pending; save experience spec to `docs/` once liked.
6. **BUG (parked) — "Needs setup" badge disagrees with dashboard.** On Lori's brief page the header showed "Needs setup" while the dashboard card showed "Waiting on Lori" for the same project. Logic at `lib/turn-indicator.ts:20` keys on `!requester_email || !session_count`. The single-project GET *does* run `enrichProjects` (`app/api/projects/route.ts:157`), so the cause isn't obviously missing enrichment — likely the brief page renders from a different/cached/realtime project object lacking `session_count`. Real symptom, cause unpinned. (Earlier #24 closed this as working-as-intended — may have been wrong.)
7. **iCloud catch-all decision** for `test@ibuild4you.com` (and future `test-*@`). iCloud.com → Mail Settings → Custom Email Domain → "Catch-all" toggle on `ibuild4you.com`. Lets test-account emails (reminders, invites) land in Nico's inbox so we can validate maker-facing flows end-to-end via the Playwright test admin identity. **DNS verified 2026-06-15:** apex MX → iCloud; sending auth ✅ (Resend DKIM `resend._domainkey` + `send.ibuild4you.com` SES SPF — that's why sends deliver); **DMARC missing** (`_dmarc.ibuild4you.com` empty — add `v=DMARC1; p=none; rua=mailto:nlovejoy@me.com` TXT in Cloudflare, optional/deliverability). `test@ibuild4you.com` does NOT receive (preview builder-email BCC/Reply-To bounces "Recipient not found" — harmless, To still delivers; prod uses real builder emails so unaffected). Catch-all only needed for clean preview tests.
8. **Code-quality consolidation — remaining bits.** PRs A + B + C SHIPPED (PR #46, `aba5f16`): DRY top-3 (`lib/url.ts` `getProjectShareLink`, `getMakerShortName`, `useNudgeCopy`) + mutation-route tests (`briefs/generate`, `projects/{claim,role}`, `users/me`). Plan at `~/.claude/plans/cheerful-soaring-matsumoto.md`. **Still open:** `projects/share` POST route test (deferred — same `resolveBriefRole`/role logic covered elsewhere); `copy.ts` unused-key deletion (deferred as regression-prone — verify each key with grep first); remaining untested routes (`files/*`, `auth/passcode`, `interest`, `users`, `approved-emails`).
9. **#31 — Agent kickoff on session open — SHIPPED to prod (PR #53, `1a0e7bc`, 2026-06-08).** `POST /api/chat/kickoff` greets returning makers by name on open (typing indicator + recap) so #26/#27 fire without the maker typing first. Scope locked: **returning-after-a-break only** (`lib/agent/kickoff.ts` `shouldKickoff` — prior maker history + ≥1hr gap; fresh sessions skipped so the welcome isn't double-greeted). Identity-aware in multi-human briefs (names the opener = authenticated caller). Reload/multi-tab loop guarded by `last_kickoff_at` on the session (refuse once greeted until the maker speaks). Client wiring in `MakerChat` (sessionStorage lock) + `useStreamingChat.kickoff()`. Verified on preview with the backdated cast (`scripts/backdate-cast-session.mjs` primes a stale session). **Bundled in the same PR:** first-name address polish ("Mara" not "Mara O"); per-participant chat-bubble colors; self-explaining "Needs setup" badge (`components/ui/TurnBadge.tsx` hover/click popover + `copy.glossary.needsSetup.detail/.todo`); user menu (email+sign out) on the maker chat header.
10. **#21 reminder copy.** Rethink reminder/nudge copy + numbering + UI placement. (#25 auto-progress after JSON import SHIPPED 2026-06-13, PR #55.) 'Waiting on {maker}' card placement already in place at `BuilderProjectView.tsx` (`RenudgeCard`).
13. **#56 — account identity in top nav + nameable accounts — SHIPPED to prod (PR #58, `a0165b8`, 2026-06-13).** `UserMenu` now renders an identity pill (`account_label ?? first_name ?? email-prefix`) instead of a bare icon — shows everywhere `UserMenu` appears (main nav + maker header). New self-assigned `account_label` on the `users` doc, editable inline in the user-menu dropdown (any user, not just admin). `PATCH /api/users/me` is now a **partial update** (any subset of `{first_name, last_name, account_label}`; label edit skips the requester-name sync). `account_label` flows `CachedUserData`→GET→`CurrentUser`. Preview-verified (all 5 steps).
14. **#44 — dashboard restructure by role/turn-state — SHIPPED to prod (PR #60, `f0a86fc`, 2026-06-14).** Sectioned dashboard: pinned amber "Awaiting you" + Yours/Reviewing/Contributing + collapsed Done; `lib/dashboard/group-briefs.ts` (pure, TDD) + `shouldFlatten` low-N fallback; Phase 0 threaded `viewer_brief_role` (fixes Contributor-as-Originator) + `state` on `getTurnIndicator`. **Follow-on SHIPPED — per-viewer brief archiving + collapsible sections (PR #64, `eda1151`):** `archived_at` on `project_members` → `viewer_archived` through both GET list paths (admin branch needed a separate fix, caught via Playwright); `PATCH /api/projects/archive` (self-service); `archived` bucket (wins over Done; forces sectioned view); all sections collapsible w/ localStorage-persisted state. Filter/sort still deferred (Backlog).
11. **Productionize `/api/chat` — first slice SHIPPED to prod (PR #59, `9de605a`, 2026-06-13).** `POST` is now a thin wrapper around `handleChat()`: unexpected throws → JSON 500 envelope + `chat_request_error` log (message+stack); malformed body → JSON 400; all error paths via a `jsonError()` helper (never HTML). Client reads errors via `errorMessageFromResponse()` (`lib/hooks/chat-error.ts`, dependency-free + unit-tested) which tolerates non-JSON bodies. +6 tests, 633 green. **Remaining (optional):** thread session_id/project_id into the top-level catch log (stream path already has rich context).
12. **Resend inbound — manual setup, then PR 3.** Webhook handler shipped at `app/api/webhooks/resend/inbound/route.ts` (`1799395`). Remaining: Resend dashboard inbound config on `inbox.ibuild4you.com`, MX records, `RESEND_INBOUND_SECRET` on Vercel (punch list at `docs/feedback-replies-plan.md`). Then PR 3 swaps `Reply-To: noreply@` (currently hardcoded at `lib/email/send-reminder.ts:27`) for per-session `reply+{signed_token}@inbox.ibuild4you.com` so maker email replies post as messages. **Note:** the `inbox.` subdomain MX points at Resend independently of any apex catch-all (item 5).
16. **Matt/BySide maker feedback — #69/#74/#75/#70 all SHIPPED to prod (2026-06-15).** **#70 SHIPPED (PR #76, `672303f`):** welcome-replay fixed — `app/api/sessions/route.ts` inserts the canned `welcome_message` only on the project's first session; return sessions start empty and the kickoff recaps (`lib/agent/kickoff.ts` + kickoff route now judge prior maker history at the **project** level). Playwright-verified on preview. (#69/#74/#75 shipped earlier same day.) **#71 SHIPPED** (PR #85 `956e028` MVP — locked decisions as durable constraints via a code-side merge in `regenerateBriefForProject`; + PR #91 `1ff3b64` locked-first UX). **#72 slice A SHIPPED** (PR #86 `472c370`): recent Loop `feedback` rows fed into the agent system prompt (`lib/agent/prototype-feedback.ts`); remaining slices (richer prototype perception, NOT headless browsing) still open on #72.

17. **🔥 Brief-regen cost runaway — FIXED (PR #78, `f1b8177`, 2026-06-15). Keep this operational knowledge.** `/api/cron/notify`'s idle-brief-regen retried one permanently-failing brief every 5-min tick (~$8.4/day; diagnosed via the **`api_usage`** Firestore collection — query by `route='brief.generate'`). Root causes: a brief whose `update_brief` payload exceeds `BRIEF_MAX_TOKENS` always throws `max_tokens`, and the circuit breaker cleared the counter on a new maker message but kept the **stale** `brief_regen_failures_since`, so it cleared-and-retried (billing Sonnet) forever. Fix: pure tested gate `lib/api/brief-regen-gate.ts` (a maker msg newer than the streak resets it; a fresh failure re-anchors `failures_since` to now → trips after 3 and HOLDS); `BRIEF_MAX_TOKENS` 2048→8192; cron skips briefs every member archived. Emergency stop: `scripts/stop-regen-loop.mjs <projectId> --apply`. **If costs spike again: query `api_usage` grouped by route+project, look for a project stuck at the cron interval.**
18. **Builder Setup dispatch card — SHIPPED to prod (PR #82, `56b001e`, 2026-06-17/18).** Slice 1: one-click dispatch card (create session + email maker in one click) + dev/preview email gating. **Slice 2:** one eager Sonnet "prep" call (`lib/agent/prep-outbound.ts`, `POST /api/projects/[id]/prep/generate`) drafts BOTH the maker nudge body + a one-line builder focus summary; fired on card mount + after save; idempotent via `prepConfigHash` (cost guard); stores `prep_nudge`/`prep_focus`/`prep_config_hash` on project; nudge precedence override > prep > template; silent template fallback. `copy.nudge.bodyText` (link-free). 734 green. House tone locked ([[feedback_outbound_tone]]). **Remaining:** voice_sample as per-brief override layered on later.
19. **🎨 Brief/Setup UX scrub — Phases 1/2/3/4 ALL SHIPPED to prod; core scrub complete.** Full plan: `docs/ux-scrub-brief-setup.md`. **P1 (PR #92, `d5f9eca`):** killed Setup config duplication — `EditableSetup`→collapsible `AgentConfigCard`. **P2 (PR #93, `fc32a9c`):** nav → **Brief · Conversations · People** (`TabId='brief'|'conversations'|'people'`); `ConversationsTab` pins "Next round" atop past convos; `PeopleTab` roster; Files fold into Brief as Attachments; legacy `?tab=` remaps. **P3 (PR #95, `10cebd0`):** brief-as-document editor — `components/builder/BriefEditor.tsx`, structured view (fields + list editors + inline 🔒 lock toggle on decisions) ⇄ raw-JSON view (the ferry paste target/source) over one `BriefContent`, one Save; tested validator `lib/api/brief-json.ts` (11 tests); two generate buttons → one "Update from conversation (uses API)" behind a confirm (offers copy-first); full-payload import demoted to a disclosure; dead `BriefView` removed. **P3 read-first follow-up (PR #96, `0f46c84`, Nico feedback):** the editor was always-in-edit (a wall of inputs); now the Brief tab is **read-first** — a calm `BriefReadView` document by default + an "Edit brief" pencil; edit is an explicit mode (Save persists & returns to read, Cancel discards & returns; regen/import drops back to read); loading shows a skeleton, empty shows "Add brief details". **Decisions:** overwrite-with-confirm (not field-merge — prose can't auto-merge, careful merge belongs on the Max-sub ferry); locked editable in structured view (friction = understanding, not JSON syntax). **P4 bug (PR #94, `d1a6ddb`):** established-maker share modal → access-only "Maker access" view, not first-time invite copy. **Remaining tail (small/optional):** github_repo final "Brief settings" home (parked in AgentConfigCard Advanced); voice_sample per-brief override. Filed **#83** (artifacts), **#84** (MCP authoring bridge). Re-scoped during resync: **#12** (edit requester email — server allows PATCH, only UI missing), **#16** (retire destructive delete now archive exists), **#23** (Files tab gone → fold into Brief/#83).
20. **🎨 Mode system + session cost — both SHIPPED, 2026-06-20.** Spec: `docs/mode-system.md`. **Mode P1 (PR #89, `62f18d7`):** per-brief role glyphs (studio family 🎤 Originator / 🎸 Contributor / 🎛️ Reviewer) + `resolveMode` (`lib/roles/mode.ts`) + dashboard glyph — signals a viewer's *per-brief* role (roles are per-brief, not per-user). **Session cost (PR #88, `85bd72b`):** per-session `token_cost_usd` shown as `· ~$X` next to the token count (`BuilderProjectView.tsx`), accumulated from FULL usage incl. cache via tested `lib/observability/session-cost.ts` (accurate even though stored `token_usage_input` is the uncached remainder). Two channels stay **never merged**: brief identity (color+code+glyph = which brief, viewer-independent, on OG) vs mode (your relationship). NOT card-bg/hatch (a11y + conflicts with identity). **Deferred (P2/P3):** dramatic participant/operator chrome divergence (conversation vs **Console** + `UserMenu` dark variant — the one cross-boundary coupling); OG/SVG glyphs + future roles (🎧 observer / 🎬 approver). Cost validation: `token_cost_usd` == sum(`api_usage.cost_usd` per session) vs Console.
15. **Feedback batch (#65-68) — ALL SHIPPED.** Phase-0 sweep #66/#67/#68 (PR #77, `ebe9af2`); **#65 cross-brief notification digest SHIPPED to prod (PR #80, `e500943`, 2026-06-17).** The bug was 4 emails for one conversation (the `*/5` `/api/cron/notify` sent one email per brief per maker-activity burst). Fix: pure `buildDigest()` in `lib/api/notify-digest.ts` (TDD) + new daily `app/api/cron/notify-digest/route.ts` (15:00 UTC in `vercel.json`) that queries projects with `notify_pending_since` set (`where('notify_pending_since','>','')` — excludes null/missing), sends ONE email listing all pending briefs, clears markers in a batch only after a successful send; `/api/cron/notify` keeps only idle brief-regen (email half removed). Recipient still hardcoded `NOTIFICATION_EMAILS` (slice 1, zero migration). Verified live via prod cron (`sent/checked/briefs` JSON). Per-recipient routing + "notify until seen" (needs a builder-viewed signal) deferred. **Filed #81** — Setup→People can't re-copy a member's invite link/passcode after the initial invite (the gap that nearly handed Scott someone else's creds; `/api/auth/passcode` matches email AND passcode together, so each participant needs their own membership row + passcode). **Side track (not a repo issue): cross-domain usage analytics** — Cloudflare Web Analytics on all zones; PostHog later only where "who"/retention matters.

## Recent context

Full dated history: `docs/changelog.md`. Most recent below.

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
