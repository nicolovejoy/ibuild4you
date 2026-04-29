# File Upload — Improvement Plan

## Context

Maker (Matt) reported "I'm getting an error message when I try to send them to you as PDFs" while attempting to upload NWMLS form PDFs in his chat session. We don't have the exact error text. Two underlying issues:

1. **Uploads fail for plausibly-sized PDFs.** Real-estate form packets routinely run 5–20MB; we cap at 4MB everywhere.
2. **Even when uploads succeed, the agent never sees the file.** `/api/chat` stores `file_ids` on the user message but doesn't pass any document content to Claude. The agent is blind to PDFs and images.

Coverage gap: there are no tests for `/api/files` or `/api/files/[fileId]`. Every other API route has a vitest suite.

## Current State

- `addFiles` (client): rejects >4MB before upload (`MakerProjectView.tsx:194`)
- `useUploadFiles` (client): multipart `FormData` POST to `/api/files`, surfaces server error text or generic fallback (`lib/query/hooks.ts:417`)
- `/api/files` POST: re-validates 4MB, accepts any content_type, `Buffer.from(arrayBuffer)`, single-shot `PutObjectCommand` to `ibuild4you-files`, returns generic 502 on any S3 error
- `/api/files/[fileId]` GET: auth-gated, fetches from S3, returns bytes inline with original `content_type`
- `/api/chat` POST: stores `file_ids` on the message doc but builds Claude `messages` from text `content` only

## Constraints / Stack Notes

- Vercel function request-body cap is ~4.5MB regardless of our app cap. Larger uploads must skip the function entirely (presigned URL → direct-to-S3).
- Anthropic PDF support (`@anthropic-ai/sdk` 0.57): `document` content blocks via base64, URL, or Files API. Hard limit ~32MB / 100 pages per PDF.
- Firestore + Admin SDK only used server-side; never client-side.
- AWS creds in prod come from Vercel env vars feeding the default credential chain in `lib/s3/client.ts`.

## Three Phases

### Phase 1 — Diagnostics (small, ship first)

Goal: next time a maker hits an error, we know exactly why. No behavior change.

