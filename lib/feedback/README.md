# Feedback wire contract

This is the canonical spec for the `<FeedbackWidget>` ↔ `/api/feedback`
contract. Update this file when the contract changes; sites embedding the
widget read this to know what to send.

The contract lives in three coordinated places:

| Concern              | Source of truth                                    |
| -------------------- | -------------------------------------------------- |
| Field names + types  | `payload.ts` (`FeedbackPayload`)                   |
| Field validation     | `payload.ts` (`validateFeedbackInput`)             |
| Server-side accept   | `app/api/feedback/route.ts`                        |
| Reference client     | `components/FeedbackWidget.tsx`                    |

If you copy the widget into another repo, also copy `payload.ts`. They're
designed to travel together.

## Endpoint

```
POST https://ibuild4you.com/api/feedback
Content-Type: application/json
```

CORS is open (`Access-Control-Allow-Origin: *`) — anti-abuse lives in the
honeypot, render-time check, and rate limit, not in an origin allowlist.

## Request body

```jsonc
{
  "projectId": "bakery-louise",        // string, required, must match an existing projects.slug
  "type": "bug",                       // "bug" | "idea" | "other", required
  "body": "Footer link 404s",          // string, required, max 5000 chars
  "submitterEmail": "j@example.com",   // string, optional, lowercased server-side
  "pageUrl": "https://...",            // string, optional, sliced to 2000 chars
  "userAgent": "Mozilla/5.0 ...",      // string, optional, sliced to 500 chars
  "viewport": "1440x900",              // string, optional, sliced to 50 chars
  "website": "",                       // honeypot — MUST stay empty
  "_ts": 1736812345000                 // number, required, render-time epoch ms
}
```

## Anti-abuse rules (server-enforced)

1. **Honeypot.** `website` must be empty. Non-empty submissions get a silent
   `200 { ok: true }` so bots don't learn they were caught.
2. **Render-time window.** `_ts` must be at least **2,000 ms** old (catches
   bots that fill and submit instantly) and at most **86,400,000 ms / 24 h**
   old (catches stale-form replays). Outside the window → `400 Invalid
   submission`. **Drift on either bound silently rejects submissions** —
   keep this window in mind if you cache the form HTML.
3. **Rate limit.** 5 submissions per IP per hour. Exceeded →
   `429 Too many submissions` with a `Retry-After` header in seconds.
4. **Slug gate.** `projectId` must match an existing `projects.slug`.
   Unknown slug → `404 Unknown project`.
5. **Optional auth.** A `Bearer` token in the `Authorization` header is
   accepted but not required. If present and valid, the resulting feedback
   row records `submitter_uid`. Invalid tokens are silently treated as
   anonymous — they don't fail the submission.

## Responses

| Status | Body                                              | Meaning                                    |
| ------ | ------------------------------------------------- | ------------------------------------------ |
| 201    | `{ "id": "<feedback-id>" }`                       | Created                                    |
| 200    | `{ "ok": true }`                                  | Honeypot tripped (silently dropped)        |
| 400    | `{ "error": "<reason>" }`                         | Validation failure, see `<reason>`         |
| 404    | `{ "error": "Unknown project" }`                  | `projectId` doesn't match any slug         |
| 429    | `{ "error": "Too many submissions, ..." }`        | Rate limit; respect `Retry-After`          |

## Side effects on success

- Row written to `feedback/{id}` with `status: "new"` and the request fields
- Admin notification email sent via Resend (non-blocking — submission
  succeeds even if email fails)

## What goes wrong

- **Silent rejection.** Most likely: `_ts` outside the 2 s – 24 h window
  (form was cached or pre-rendered too long ago, or rendered after a clock
  skew). Always set `_ts` from `Date.now()` at *render time*, not at submit
  time.
- **404 Unknown project.** Slug mismatch. Project slugs are kebab-case and
  must match exactly — `bakery-louise`, not `bakerylouise` or
  `bakery-louise-v1`.
- **Drifting field names.** Don't rename. The server enforces exact field
  names and rejects unknown shapes silently in some cases.

## Adding a new field

1. Update `FeedbackPayload` in `payload.ts`.
2. Update `buildFeedbackPayload` to populate it.
3. Update `app/api/feedback/route.ts` to read + persist it.
4. Update this README.
5. Bump tests in `lib/feedback/__tests__/payload.test.ts` and
   `app/api/feedback/__tests__/route.test.ts`.

The wire format is the contract every embedder depends on. Treat changes
to it like an API version bump — additive fields are safe, renames or
removals are not.
