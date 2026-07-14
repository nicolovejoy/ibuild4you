# Maker-feedback build plan — #141 + #142 + #143

**Status: DECIDED — build from this.** Planned 2026-07-13 from real maker feedback (reminder-email noise, cross-brief amnesia) plus a feedback-email spec relayed from a host-app repo session. Three independent PRs, in this order. No PII in code/tests/issues — say "the maker", never names.

Prerequisites already done (2026-07-13): PRs #138 + #140 merged (#83 Phases A+B on main), preview re-synced to main, issues #141/#142/#143 filed.

---

## PR 1 — #141 maker reminder digest (cron-only)

**Problem.** `app/api/cron/maker-reminders/route.ts` decides and sends per-project. A maker on N briefs gets N near-identical emails in one cron pass. Real complaint from a maker on 4–5 briefs.

**Fix shape.** Two-pass cron: decide everything first, then group send-decisions by maker email (lowercased), send ONE email per maker.

**Scope guard.** Cron only. Manual builder-triggered nudges (`POST /api/projects/[id]/email`) are deliberate acts — untouched.

### Build steps (TDD)

1. **Pure grouping + copy** — new `lib/email/reminder-digest.ts`:
   - `groupReminderSends(items: PendingReminder[]): MakerBatch[]` — group by lowercased maker email; stable order (by project title).
   - `buildReminderEmail(batch: MakerBatch): { subject: string; text: string }`:
     - 1 brief → exactly today's copy (subject `Your conversation for "<title>" is ready`, body via `copy.nudge.reminder`) so single-brief behavior is byte-identical. Move the existing `buildSubject`/`buildBody` from `send-reminder.ts` here or delegate — don't duplicate.
     - 2+ briefs → subject `Your conversations are waiting (N briefs)`; body: greeting with first name (from any item that has one), then one line per brief: `- "<title>" — conversation #n: <shareLink>` (omit `#n` when sessionNumber null), then the shared sign-off. House tone: friendly, terse (see `feedback_outbound_tone` memory / copy.ts patterns).
   - Tests: grouping (case-insensitive email, ordering), 1-brief passthrough identical to current copy, 2-brief body contains both links, missing sessionNumber/firstName handled.

2. **Sender** — extend `lib/email/send-reminder.ts` with `sendReminderDigest(batch)` (same FROM/REPLY_TO/BCC + `REMINDER_DRY_RUN` handling), or generalize `sendReminderEmail` to take the prebuilt `{subject, text}`. Keep the dry-run JSON log shape, add `project_ids: string[]`.

3. **Cron route rewrite** — `app/api/cron/maker-reminders/route.ts`:
   - Pass 1 (unchanged logic): for each candidate run `decideReminder`; record skips/errors immediately as today.
   - Pass 2: group pending sends via `groupReminderSends`; per maker, send one email; on success advance **each** included project's counters (`reminders_sent_count+1`, `last_reminder_sent_at`) and write one `reminder_log` row **per project** (existing shape; same `email_id` across the batch — that's the batch marker; do NOT change the log schema, /admin/reminders reads it).
   - A failed batch send → every project in it records `decision: 'error'`, counters untouched.
   - Dry-run: one `would_send` log per project, counters untouched (existing invariant — dry-run never eats the 3-reminder budget).
   - Response summary unchanged in shape (`sent` = projects sent, add `emails` = distinct emails dispatched).
   - Update `app/api/cron/maker-reminders/__tests__/route.test.ts`: the key new case is 2 projects sharing a maker email → exactly 1 send call, both counters advanced, 2 log rows.

4. **Known limitation to note in code comment:** the cron reads `project.requester_email` only — additional makers on multi-maker briefs don't get cron reminders today. Out of scope here (that's the #115 fan-out surface); don't silently change targeting.

### Verify
- Unit: all above.
- Preview e2e: seed two briefs with the same maker email + `auto_reminders_enabled`, backdate `shared_at`, fire the deployed cron with `REMINDER_DRY_RUN=true`… **simpler**: cron can't be fired on preview without `CRON_SECRET` (Vercel-only — see `reference_vercel_only_secrets`). So: route-level test coverage + one manual prod observation on the next real cron pass (check `/admin/reminders` for shared `email_id`). Do NOT try to fire the cron locally.

