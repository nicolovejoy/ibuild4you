# CLAUDE.md

Guidance for Claude Code in this repository. Reference detail lives in `docs/`; read the named file before working in that area.

## What This Is

iBuild4you.com — an AI-powered project intake system. A conversational agent (Sam) guides a non-technical maker through discovery and keeps a structured "living brief" across sessions. Builders review briefs and annotate them; those annotations inform the agent's next session.

Roles: **requester / maker** (has the idea, chats with the agent), **agent** (converses, extracts structure, keeps the brief), **builder** (reviews briefs on a dashboard, annotates).

MVP: conversational intake → living brief → builder review → next session picks up where it left off. Not in MVP: process flow diagrams, data architecture drafts, microservice sketches, comparable app analysis, whiteboard UI mockups.

## Stack

- Next.js App Router on Vercel
- Firestore (`ibuild4you-a0c4d` Firebase project) — all DB access through API routes using Firebase Admin SDK, never from client components
- Firebase Auth with Google OAuth + email/password login (passcodes are retired; `/api/auth/passcode` answers 410)
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
- `lib/s3/` — S3 client for file storage (`ibuild4you-files` bucket)
- `lib/api/` — Server-side auth helpers (`getAuthenticatedUser`, `requireAdmin`)
- `lib/hooks/`, `lib/query/`, `lib/types/` — React hooks, React Query config and hooks, entity types
- `lib/copy.ts` — All user-facing text centralized in one file
- `lib/agent/` — Agent system prompt, prep prompt, welcome message generator, constants
- `components/ui/` — Reusable UI primitives; `components/builder/` — builder project view (Brief, Conversations, Settings tabs); `components/maker/` — maker project view (chat, brief card)
- `lib/email-in/` + `app/api/webhooks/resend/inbound/` — project email (email-in): the address, the sender check, the store and the new-text filter. Runbook: `docs/runbooks.md`, "Project email"
- `lib/integration/` + `app/api/integrations/` — stars-demo round-two integration
- **Loop** — the feedback mechanism: a widget embedded on host apps → `/api/feedback` → admin inbox at `/admin/feedback` (per-app at `/admin/apps/<slug>`) → optional GitHub issue. Overview and how to embed: `docs/loop.md`. Wire contract: `lib/feedback/README.md`.

Key pattern: clients call `apiFetch()` which attaches the Firebase Bearer token. API routes call `getAuthenticatedUser(request)` to verify the token server-side before accessing Firestore via `getAdminDb()`.

## Data Model

One line per collection. Fields, limits and history are in `docs/data-model.md`; read it before changing a collection.

- **users** — identity, auto-populated from Google sign-in
- **approved_emails** — per-email approval. Not the sign-in gate (Garm is), but an input to the Garm grant
- **project_members** — roles owner, builder, apprentice, maker. Nobody can edit their own row
- **projects** — one per maker engagement: agent config, requester, tracking fields, `maker_waiting_since`, `thumbs_down_count`
- **sessions** — one conversation between maker and agent; snapshots agent config at creation
- **messages** — role (user/agent), timestamp, optional `file_ids`, `kind`, and the maker's `rating`
- **files** — metadata in Firestore, bytes in S3
- **briefs** — the living brief, versioned (`briefs/{id}/versions`), with `briefs/{id}/notes`: one short note per conversation stretch, folded in at the next curated paste. The app does not rewrite the brief after a conversation; the comms agent curates it at each paste
- **project_emails** — mail members sent to a project's email address; the note writer reads it with the chat. The address never sends
- **reviews** — builder annotations on a brief
- **apps**, **loop_read_keys**, `loop_signing_secrets` — Loop host apps and their keys. App admins live only in Garm
- **build_status_keys**, **projects/{id}/build_reports** — the per-repo key and the status reports Claude Code posts from a build repo
- **garm_denials** — counts-only sign-in denials, no addresses
- **integration_groups / _participants / _messages / _ops** — stars-demo round two, server-to-server only, kept apart from `messages` on purpose

## Project Setup JSON

