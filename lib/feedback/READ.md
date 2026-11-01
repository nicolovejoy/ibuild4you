# Reading feedback from a host server (Loop)

A host app can read its own app's feedback from Loop with a per-app read key,
for example to show recent reports inside its own admin screen. MusicForge is
the first consumer. This is the read side of Loop; the write side (the widget
posting to `/api/feedback`) is in [`README.md`](./README.md), and the overview
is in [`docs/loop.md`](../../docs/loop.md).

## Privacy rule

Submitter email addresses stay in Loop. They may reach a human's eyes in Loop, but never pass through or get stored by a host app's server.

So this endpoint never returns an email, a user agent, a page URL, the full
feedback text or an internal note. Hosts get a short summary, a coarse
platform and a per-app sender tag instead.

## Getting a key

1. A system admin opens `/admin/apps/<slug>` in Loop and mints a key. It looks
   like `lrk_` followed by 22 characters.
2. The key is shown once, at mint. Loop stores only a hash, so it cannot show
   it again. Put it in the host's secret manager straight away.
3. **Rotate** replaces the key immediately: the old one answers 404 on its very
   next use. **Revoke** ends access until a new key is minted.

There is one live key per app. Keep it on the host's server only.

## Request

```
GET https://ibuild4you.com/api/feedback/read?app=<slug>&limit=20&before=<cursor>
Authorization: Bearer lrk_...
```

- `app`: the app's canonical slug. A legacy slug is not accepted (404).
  Feedback sent under the app's older slugs is included.
- `limit`: 1 to 50, default 20. A value outside the range is clamped, and a
  non-numeric value falls back to 20.
- `before`: optional and opaque. To get the next page, pass back the
  `next_cursor` from the previous response unchanged. Do not build or edit one.

Results are newest first.

```
curl -s -H "Authorization: Bearer $LOOP_READ_KEY" "https://ibuild4you.com/api/feedback/read?app=musicforge&limit=20"
```

## Response

```json
{
  "items": [
    {
      "id": "Zk3m9XqW2pLd",
      "type": "bug",
      "summary": "The play button does nothing after I switch tracks",
      "platform": "ios",
      "created_at": "2026-10-30T18:04:11.000Z",
      "status": "new",
      "loop_url": "https://ibuild4you.com/admin/apps/musicforge?id=Zk3m9XqW2pLd",
      "sender": "Sender 3fa9"
    }
  ],
  "next_cursor": "eyJjIjoiMjAyNi0xMC0zMFQxODowNDoxMS4wMDBaIn0"
}
```

`next_cursor` is `null` when there is nothing older to fetch.

Fields of each item:

- `id`: the feedback id.
- `type`: `bug`, `idea` or `other`.
- `summary`: the first non-empty line of the feedback text, trimmed. Anything
  shaped like an email address in it is replaced with `[email]`. It is cut to
  140 characters, ending in an ellipsis when cut.
- `platform`: coarse, derived from the user agent: `ios`, `android`, `mac`,
  `windows`, `linux` or `other`.
- `created_at`: ISO 8601 timestamp, UTC.
- `status`: `new`, `acknowledged`, `in_progress`, `done` or `wontfix`. Spam is
  never listed.
- `loop_url`: opens this item in Loop for an admin. It needs a Loop sign-in
  with access to the app; the key does not grant it.
- `sender`: `"Sender "` plus four hex characters. The same person gets the same
  tag within one app every time, so you can tell senders apart in a list. The
  tag cannot be reversed to an email and does not match across apps. It is
  `"anonymous"` when the submission had no email.

A page can come back with fewer than `limit` items and still carry a
`next_cursor` (for example when many recent rows were spam). Keep following the
cursor until it is `null`.

## Errors

- 404 `{ "error": "Not found" }`: every authentication or app failure, on
  purpose the same answer for all of them. Missing or malformed header, wrong or
  revoked key, a key belonging to another app, an unknown or legacy slug, an
  invalid slug.
- 400 `{ "error": "Invalid cursor" }`: `before` is not a cursor Loop issued.
- 429 `{ "error": "Too many requests" }`: over the rate limit. The `Retry-After`
  header says how many seconds to wait.
- 503 `{ "error": "not_configured" }`: Loop is missing its sender-tag secret.
  Not something the host can fix; tell the Loop owner.

## Limits and scope

- Rate limit: 60 reads per minute per app. Only requests with a valid key count.
- Server-to-server only. The endpoint sends no CORS headers and has no OPTIONS
  handler, so a browser cannot call it cross-origin. Never ship the key to a
  client.
- Responses carry `Cache-Control: no-store`.