---

## PR 2 — #142 cross-brief locked-decision sharing

**Problem.** Sibling briefs (same product, same `github_repo`) don't see each other's settled decisions. A maker had to correct the agent about a fee-split arrangement already locked in another brief; the agent could only say "I'll trust that."

**Fix shape.** Prompt-context only, modeled exactly on #83 Phase B's artifact-context pair (`lib/agent/artifact-context.ts` + `lib/api/artifact-context.ts`). No schema change, no brief merge, explicitly NOT #122 `inherits_from`.

### Build steps (TDD)

1. **Repo normalization in TS** — `normalizeRepo` exists only in `scripts/lib/brief-markdown.mjs` (bare / `owner/name` / URL forms). Port it to `lib/github/repo.ts` (or `lib/feedback/github.ts` if a helper already fits there) as a small pure `normalizeGithubRepo(raw): string` returning the bare `owner/name` (or lowercased bare name if no owner), + `reposMatch(a, b)`. Prod data really is messy: one project has `github_repo: "byside"`, siblings have `"nicolovejoy/byside"` — matching must treat those as one family (that is the live case that must work). Port the .mjs semantics verbatim; add matching tests.

2. **Pure selector/renderer** — `lib/agent/sibling-decisions.ts`:
   - `selectSiblingDecisions(siblings: { title: string; decisions: unknown[] }[]): SiblingDecision[]` — locked (`locked === true`) decisions only for v1 (keeps the block small and high-signal); skip malformed rows; cap total at 20 (locked-first ordering is moot since all are locked; order by sibling title).
   - `renderSiblingDecisionsBlock(items): string` — `## Decisions settled in related conversations` listing `**<topic>** — <decision> _(from "<brief title>")_`, followed by a guardrail paragraph: these were settled in other conversations on the same product; treat them as decided — don't re-open them or re-ask; if the maker says something that contradicts one, surface it and confirm explicitly before treating it as changed (mirrors the #71 locked-decision reconcile rule and the honesty style of `artifact-context.ts`).
   - Empty input → empty string.