- **Server logging.** On every `/api/files` failure path, log `{ filename, size, content_type, code, message }`. Today we only log the raw S3 error with no request context.
- **Specific error responses.** Distinguish:
  - `400` "Too large — max 4MB" (today's behavior, keep)
  - `502` "Storage upload failed: <code>" (S3 error, include AWS error name)
  - `500` "Unexpected error" (everything else)
- **Client error surfacing.** `useUploadFiles` currently does `await res.json()` blindly — if the platform returns a non-JSON 413, this throws and we lose the real reason. Wrap parsing, fall back to status text. Pass through to `setError` verbatim.
- **Browser console signal.** When `addFiles` rejects for size, also `console.warn` so the rejection shows up if Matt opens DevTools.

This phase doesn't fix anything for Matt yet — it tells us what's actually failing.

### Phase 2 — Raise the Cap (presigned-URL direct upload)

Goal: support 25MB PDFs reliably, bypass Vercel's 4.5MB function body limit.

**Flow option A: pre-create Firestore doc, upload, mark ready.**
1. Client calls `POST /api/files/init` with `{ project_id, session_id?, filename, content_type, size_bytes }`. Server validates auth/role/size, generates `file_id` and `storage_path`, creates Firestore doc with `status: 'pending'`, returns `{ file_id, upload_url }`.
2. Client `PUT`s the bytes directly to `upload_url` (presigned S3 URL, ~5min TTL).
3. Client calls `POST /api/files/${file_id}/confirm` to mark `status: 'ready'`.
4. UI uses `status: 'ready'` to filter what's shown in `FilesGrid`.

**Flow option B: upload-then-register.**
1. Client calls `POST /api/files/upload-url` → server returns `{ file_id, storage_path, upload_url }` (no Firestore write).
2. Client `PUT`s to `upload_url`.
3. Client calls `POST /api/files` with the metadata to create the Firestore doc.

**Tradeoff.** A handles orphans cleanly (pending docs can be cleaned up) but is three round-trips. B is two round-trips but leaves orphan S3 objects when the client crashes between step 2 and 3.

**Recommendation: A.** The pending state is also useful UX — we can show "uploading..." per file and let the user cancel before finalize.

**Cap.** Raise to 25MB. NWMLS packets fit, well under Anthropic's 32MB PDF limit. Anything larger gets rejected with a clear message.

**Backwards compatibility.** Existing files in Firestore have no `status` field; treat missing as `ready`.

### Phase 3 — Make Files Useful to the Agent

Goal: when a maker attaches a PDF or image to a chat message, the agent can actually read it.

**Where to inject.** In `/api/chat`, after loading conversation history, walk every user message that has `file_ids`, fetch each file from S3, and prepend a non-text content block to that message's content array.

**Format options for PDFs:**

| Option | Pros | Cons |
|---|---|---|
| Native `document` block (base64) | Visual layout preserved; one API; works today | Re-sent on every turn unless cached; ~30K input tokens per 10-page PDF |
| Anthropic Files API | Upload once, reference by `file_id` forever | Adds a separate upload step + Files API state to manage; another thing to debug |
| Server-side text extraction (`pdf-parse`) | Cheap (text only); no per-turn overhead beyond text | Loses tables, images, form layout — bad for visual artifacts |

**Recommendation: native `document` block + prompt caching.** Mark the file content blocks with `cache_control: { type: 'ephemeral' }` so subsequent turns reuse the cached PDF. Keeps things simple. Revisit Files API only if cache misses or token costs become a problem.

**Images:** same pattern, `image` content block, base64.

**Token-cost guardrail.** Compute total file bytes before the Claude call; if a single message's attachments exceed e.g. 20MB or 50 pages, refuse with a clear message rather than sending and failing late.

## TDD Approach

Each phase is a good fit for tests-first. The project's vitest pattern (Firestore mocked via collection-name closures, see `app/api/chat/__tests__/chat.test.ts`) extends naturally.

**New dev dep:** `aws-sdk-client-mock` for mocking `S3Client.send()`. Standard, lightweight, fits vitest.

**Phase 1 tests (write first):**
- POST `/api/files` returns `400` with file name + 4MB limit message when oversized
- POST `/api/files` returns `502` with S3 error code when `PutObjectCommand` rejects
- POST `/api/files` returns `500` "Unexpected error" on non-S3 throws (e.g. Firestore failure)
- All failure paths log `{ filename, size, content_type, code }` (assert via `vi.spyOn(console, 'error')`)

**Phase 2 tests:**
- POST `/api/files/init` validates auth/role and rejects >25MB before issuing URL
- POST `/api/files/init` writes a `pending` Firestore doc with `file_id`, `storage_path`, no upload yet
- POST `/api/files/${id}/confirm` flips `status: 'ready'`, errors if doc is already ready or missing
- `FilesGrid` and chat preview filter to `status: 'ready'` (component test)
- Existing files without `status` field are treated as ready (backwards-compat test)

**Phase 3 tests:**
- `/api/chat` with a user message carrying `file_ids` for an image: Claude `messages` array contains an `image` content block with the right base64
- Same for `application/pdf` → `document` block
- Files attached to an earlier turn are re-included on subsequent turns (test the loop covers history, not just the latest message)
- Total attachment bytes >20MB: route returns 413 before calling Claude
- `cache_control: ephemeral` is set on file content blocks (assert on the messages payload)

**End-to-end the manual way.** Real-S3 flow can't be unit-tested. Plan to manually verify in prod with a small NWMLS PDF after Phase 2 ships, then with the full agent loop after Phase 3.

## Open Questions

1. **Per-message vs per-project context.** Today files are scoped to project; only those attached to a message via `file_ids` get sent. Should the agent always see *all* project files, or only the ones the maker explicitly attached to a turn? Lean explicit-only — otherwise context balloons unpredictably as files accumulate.
2. **Builder-uploaded files.** Builders also upload to projects (BuilderProjectView). Those don't appear in chat unless they're attached. Out of scope here, but should the builder be able to "share with agent" a file they uploaded? Probably yes, eventually.
3. **Retention.** S3 lifecycle policy on the bucket — anything? If a Firestore file doc is deleted, is the S3 object cleaned up? Currently no. Worth a follow-up but not blocking.
4. **Anthropic prompt-caching minimum.** Prompt caching has a 1024-token minimum content block. Tiny PDFs may not benefit. Acceptable — they're cheap anyway.

## Order of Operations

Ship Phase 1 first (a few hours, contained, gives us diagnostic visibility immediately).

Then Phase 2 (likely a day, larger surface area: new endpoints, client refactor, tests).

Then Phase 3 (also ~a day, mostly in `/api/chat` plus a token-budget guard).

Each phase is independently shippable. Phase 1 alone unblocks Matt re-trying with usable error messages. Phase 2 alone makes uploads work for real PDFs. Phase 3 makes them useful to the agent.
