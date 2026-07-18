# Feedback wire contract (Loop)

This is the canonical spec for the `<FeedbackWidget>` ↔ `/api/feedback`
contract — the wire layer of **Loop**, the feedback mechanism. For the
overview + how to embed Loop in a host app, see [`docs/loop.md`](../../docs/loop.md).
Update this file when the contract changes; sites embedding the widget read
this to know what to send.

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
  "projectId": "sample-cafe",          // string, required, must match an existing projects.slug
  "type": "bug",                       // "bug" | "idea" | "other", required
  "body": "Footer link 404s",          // string, required, max 5000 chars
  "submitterEmail": "j@example.com",   // string, optional, lowercased server-side
  "pageUrl": "https://...",            // string, optional, sliced to 2000 chars
  "userAgent": "Mozilla/5.0 ...",      // string, optional, sliced to 500 chars
  "viewport": "1440x900",              // string, optional, sliced to 50 chars
  "website": "",                       // honeypot — MUST stay empty
  "_ts": 1736812345000,                // number, required, render-time epoch ms
  "capture": {                         // OPTIONAL — #72 structural page snapshot
    "v": 1,                            //   must be exactly 1
    "route": "/checkout",              //   path only (no host/query), sliced to 300
    "title": "Checkout — Byside",      //   sliced to 200
    "outline": "h1: Checkout\n..."     //   sliced to 4000
  },
  "identityAssertion": "eyJ2Ijox....sig" // OPTIONAL — #149 host-signed identity token
}
```

### The `identityAssertion` field (#149)

An opaque token the **host app's server** mints, proving it vouches for the
submitter's email. Built by `lib/feedback/identity.ts`
(`signIdentityAssertion`) — the host runs its own copy of the signing logic
server-side (see `docs/loop.md` for the recipe) and hands the resulting
string to the widget to attach; the widget itself never signs anything.

**Token shape.** `payloadB64url + "." + sigB64url`:

- `payloadB64url` = base64url(UTF-8 JSON of `{ v: 1, email, project, ts, kid }`)
  — `project` must equal the submission's `projectId` (this repo's `projects.slug`);
  `ts` is unix **seconds**; `kid` names which per-project secret signed it.
- `sig` = base64url(HMAC-SHA256(UTF-8 bytes of the `payloadB64url` string, secret))
  — the HMAC is computed over the *string*, not a re-serialization of the
  parsed JSON. Verifiers must do the same: recompute over the exact received
  `payloadB64url`, compare in constant time, and only THEN parse the payload.

**Freshness.** Rejected if `ts` is more than **60 seconds** in the future or
more than **12 hours** old. Sign the token right before the request, don't
cache it.

**Secrets.** Per-project HMAC secret(s) live in `loop_signing_secrets/{projectDocId}`
(`{ keys: { k1: "..." }, active_kid: "k1" }`), minted via
`scripts/loop-secret.mjs <slug> [--rotate] [--prune]`. Never exposed by any
GET/API response — the mint script is the only reveal path (deliberately no
admin-UI reveal button). The host app stores its copy of the secret in its
own secret manager.

**Server behavior on receipt.** A syntactically-present `identityAssertion`
is verified before any rate-limit check runs (see below); on success the row
is written with `submitter_email` = the token's (normalized) email and
`submitter_email_verified: true`, **overriding** any `submitterEmail` also
present in the body. On failure (bad signature, expired, wrong project,
unknown kid, malformed) the assertion is silently ignored — the submission
falls back to whatever `submitterEmail` was typed (or anonymous) and is
**not** treated as verified. An invalid token never fails the submission by
itself, EXCEPT when the target project has `feedback_requires_identity: true`
(#150) — then an unverified submission (typed email or none) is rejected
with `403`.

**Rate-limit bypass.** A *verified* submission (valid token, or a valid
ibuild4you Firebase `Authorization: Bearer` — see "Optional auth" below)
bypasses the per-IP rate limit entirely. A merely-typed email does not.

**Replay.** Not hardened beyond the freshness window — see the comment atop
`lib/feedback/identity.ts` for the accepted tradeoff and what a hardened
version would add (nonce + seen-token cache).

### The `capture` field (#72)

Built by `lib/feedback/capture.ts` (`buildPageCapture`) — the third file that
travels with the widget when Loop is copied into a host app. It is a
**structure-only** outline of the page the submitter was on: headings (h1–h3),
nav landmarks + link labels, button labels, form **field labels** (never
values; password/hidden inputs skipped entirely), and row/item counts for
tables and long lists. Query strings, typed values, and non-heading body text
are never captured. Host apps can exclude any subtree by adding a
`data-loop-redact` attribute.

Server handling: a shape-valid capture is written to the separate
`prototype_context` collection (agent-facing, expiring) and the feedback row
gets `has_capture: true`; a malformed capture is silently dropped and never
fails the submission. Omitting the field entirely is always valid — servers
that predate it ignore it.

## Anti-abuse rules (server-enforced)

1. **Honeypot.** `website` must be empty. Non-empty submissions get a silent
   `200 { ok: true }` so bots don't learn they were caught.
2. **Render-time window.** `_ts` must be at least **2,000 ms** old (catches
   bots that fill and submit instantly) and at most **86,400,000 ms / 24 h**
   old (catches stale-form replays). Outside the window → `400 Invalid
   submission`. **Drift on either bound silently rejects submissions** —
   keep this window in mind if you cache the form HTML.
3. **Rate limit.** 20 submissions per IP per hour. Exceeded →
   `429 Too many submissions` with a `Retry-After` header in seconds.
4. **Slug gate.** `projectId` must match an existing `projects.slug`.
   Unknown slug → `404 Unknown project`.
5. **Optional auth.** A `Bearer` token in the `Authorization` header is
   accepted but not required. If present and valid, the resulting feedback
   row records `submitter_uid`. Invalid tokens are silently treated as
   anonymous — they don't fail the submission. A valid Bearer counts as
   "verified" for both the rate-limit bypass and #150's
   `feedback_requires_identity` gate — same as a valid `identityAssertion`.
6. **`feedback_requires_identity` (#150).** When the target project has this
   flag set `true`, a submission that isn't verified (no valid
   `identityAssertion` and no valid Bearer — a merely-typed
   `submitterEmail` does not count) is rejected with `403`. Default (flag
   absent) is unchanged behavior — anonymous submissions allowed.

## Responses

| Status | Body                                              | Meaning                                    |
| ------ | ------------------------------------------------- | ------------------------------------------ |
| 201    | `{ "id": "<feedback-id>" }`                       | Created                                    |
| 200    | `{ "ok": true }`                                  | Honeypot tripped (silently dropped)        |
| 400    | `{ "error": "<reason>" }`                         | Validation failure, see `<reason>`         |
| 403    | `{ "error": "<copy.feedback.requiresIdentity>" }` | Project requires identity, submission unverified (#150) |
| 404    | `{ "error": "Unknown project" }`                  | `projectId` doesn't match any slug         |
| 429    | `{ "error": "Too many submissions, ..." }`        | Rate limit; respect `Retry-After` (skipped for verified submissions) |

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
  must match exactly — `sample-cafe`, not `samplecafe` or
  `sample-cafe-v1`.
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