3. **Fetch layer** — `lib/api/sibling-decisions.ts` `fetchSiblingDecisions(db, project): Promise<SiblingDecision[]>`:
   - No `github_repo` on the project → `[]`.
   - Firestore can't query normalized values, and repo strings are messy → fetch `projects` where `github_repo > ''` (single-field, no composite index; ~25 docs today) and filter in memory with `reposMatch`, excluding self by doc id.
   - For each sibling (cap at 8 siblings), fetch its brief (same lookup the chat route uses for the project's own brief — briefs are keyed/queried by project id; reuse the existing brief-fetch helper rather than re-deriving), collect locked decisions with the sibling's title.
   - Any failure → log + return `[]` (bonus context must never break chat — same posture as `fetchPinnedArtifacts`).

4. **Wire-in** — add `siblingDecisions` to `SystemPromptInput`; render the block in `buildSystemPrompt` (place it right after the brief content section, before builder directives — it qualifies the brief); call `fetchSiblingDecisions` in `/api/chat` and `/api/chat/kickoff` alongside `fetchPinnedArtifacts` (parallel `Promise.all` with the existing bonus-context fetches).

5. **Tests:** repo normalization matrix (incl. bare `byside` ↔ `nicolovejoy/byside`); selector (locked-only, cap, malformed rows); renderer (empty → '', guardrail text present); prompt wiring (block appears when provided, absent otherwise); fetch layer with mocked db (no-repo → [], sibling with locked decision → item, throw → []).

### Verify
- Preview e2e (`scripts/e2e-142-sibling-decisions.mjs`, use `scripts/lib/preview-login.mjs` `launchLoggedIn()`): seed two projects sharing a `github_repo`, brief A carrying a distinctive locked decision (fixture-safe wording, no UI keywords — see the #23a Playwright substring gotcha); open a maker chat on project B and ask about the topic; grade that the agent states the decision rather than asking about it. Poll the maker display-name gate in a loop (#39 gotcha; placeholder is literally "First name", button "Continue").

---

## PR 3 — #143 Loop feedback notification email

**Source.** Spec relayed from a host-app repo session; all five points accepted. Wire format the widget posts is FROZEN — email + inbox changes only. Current email builder is inline at `app/api/feedback/route.ts:209-228`.

### Build steps (TDD)

1. **Pure builder** — new `lib/feedback/notify-email.ts`:
   `buildFeedbackEmail(input: { type, projectTitle, body, submitterEmail, pageUrl, viewport, userAgent, feedbackId, burstIndex }): { subject, text }`
   - Subject: `[<type>] <projectTitle>: <snippet>` — snippet = first ~60 chars of the trimmed body, whitespace collapsed, `…` when truncated. No slug. When `burstIndex >= 2`, append ` · <n>th note this session` (use proper ordinals: 2nd, 3rd, 4th…).
   - Text, in order: note body; blank line; `Page: <url>` (the raw URL — plain-text mail clients linkify it; `n/a` when empty); `Review: https://ibuild4you.com/admin/feedback?focus=<feedbackId>`; blank line; `From: <email>` or `From: submitter not captured (widget not identity-aware yet)`; blank line; footer block:
     ```
     —
     viewport: <v> · ua: <ua>
     feedback id: <id>
     ```
   - Tests: subject truncation/ordinals/no-slug, body ordering, anonymous vs email submitter, footer contents, burstIndex 1 → no suffix.

2. **Burst counting** — in the route, after the project lookup, count recent feedback for the same project: query `feedback` where `project_id == projectId` (single-field, existing pattern used by the admin inbox), filter in memory to `created_at > now-15min`, `burstIndex = recentCount + 1`. In-memory filter avoids a new composite index; per-project volume is small. Counting failure → `burstIndex = 1` (never block the notification).

3. **Route swap** — replace the inline subject/text at `route.ts:209-228` with the builder. Everything else (Resend call, non-blocking try/catch, NOTIFICATION_EMAILS) unchanged. Update `app/api/feedback/__tests__/route.test.ts` for the new subject shape.

4. **Admin inbox `?focus=` support** — `app/admin/feedback/page.tsx` currently ignores query params. Add: read `focus` via `useSearchParams`; when set and the item is in the loaded list, scroll it into view + open/highlight it (whatever "expanded" already looks like there — reuse the existing selected/expanded state, don't invent a new one). If the item's status filter hides it (e.g. it's been triaged), fall back gracefully — no crash, no infinite effect loop. Note: `useSearchParams` needs a `<Suspense>` boundary in App Router pages — check whether the page already has one.

### Verify
- Unit tests above.
- Preview e2e: POST a real widget-shaped payload at the preview `/api/feedback` (honeypot `_ts` must be >2s old), then load `/admin/feedback?focus=<id>` logged in as test admin and grade the highlight. Email itself can't be observed on preview (RESEND_API_KEY is Vercel-only and BCC target bounces on preview) — the pure builder tests carry that.

### Build spec — fleshed out 2026-07-13 (post-recon, current line refs)

**Route recon (`app/api/feedback/route.ts`).** The inline email builder is now at **~208–231** (shifted from the 209–228 in the plan above; main advanced with #141/#142). Everything the pure builder needs is already in scope at that point:
- `type` (FeedbackType), `projectTitle` (line ~161), `projectId` (**the SLUG** — `feedback.project_id` is stored as the slug, line 170), `bodyRaw` (raw, use `.trim()`), `submitterEmail` (already lowercased+trimmed, `null` when anonymous), `pageUrl`, `viewport`, `userAgent` (all pre-sliced/clamped), `docRef.id` (= `feedbackId`), `now` (**ISO string** — `new Date().toISOString()`, line 168).
- So `buildFeedbackEmail({ type, projectTitle, body: bodyRaw, submitterEmail, pageUrl, viewport, userAgent, feedbackId: docRef.id, burstIndex })` — swap the inline `subject`/`text` (lines 215–227) for the builder's return. Resend call + non-blocking try/catch + `NOTIFICATION_EMAILS` unchanged.
- Anonymous line: current code prints `From: ${submitterEmail ?? 'anonymous'}`. Plan wants `From: submitter not captured (widget not identity-aware yet)` when null — put that in the builder.

**Burst counting.** Insert right after the projectTitle lookup (~line 161), before the notify block. Feedback docs carry `project_id` (slug) + `created_at` (ISO string), both single-field-queryable. `const cutoff = new Date(Date.now() - 15*60*1000).toISOString()`; query `feedback where project_id == projectId`, `.get()`, filter in memory `d.created_at > cutoff` (string compare is valid on ISO), `burstIndex = recentCount + 1` (the just-written doc is already in the collection, so +1 lands on 1 for a lone note, 2 for the first repeat, etc. — **verify** the just-added doc IS counted by the query; if `docRef.add` hasn't propagated to the query, compute `burstIndex = matchingOlderDocs + 1` instead — write the test to pin whichever it is). Wrap in try/catch → `burstIndex = 1` on any failure. No composite index (single-field `where`), matches the admin-inbox query pattern.

**Admin `?focus=` recon (`app/admin/feedback/page.tsx`).** Two things the plan didn't know:
1. **Cards are ALWAYS expanded.** `FeedbackRow` renders full detail unconditionally — there is **no** open/collapse or selected state to reuse. So `?focus=` means: **scroll the matching card into view + apply a transient highlight ring** (e.g. `ring-2 ring-brand-navy` for ~2.5s, then clear). Don't invent an "expanded" concept.
2. **No `<Suspense>` boundary exists.** The page is `'use client'` but `useSearchParams()` in App Router still needs a Suspense wrapper or the build errors. Plan: read `focus` inside a small child (or keep `FeedbackList` and wrap its render site), and wrap `<FeedbackList />` (line 62) in `<Suspense fallback={...}>`. Pass `focusId` → each `FeedbackRow`; when `item.id === focusId`, attach a ref + `scrollIntoView({ block: 'center' })` on mount + the ring, clearing via a `setTimeout`.
3. **Filter interplay.** Default inbox shows all statuses (`status=''`), but if the operator has a status filter active OR the item was triaged out of the loaded set, the focused id simply won't be in `items` → **no-op, no crash, no effect loop** (guard the effect on presence + a one-shot ran-ref so it can't re-fire). The email links with `?focus=` only; don't auto-change the status filter.

**Test file touchpoints:** new `lib/feedback/__tests__/notify-email.test.ts` (pure builder); update `app/api/feedback/__tests__/route.test.ts` for the new subject shape + a burst case (two posts <15min → burstIndex 2 / ordinal suffix). Admin page has no test today — the preview e2e carries the `?focus=` highlight.

---

## Leftovers checklist (small, fold into whichever PR is convenient or do standalone)

- [ ] `renderBriefMd` artifacts section in `scripts/lib/brief-markdown.mjs` (#83/#137 follow-up; `get_artifacts` already covers the MCP reader; keep `export-brief.mjs` output changes deliberate — the byside/prntd exports are consumed by other repo sessions).
- [ ] Commit the uncommitted `.mcp.json` in `~/src/byside` + `~/src/prntd` (paths only, no secrets).
- [ ] #83 Phase C (save-wireframe-as-artifact) — gated/cut-first, own PR only if wanted.

## Conventions reminders for the build session

- TDD; risky changes via PR + preview (`git push origin <branch>:preview --force` to eyeball).
- Confirm with Nico before any push/merge to main (deploys prod).
- No maker/builder names or quoted private feedback in code, tests, commits, or issues.
- New e2e scripts: `launchLoggedIn()` from `scripts/lib/preview-login.mjs`; poll the maker name gate; keep fixture strings free of UI keywords.
