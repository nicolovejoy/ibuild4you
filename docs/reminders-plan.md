# Maker reminders — how it works + ops

The auto-reminder system is **live** (flipped 2026-06-06). This is the operating
reference. History: `docs/changelog.md` (Reminders Phase 1, 2026-05-30; flip,
2026-06-06).

## How it works

- **Cron** `app/api/cron/maker-reminders/route.ts` — daily at 16:00 UTC (09:00
  PT), `vercel.json` `"0 16 * * *"`. Filters `projects` to
  `auto_reminders_enabled == true`, runs the cadence per project, emails the
  maker, advances counters, writes a `reminder_log` row. Per-project errors are
  isolated (one bad project can't block the batch).
- **Cadence** `lib/api/reminder-cadence.ts` — pure, well-tested. 2d → 5d → 10d,
  cap 3 per cycle. Anchor = `lastReminderSentAt || latestSessionCreatedAt ||
  sharedAt`. Suppressed when the maker has replied since the latest session
  (`maker_already_responded`). Resets when the maker messages.
- **Sender** `lib/email/send-reminder.ts` — To maker, BCC builder, Reply-To
  `noreply@`. Honors `REMINDER_DRY_RUN` (logs a would-send, no email, counters
  untouched).
- **Toggle** `auto_reminders_enabled` on the project — per-brief, defaults on for
  new projects. Set it from either: the brief's **Setup tab**
  (`BuilderProjectView`), or the **Auto-reminders panel on `/admin/reminders`**
  (`GET /api/admin/reminders/projects` + Switch; flip reuses `PATCH
  /api/projects` since admins get implicit owner on all projects).
- **Observability** `/admin/reminders` — every cron decision (sent / would_send /
  skipped / error) is a `reminder_log` row, listed newest-first with project
  titles hydrated. Reachable via UserMenu → Admin → Maker reminders.

## Ops

- **Rollback to dry-run:** re-add `REMINDER_DRY_RUN=true` on Vercel **and
  redeploy prod** (env-var changes only take effect on a new deployment — this
  bit us during the flip; the running deployment kept the old value until a
  redeploy).
- **Trigger a tick manually:** Vercel → Crons → `maker-reminders` → Run, or
  `scripts/trigger-cron.mjs maker-reminders` (needs `CRON_SECRET`, prod-only).
- **Inspect prod state read-only:** `node scripts/with-prod-env-ro.mjs node
  scripts/inspect-reminders-state.mjs` (opted-in projects + their cadence fields
  + recent `reminder_log`, correct schema).

## Adjacent / not done

- **Copy (#21).** Reminder body is boilerplate ("your conversation for X is
  ready"). Consider per-cadence wording.
- **Reply-To (#10 PR 3).** Still `noreply@`; inbound replies don't post as
  messages yet.
- **Dashboard filter/sort** by turn-state + remind-state — Backlog.
