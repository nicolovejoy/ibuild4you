# Files-to-Agent + Brief Generation — Fixes

Follow-up to `docs/file-upload-plan.md` (Phases 1-3 shipped late April). This
plan covers two regressions discovered when Matt tried to share 16 NWMLS
form PDFs in his NWMLS Contract Generator project on May 9, 2026.

## What broke

### Symptom A — Chat wedged after multi-PDF upload

Matt uploaded 16 NWMLS form PDFs in a single message. Files arrived in S3 and
showed up in the Files tab. The chat returned a generic error and Matt asked
"Did you receive?" The agent never responded — neither acknowledging nor
denying the files. Three retries, three identical 500s.

Vercel runtime log surfaced the actual reason:

```
400 {"type":"error","error":{"type":"invalid_request_error",
"message":"A maximum of 4 blocks with cache_control may be provided. Found 16."}}
```

Root cause: `lib/agent/attachments.ts` tagged every attachment block with
`cache_control: { type: 'ephemeral' }` for prompt caching. Anthropic caps
cache_control markers at 4 per request. With 16 PDFs in one message we sent
16 markers and got 400'd. Worse, the failing user message was already
persisted with `file_ids`, so every retry replayed the same wedged message
and 400'd again — Matt was stuck until we either fixed the code or cleared
his message manually.

### Symptom B — Brief stays empty across sessions

Three sessions in, Matt's brief had every field empty except `open_risks`
(which had content because it was injected via the JSON payload at session 3).
The agent reads the brief into the system prompt during chat (good) but
never writes to it (the gap). Brief regeneration only fires when a builder
manually clicks "Generate brief" in the dashboard
(`BuilderProjectView.tsx:526-539` → `POST /api/briefs/generate`).

If the builder doesn't remember to click the button, the brief never updates
and every subsequent chat session loses the structure that earlier sessions
should have produced.

## Phased fixes

### A0 — cache_control fix + better error logging  (SHIPPED)

- `lib/agent/attachments.ts`: dropped per-block `cache_control`. Made the
  field optional on the type, kept the rest of the block shape unchanged.
- `app/api/chat/route.ts`: after building `claudeMessages`, place exactly
  one `cache_control: ephemeral` marker on the last block of the *most
  recent* user message that has attachments. Anthropic caches the entire
  prefix up to and including that block — full caching benefit, one marker.
- Better error surfacing: catch in the readable-stream now logs
  `chat_stream_error` with the Anthropic status + error body so future 4xx
  failures are diagnosable from runtime logs without log archaeology.
- Tests updated + new coverage for the >4-attachments case and
  most-recent-only marker placement.

Matt's chat un-wedges automatically — his historical message keeps its
`file_ids`, but the next request's request body has 1 marker instead of
16, so Anthropic accepts it.

### A1 — Manual unstick script  (SKIPPED)

Earlier plan had a one-shot `clear-message-attachments` script. With A0 the
wedge resolves on its own — no script needed.

### A2 — Graceful skip when attachments exceed per-message cap  (NOT YET)

Today `loadAttachmentBlocks` throws `attachments_too_large` when a message's
total attachments exceed 25MB. `app/api/chat/route.ts` catches and returns
413 to the client, but the message is already saved with `file_ids`, so
every retry fails the same way until a builder edits the message.

Fix: instead of throwing, the helper returns the blocks it can fit (skipping
the rest) plus a list of skipped filenames. The chat route injects a synthetic
text block on that message ("[N files were too large to share — saved in
project files but not visible to the agent]") and proceeds. The agent can
then say so to the maker rather than going silent.

Lower priority than A3-A5 because the more common multi-PDF failure is now
covered by A0.

### A3 — Atomic upload semantics in `MakerProjectView`

Today `uploadFiles.mutateAsync` runs all uploads in `Promise.all`. If any
single file fails, the throw aborts the message-save, but the successful
uploads are already `ready` in Firestore. They appear in the Files tab but
aren't attached to any chat message — agent never sees them.

Fix: on partial failure, save the message with the successful subset and
surface a visible warning ("3 of 5 files failed to upload — try those again").
Don't lose the work that succeeded.

### A4 — Pre-upload size budgeting

`addFiles` checks per-file >25MB. Extend to running batch total: if the
new file would push the batch over 25MB, reject at picker time before the
init round trip. Better UX, no S3 round trip wasted.

### A5 — Per-attachment status in the message bubble

Today the chat shows attached file pills with no indication whether the
agent processed them. Add a state per file: `shared` / `skipped (too large)`
/ `failed`. Requires threading this back from the chat-stream response —
small protocol change.

### B1 — Auto-regenerate brief after session goes idle  (SHIPPED)

- Extracted brief generation into `regenerateBriefForProject(db, projectId)`
  in `lib/api/briefs.ts`. The manual route now delegates to it.
- `/api/chat` records `last_maker_message_at` on the project doc for every
  maker turn (skipped for admin posts).
- `/api/cron/notify` extended: after handling notification digests, scans
  for projects where `last_maker_message_at < now - 10min`, then for each
  loads the latest brief and skips if it's already fresher than the last
  maker turn. Otherwise calls `regenerateBriefForProject` synchronously
  inside the cron tick. Errors are logged per project; one failure doesn't
  stop the loop.
- Tests cover: stale brief regenerated, fresh brief skipped, missing brief
  triggers regen, partial-failure batch, no-idle-projects no-op.

No Vercel Queue: at our scale the durability isn't needed and adding queue
infrastructure for one use case is overkill. The existing cron is already
there. If we downgrade off Pro, both notify-debounce and idle-brief-regen
lose their 5-min granularity together — graceful degradation.

### B2 — Stale-brief indicator in builder dashboard

"Brief out of date" badge when `brief.updated_at < latest_message.created_at`.
Manual "Regenerate" button stays available as a forced refresh.

## Order of operations

1. ~~A0 — cache_control fix~~  ✅ shipped
2. ~~B1 — idle brief regen~~  ✅ shipped
3. A3 — atomic upload semantics
4. A4 — pre-upload size budget
5. A5 — per-attachment status pill
6. A2 — graceful skip on cap
7. B2 — stale-brief indicator

## What we're explicitly not doing

- **Anthropic Files API switch.** With A0 in place, prompt caching covers
  the per-turn cost of re-sending PDFs. Files API is a real architectural
  change (4-step upload, separate file ID surface, retention semantics) we
  don't need until token cost becomes a problem.
- **AI SDK / AI Gateway migration.** Validation hooks suggest swapping the
  direct Anthropic SDK for `@ai-sdk/anthropic` or routing through Gateway.
  Out of scope; would couple this fix to a much larger change.
- **Vercel Queues for brief regeneration.** B1's cron-based fan-out is
  enough. Save Queues for a use case that needs at-least-once durability
  (probably outbound emails, eventually).

## Recovery for Matt's existing wedge

Once A0 is deployed, no manual recovery is needed. His next message in the
chat will succeed because the request now contains 1 cache_control marker
regardless of how many PDFs are in history.

To enumerate what we have for him: `node scripts/list-project-files.mjs
nwmls-contract-generator`. Prints the table to stdout and copies a clean
Markdown bullet list to the clipboard for pasting into the reply.
