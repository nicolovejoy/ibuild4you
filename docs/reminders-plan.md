# Reminders ("nagging") — plan to flip live

High-level plan for taking the maker auto-reminder system from dry-run to live,
with an in-app observability surface that replaces the env-var safety switch.
Grounded against `main` on 2026-05-30.

## Where it stands (verified)

The system is **built and dry-running on prod — not sending real email yet.**

- **Cron** `app/api/cron/maker-reminders/route.ts` — daily (09:00 PT). Filters
  `projects` to `auto_reminders_enabled == true`, runs the cadence per project,
  sends, updates counters, writes a `reminder_log` row. Per-project errors are
  isolated (one bad project can't block the batch).
- **Cadence** `lib/api/reminder-cadence.ts` — pure, well-tested. 2d → 5d → 10d,
  cap 3 per cycle. Anchor = `lastReminderSentAt || latestSessionCreatedAt ||
  sharedAt`. Resets when the maker messages.
- **Sender** `lib/email/send-reminder.ts` — To maker, BCC builder, Reply-To
  `noreply@`. Gated by `REMINDER_DRY_RUN`.
- **Per-brief toggle** `auto_reminders_enabled` — SHIPPED (UI in
  `BuilderProjectView.tsx`, cron filter, defaults on for new projects).
- **`REMINDER_DRY_RUN`** — still set on Vercel; the cron logs would-sends without
  emailing. This is the safety switch we want to retire.

## ⚠️ Correctness gap to fix BEFORE flipping live

The cron reads `project.latest_session_created_at` straight off the Firestore
doc (`maker-reminders/route.ts:54`), but **that field is never persisted** — it's
only computed at read-time in `lib/api/enrich-projects.ts:117`. On the raw doc
it's `undefined`, so:

- The cadence anchor falls back to `shared_at` (original share) instead of the
  **latest** session — reminders fire off a stale timestamp once a project has
  had a next-convo session prepped.
- The "maker already responded" suppression (`lastMakerMessageAt >
  latestSessionCreatedAt`) can't evaluate and is skipped.

`last_maker_message_at` IS persisted (`chat/route.ts:85`), so only the session
timestamp is missing. Fix options:
- **(preferred)** Denormalize `latest_session_created_at` onto the project doc
  when a session is created (`app/api/sessions/route.ts` + the create-session
  path in `app/api/projects/route.ts`). Cheap, matches the cron's assumption.
- Or have the cron query the latest session per candidate (one extra read each).

This ties into the backlog "P4/P5 denormalized session counters" theme — same
denormalization gap.

## Phases

### Phase 1 — Make it correct + observable (the gate before going live)

1. **Fix the `latest_session_created_at` gap** (above). Add a cadence test that
   exercises the latest-session-vs-shared_at anchor.
2. **Log skip/would-send decisions.** Today `reminder_log` only gets a row on
   send (incl. dry-run sends) — skips aren't recorded, so the daily decision set
   isn't queryable. Extend the cron to log every decision (sent / would-send /
   skipped + reason). Either widen `reminder_log` or add a `reminder_decisions`
   collection.
3. **`/admin/reminders` view.** Admin-gated page (pattern: `/admin/usage`, use
   `<SectionHeader />`). Lists recent decisions: project title (hydrated),
   decision, reason, reminder #, days-since-touch, timestamp. Filter by project
   + decision. This is the "self-observable" surface that replaces the env-var
   switch. Add route tests.

### Phase 2 — Flip live

1. Pre-flip checklist: review a few days of dry-run decisions on
   `/admin/reminders`; sanity-check targeting + cadence; confirm the iCloud
   catch-all (Next Steps #5) so test-account emails land somewhere visible; do
   one controlled live send to `test@ibuild4you.com`.
2. Delete `REMINDER_DRY_RUN` on Vercel.
3. Watch `/admin/reminders` over the next cron tick for the first real sends.
4. **Rollback:** re-add `REMINDER_DRY_RUN=true` on Vercel — no code change.

### Phase 3 — Dashboard filter/sort (independent, post-flip)

Filter by turn-state (waiting-on-maker / your-turn / needs-setup) + remind-state
(auto-remind on/off); sort by last-activity / created / nudged. Separate PR; not
required to flip. Makes the dashboard usable as the maker count grows.

## Adjacent items (don't block the flip)

- **Copy (#21).** The reminder body is boilerplate ("your conversation for X is
  ready"). Consider per-cadence wording. Separate item; can land before or after.
- **Reply-To (#10 PR 3).** Still `noreply@`; inbound replies don't post as
  messages yet. Independent.
- **iCloud catch-all (#5).** Needed to validate maker-facing email end-to-end —
  pull it into Phase 2's pre-flip checklist.

## Suggested first PR

Phase 1 as one PR: fix `latest_session_created_at`, add decision logging, build
`/admin/reminders` + tests. That alone makes the system correct and observable;
the flip (Phase 2) is then a one-line env change you can do with confidence.

## Real-world caveat

There are real makers in prod now — flipping live sends real email to real
people. Phase 1 observability + the controlled test send are what de-risk it.
Don't skip straight to deleting the env var.