Projects are created by JSON (`POST /api/projects`, only `title` required; the dashboard's "Import JSON" tab takes the same payload) and updated by `PATCH /api/projects` (a fixed field list). The full schema, participants, `language`, `model`, locked and contested decisions, decision provenance and open-risk owners are in `docs/project-setup-json.md`. Read it before touching payloads, locks or `PUT /api/briefs`.

Rules to keep in view:
- A stamped ferry-desk paste cannot drop, reword or unlock a locked decision; the server restores locks (`restoreLocksOnPaste`).
- Code stamps decision provenance and never trusts the model's.
- `seed_questions` reach the agent only in `discover` mode and `builder_directives` only in `converge`. Guardrails for every session go in `context`.
- The brief stays in English whatever the maker's `language`.

## Agent Behavior Rules

- Neutral, non-opinionated tone; slightly mirrors the maker's writing style
- Plain language only — never UX jargon like "user journeys" or "microservices"
- Early sessions: broad discovery. Later sessions: more specific as the brief fills in
- At natural checkpoints, summarize back for validation ("So you want X and Y but not Z, right?")
- Sam asks the maker about maker-owned open risks when it fits, and does not push them on builder-owned ones
- The system prompt carries the living brief, builder annotations, prior session history and the notes not yet folded into the brief
- Owners and builders can write in the conversation; their messages are labelled Builder, as guidance rather than the maker's own words
- A conversation opens with the builder's `welcome_message` word for word when it is new for this round. Otherwise, on session 2+, the agent greets through kickoff (maker-only), or posts a canned "nothing queued yet" note when no paste is queued

The full rules, including who speaks first: `docs/agent-behavior.md`. Read it before changing chat, kickoff or welcome code.

## Testing & Deployment

- **Preview**: `preview.ibuild4you.com` follows the `preview` git branch. To put a feature branch there: `git push origin <branch>:preview --force` (Vercel rebuilds in 1–2 min).
- Risky changes ship by PR and a preview test. Trivial or doc-only changes can go direct to main.
- **CI/CD**: GitHub Actions runs `type-check`, `lint`, `build`, `test` on PRs and pushes to main. Vercel deploys (preview per branch, prod on main).
- **TDD when possible**: write tests before implementation. Skip only when it does not fit (pure UI layout, exploratory prototyping).
- **Agent-driven e2e**: headless Playwright through `scripts/lib/preview-login.mjs` (`launchLoggedIn()`, password login; Playwright cannot drive Google). It needs the gitignored `.ibuild4you-bypass` and `.test-admin-password`. The test admin resolves to `owner`, so maker-only behaviour (the kickoff greeting) needs a test-cast identity. Setup, overrides and rebuilding on a new machine: `docs/runbooks.md`.

## Code Style

Clarity over cleverness: clear and straightforward code, no clever abstractions, comments where it is not obvious, NoteMaxxing patterns.

## Next Steps

> Shipped history lives in `docs/changelog.md` (newest first). **Prepend an entry there at session end**; `/handoff` does not touch docs. This section is live work only. Backlog: `gh issue list --state open`.

**Watch.**
- Notes after PR #267 (merged 2026-11-18): on the next few F4FC notes, a half-answered risk should be settled with its answer plus one new risk for what is left, and no topic should be a risk's text. The comms agent was to give the "Builder placeholders to react to…" decision a short topic at its next paste.
- The F4FC brief (Danny's, slug `l6-shapes-positions-game` since a title change; checked 2026-11-27) was rewritten to fit: 17,788 characters at v62 (seen in the prep of 2026-11-21), under the 20,000 budget but close. v63 (paste of 2026-11-22) grew from 23,014 to 26,492 characters as `inspect-brief-health` counts them, which suggests about 20,500 by the prep's count: possibly over budget again. Read the size line in the next prep.
- Project 4 in real use (PR #268): the compaction is done (v62), so the next F4FC paste is the first real `brief_patch`. Check that the comms agent sends a patch, that the line under the paste box matches what it meant, and that nothing is refused for a drop text that does not match.
- Prep session count (PR #270, merged 2026-11-21): the next F4FC prep should say `Sessions so far:` with the real number, or leave the line out. It said 0 on 2026-11-21; the fix covers the one code path that turns an unknown count into 0, and that path was not confirmed as the cause. If it says 0 again, the sessions endpoint is returning an empty list.
- Test steps in build reports (PR #275, merged 2026-11-21): a live item can carry `try_it`. Watch for the first real report with one (l6-music was told by handoff note) and that the next prep's welcome bases its test steps on it.
- Loop states (#281, Nico, 2026-11-22): a full design session on what a feedback item's states mean and how items are managed over time, before any change. It takes in #278. Branch `loop-status-promises` (pushed, no PR) holds one possible answer to #278: `acknowledged` promises nothing and `in_progress` needs a GitHub issue. The session also covers a way to pick out and clear an admin's own test items (bulk archive and delete already exist in the inbox).
- Import with a moved brief (PR #280, merged 2026-11-22): on the next stale paste, the line under the box should say the brief moved and to re-copy the prep, the preview should say the changes were not evaluated, and Import should give the "out of date" dialog and not a list of failed drops.
- Note names and empty notes (#276): merged as PR #288 on 2026-11-23. On production: the next email-only note should be headed "Email of …", a note from chat plus email "Conversation and email of …", and a stretch of pleasantries should write no note and leave a `brief.note_empty` line in `vercel logs -e production --since 1h -n 2000 --json`. If a "nothing relevant" sentence still arrives as a note, either the model returned `nothing_new: false`, or it returned `true` with a decision or risk (code keeps the text then); for the first case the next step is a stronger prompt example, not a text match in code. Plan: `docs/superpowers/plans/2026-11-23-note-names-and-empty-notes.md` (Verification).
- Welcome bugs and the reminder line (PR #292, merged 2026-11-23): on the next real import into a conversation the maker has not answered, the transcript should hold one welcome, the header should offer Nudge with no Start window opening, and the strip should say when the next automatic reminder is due. Beside Nudge, a reminder from before the merge reads "Reminder recorded … The app did not save whether it was emailed or copied."; from the next one on it names the method and the address. The maker chat's live updates changed too (`useRealtimeMessages` skips local-cache snapshots): if a maker reports replies not appearing until a reload, look there first.
- Welcome follow-ups and access fixes (PR #294, merged 2026-11-24; closed #293 and #291): the slug lookup now answers 404 to a signed-in non-member where it answered 200 with the project document, and the list leaves out briefs a member was removed from. On the next F4FC paste the `apply_import` log line should carry `welcome_posted` with no `apply_import_failed` (the import now runs in a transaction). If a member reports a brief gone from their dashboard, look at `removed_at` on their `project_members` row first. #295 and #296 are fixed (PR #297).
- Stacked modals and the headless pass (PR #299, merged 2026-11-24): the paste status line's three states, the 409 for inviting a removed member and six modal screens were all seen on preview (`scripts/e2e-loose-ends-298.mjs`). The refused invite that showed its message about 1.3 seconds late is fixed (PR #300): the invite, maker email, new brief and new conversation hooks no longer retry. No other hook was changed, so a slow refusal anywhere else is probably the same cause (the mutation default `retry: 1`). If CI fails at the build step with a `next/font` error in `app/layout.tsx`, it is a failed Google font fetch: rerun the job.
- Invitation draft (PR #301, merged 2026-11-27): the next prep on any brief redrafts its invitation (the prompt is in the cache key). On the next one sent, check that it is two sentences, names the maker's page from the brief title, and has no time estimate or "whenever". New rules go in `lib/agent/outbound-rules.ts`. To read drafts before a change ships: `scripts/eval-prep-draft.ts`.

**Merged 2026-11-23, built by Sonnet with Opus review: PRs #288 (#276), #289 (#287), #290 (#284).** Nico ruled the modal close label fine as it is ("Fermer" for a builder on a French brief with no saved language preference). Five of the seven modal screens left unchecked were checked headless on 2026-11-24 (PR #299). Left for Nico's eye: the stored-email viewer and the file preview. This way of working (Opus plans and reviews, Sonnet implements, the session model only briefs and gates) is the default for the next SDD task; it built Project 5 (PR #292) the same day. A headless preview pass after the last fix is part of it: #292's stale-header defect passed its unit test and failed only in a real browser.

**Builder Settings tab and restyle: PRs #273 and #274 merged 2026-11-21.** Jumped the queue at Nico's call. #273 is the structure (three tabs, Settings with People on it, a read-only Next round panel on Conversations, per-round fields no longer editable). #274 is the look from the mock (https://claude.ai/artifact/XZFoRuvdy2L6r7yt8rV3xV): indigo rail with the brief title in it, ivory ground, Montserrat headings, warm lines, on all three builder tabs. Left for Nico's eye, since the e2e brief is empty: a filled brief in the editor, the People roster with real members, the build status key and project email panels open in Connections, and a long transcript. Open from the mock, not built: switches in place of the two Sam checkboxes, and the help text under the Sam controls is still cool grey. The Next round panel is the first half of relay project 5 (payload status), placed on Conversations instead of Brief.

**Queue.** Relay efficiency, six projects (spec `docs/superpowers/specs/2026-11-15-relay-efficiency-design.md`). Done: project 1 (PRs #261, #262), project 2 (l6-music #224), project 3 (PR #263), the return leg (PR #266), project 4, payload as changes (PR #268, `brief_patch`), and test steps in build reports (PR #275). Remaining, in order:
- byside and prntd move their reader registration to the launcher (`scripts/brief-reader.mjs`). Scoped 2026-11-24: one edit to `.mcp.json` in each repo, to the form l6-music has. Edited in both working trees on 2026-11-24 and left uncommitted at Nico's word; each repo's next session commits it (notes in `~/src/.handoff/ibuild4you-byside.md` and `ibuild4you-prntd.md`, both new channels). Not tested: nobody has run `--check` for either repo since the edit.
- Project 5 is done: the two traced bugs (PR #292, follow-ups in PR #294), the Next round panel (PR #273) and the paste status line on the Brief tab (PR #298, merged 2026-11-24).
- Project 6: Nico's call on reopening #217.

**Project email address (email-in), PR #269: production smoke closed by Nico on 2026-11-23.** Spec `docs/superpowers/specs/2026-11-19-project-email-in-design.md` (with an amendment note: three departures made while building, confirmed by Nico on 2026-11-24); plan and every ruling `docs/superpowers/plans/2026-11-19-project-email-in.md`, "Progress and rulings"; known limits: `docs/runbooks.md`, "Project email". Passed on the throwaway project "Email-in smoke test": steps 1, 2, 3, 5 and 6, and on 2026-11-23, in the stored-email viewer, the step 4 email (quoted lines credited to the maker by name), a real Yahoo reply (the builder's question credited to him under the maker's answer) and a Yahoo forward of an outsider's email (the forwarded words headed as not a project member). Not run: the inline reply under one line of a maker email (Nico called the smoke done before it), and nobody read the notes written from the reply and the forward (the logs show three `email_in_accepted` and one `brief.note` that afternoon; the "Email of …" heading and the maker-owned risk for the outsider's words were not looked at). The "Email-in smoke test" project is deleted and Nico confirmed the three departures (both 2026-11-24). MusicForge (brief `bill-duris-musicforge-feedback`) is in real use since 2026-11-23: three emails from Bill read and two notes written by 2026-11-24. Nico's test on 2026-11-24: mail from his Gmail address is dropped as `not_member`, mail from his me.com address (the one on the brief) is stored, as designed. The three earlier drops on that brief (2026-11-22 and 23) were probably his Gmail sends too (the logs hold no address), and one is confirmed: a quote in Bill's reply, timed to the minute of a drop, is credited in the viewer as "Nicholas Lovejoy, not a project member". So the note writer reads Nico's Gmail-sent questions as an outsider's words; the first note of 2026-11-23 called Bill's JSON check result "likely a builder-side test artefact" for that reason. Nico's ruling (2026-11-24): he writes to makers from me.com only; no alias feature. Seen on 2026-11-24: both notes ("Email of Nov 23" correct, with a builder-owned risk; "Conversation and email of Nov 23", whose chat half was not checked), the viewer on a reply with a quote, and a forward whose lines were all already held. Not explained: where the lines of his original email of 2026-11-22 were held from. Not seen: an inline reply under one line of a maker email. To read the logs: `vercel logs -e production --since 1h -n 2000 --json` and filter for `email_in_` and `brief.note`.

Also queued (Nico, 2026-11-10): a phased plan for the rest of the home-page work, parked under "Later" in `docs/superpowers/plans/2026-11-09-home-page-mocks.md`: the shipped-work grid below the hero (client OK per tile, public counts-only endpoint), Danny's L6 quote (approved text in `~/src/selected-projects/content/projects/l6-music.mdx`, "— Danny, piano teacher, November 2026"; the shorter cut is in `ibuild4you.mdx` there), the Tideline real-conversation variant (gated on the maker's OK), and whether the signed-in dashboard and maker chat get a redesign beyond the palette.

## Gotchas and runbooks

**🔴 `npm run type-check` is NOT equivalent to `npm run build` in a worktree.** `type-check` is `tsc --noEmit`, and tsconfig includes `.next/types/**/*.ts` — absent in a fresh worktree, so Next's route-signature validation silently checks **nothing** (a branch with `export const` in a `route.ts` passed three reviews this way). **In a worktree, run BOTH `npm run build` AND `npm run type-check` before claiming clean**: `build` skips test files (a badly typed test mock passes `build` and fails CI's `tsc`, PR #176); `type-check` skips route-export validation without `.next/types`. Either alone is a false green.

The rest is in `docs/runbooks.md`. Read the matching section before working in that area:
- Note-writer cost runaway (how to find it, the emergency stop script)
- Garm (false denials, aliasing, the listing contract, the Loop admin check)
- Brief reader for build repos (launcher, `--check`, `post_build_status`, the 1Password items)
- Prod diagnostics, email links, stars-demo, monitoring
- Preview gotchas and the agent-driven e2e harness

Rules to keep in view:
- Garm is the fail-closed sign-in gate, with no env-var escape hatch. Never fix an aliasing case by adding a second `project_members` row.
- A route that fails soft cannot be verified by its status code. Grep `vercel logs <deployment> --expand` for the `*_failed` event.
- UptimeRobot watches `/api/health`. Do not add a cron workflow for it.

## Env vars

What each one does, where its value lives in 1Password and what happens when it is unset: `docs/env-vars.md`. Read it before adding, changing or debugging one.

Names: `CRON_SECRET`, `ANTHROPIC_API_KEY`, `CHAT_MODEL` (optional), `RESEND_API_KEY`, `RESEND_INBOUND_SECRET`, `RESEND_INBOUND_FETCH_URL` (optional), `FEEDBACK_INBOX_HOST` (optional), `FEEDBACK_NOTIFY_SUPPRESS`, `GITHUB_TOKEN`, `GARM_URL`, `GARM_KEY`, `GARM_ADMIN_KEY`, `GARM_LOOP_KEY`, `GARM_DUAL_WRITE`, `LOOP_SENDER_TAG_SECRET`, `STARS_INTEGRATION_SECRET`.

Rules to keep in view:
- Never set `GARM_LOOP_KEY` on Preview. Garm has no preview instance, so preview would change real production apps and grants.
- `FEEDBACK_NOTIFY_SUPPRESS=on` is set on Preview on purpose, and never on prod.
- `GARM_URL` or `GARM_KEY` unset means sign-in denies. `GARM_DUAL_WRITE` must be exactly `on`.
- A model id in `CHAT_MODEL` needs a row in `lib/observability/anthropic-pricing.ts`, or every call logs `$0`.

<!-- SHARED-CONVENTIONS:BEGIN v=c254cba18982 — auto-managed, do not edit here; source: prompt-lab/workflow/claude-md-shared.md (edit + re-sync) -->
## Shared conventions

<!-- These are Nico's cross-repo output rules. They're materialized into each repo's
CLAUDE.md so every agent (local, cloud, headless) sees them as plain text. Source of
truth: prompt-lab/workflow/claude-md-shared.md — edit there and re-sync, never here. -->

- **Clickable URLs.** When pointing at any web destination (dashboard, repo, PR, deploy, settings, docs, localhost), print the full bare URL — `https://example.com` or `http://localhost:8080` — on its own, never just the page's name and never a markdown `[label](url)` link. Nico's terminal auto-linkifies raw `https://` text, so a bare URL is one-click and stays copyable.

- **Number your questions.** Any time you ask Nico more than one question, present them as a numbered list (1., 2., 3.) so he can answer by number with no ambiguity. A single standalone question needs no number.

- **Never ask Nico to recall a past moment.** No "think of the last time X happened", "walk me through the last time…", or any question he can only answer by remembering an event. Look the history up yourself (the prompt-history DB, git, logs, the data), then propose something concrete for him to react to, or ask directly what he wants. This overrides the brainstorming skill's "walk me through the last time" question style (Nico, 2026-11-03).

- **Self-contained smoke-test instructions.** When you ask Nico to manually test or verify an app or website, assume zero carried-over context — he should never scroll back or recall a URL/path/credential from earlier. Always include: the exact URL (full `https://…` or `http://localhost:…`, restated even if mentioned above), the precise steps in order, and what a pass vs. fail looks like. Repetition here is a feature, not clutter.

- **UTC at rest, Pacific on display.** Timestamps are stored in UTC, always. A *calendar day* shown to a human is `America/Los_Angeles` — Nico's day, and the clock the work actually happened on. The two rules that follow are the ones that get broken: never form a date bucket with `new Date(…).toISOString().slice(0,10)` (that is UTC, so every chart axis and "today" silently rolls over at 5pm Pacific — it put a phantom tomorrow bar on the Prompt Lab dashboard), and never bucket UTC-stamped rows with a bare `date(col)` in SQL. Use `Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles' })` in JS and an explicit zone in SQL/Python. Storage in local time is also wrong — it can't be migrated across a DST boundary without loss.

- **No marker before a copy-paste command block.** Nico's terminal renders markdown bullets (`-`, `*`, `•`) as `●`, which breaks paste into zsh. The line directly above a fenced command block must be a plain-text label ending in a colon — never a bullet, dash, asterisk, or number. For loud copy targets, lead the label with `📋` + bold `COPY THE BELOW`, then a colon, then the block. Bracket anything Nico will paste elsewhere (a prompt for another agent, a multi-line command) with a ruler line of `================` above the label and below the closing fence. Rulers go outside the fence so they aren't copied, each with a blank line before it (a `===` line directly under text renders as a heading).

- **No bare backslash in a copy-paste command block.** A `\` is load-bearing shell syntax that renders invisibly and gets silently dropped somewhere between the markdown render, the clipboard, and zsh. `find … -exec test -e {} \; -delete` arrived in the terminal as `… {} ; -delete`, which zsh split into two commands and reported as `find: -exec: no terminating ";"` plus `command not found: -delete` (2026-09-20). Quote it instead — `';'` is exactly equivalent to `\;` and survives any copy path. For the same reason never break a command across lines with a trailing `\`: write one long line, however wide it wraps.

- **Reader-facing text lives in content or copy files, not inline in components.** Some repos ship French alongside English (selected-projects mirrors the site under `/fr`; ibuild4you has French public pages). There, every new string goes in the repo's strings/copy module or content folder, with its translation, and an English copy edit means updating the French twin too. Elsewhere, keeping text out of components is what makes `/localize` cheap later. Terms and register: `prompt-lab/workflow/localization/fr-glossary.md`.

- **A review another agent must act on goes on the PR.** A review that another agent must act on, or that must outlive the session, is posted as a PR comment (`gh pr comment`), where the next session or agent finds it. Live, in-session reviews between Nico and the agent stay in chat. There is no devlog.md: the history DB is the one session record.

- **Browser testing runs headless.** A headed browser takes focus on Nico's Mac. Run Playwright headless, with Edge (`channel: 'msedge'`) for desktop runs wherever a config picks a browser. Never use `headless: false`, `--headed`, `--debug`, `--ui` or `PWDEBUG` unless Nico asks for it in this session. For a visual check, take a screenshot or record a trace (`trace: 'on-first-retry'` or `'on'`) instead of opening a window. The Claude-in-Chrome extension is the one thing that drives Nico's real Chrome, on purpose.

- **WebKit test runs record no frames on a Mac.** While the display is asleep, macOS WindowServer keeps every captured window buffer until a display wakes, and at 65,536 it aborts and ends the login session (2026-11-09; https://github.com/microsoft/playwright/issues/43066). Playwright's WebKit trace screenshots and video capture 25 times a second. In any config with a WebKit project, set `screenshots: false` on the trace for local runs (`trace: { mode: 'retain-on-failure', screenshots: false }`, any mode) and leave video off; CI on Linux may keep them. With that set, `--trace on` stays safe. Plain `page.screenshot` is fine, and Edge and Chromium are unaffected. Do not use `caffeinate -d` for this: it cannot wake a sleeping display and has no time limit around a command. Healthy reading: `ioclasscount IOSurface` between 400 and 900.
<!-- SHARED-CONVENTIONS:END -->
