# Feedback replies — Resend inbound webhook

Issue #3 sub-task (d): when a submitter replies to the "your feedback was
acknowledged/done" notification email, the reply lands in
`feedback/{id}/replies` and shows up in the admin dashboard.

**Status: code complete (2026-05-14). Awaiting Resend dashboard + DNS setup
to verify end-to-end in prod.**

## What was built

| Concern                | Location                                                         |
| ---------------------- | ---------------------------------------------------------------- |
| Outbound `Reply-To`    | `app/api/admin/feedback/[id]/route.ts` (uses `feedbackReplyAddress`) |
| Inbound webhook        | `app/api/webhooks/resend/inbound/route.ts`                       |
| Pure helpers           | `lib/feedback/inbound.ts` (address parsing, reply shape)         |
| Admin GET endpoint     | `app/api/admin/feedback/[id]/replies/route.ts`                   |
| Dashboard thread UI    | `RepliesThread` in `app/admin/feedback/page.tsx`                 |
| Signature verification | `svix` library (Resend uses Svix-compatible signing)             |

Threading uses **plus-addressing on Reply-To**:
`feedback+<feedback-id>@inbox.ibuild4you.com`. Stateless — no DB lookup
needed to route inbound back to the right row.

## Roles (from the original design)

- **Submitter** — the person who filled out `<FeedbackWidget>`.
- **Admin** — whoever triages at `/admin/feedback` (`system_roles: ['admin']`).

## Behavior decisions (locked)

- **Ingest-only v1.** Admin cannot reply from the dashboard yet. Their only
  outbound is the existing acknowledged/done notification. Add a "reply
  from dashboard" composer later if submitters actually use the email
  reply path.
- **Inbound reply bumps parent status back to `new`.** Row resurfaces in
  the admin's default filter so replies are noticed. Status churn is the
  price.
- **Body retrieval is best-effort.** Resend's inbound webhook ships
  metadata only; we fetch the body via REST as a follow-up call. If
  retrieval fails (network, 4xx), the reply row is still written with a
  placeholder body ("[Reply received — body retrieval failed: <reason>]")
  so the admin sees that a reply arrived.

## Manual setup needed before this goes live

### 1. Resend dashboard

- Verify a domain for inbound mail. Recommended: **`inbox.ibuild4you.com`**
  (subdomain) so the apex `ibuild4you.com` keeps its existing iCloud MX
  setup. If you'd rather repoint apex MX to Resend, that works too, but
  any current inbound to `@ibuild4you.com` (e.g. iCloud forwarding) will
  break.
- Configure an inbound route so mail to `feedback+*@inbox.ibuild4you.com`
  (or whichever host you used) forwards to the webhook URL:
  `https://ibuild4you.com/api/webhooks/resend/inbound`.
- Copy the inbound webhook signing secret.

### 2. DNS

- Add the MX records Resend tells you to add for `inbox.ibuild4you.com`.
  Wait for propagation (`dig MX inbox.ibuild4you.com` should show
  Resend's hosts).
- Confirm `dig MX ibuild4you.com` *still* shows iCloud — the apex
  shouldn't have changed.

### 3. Vercel env vars

- `RESEND_INBOUND_SECRET` — paste the secret from step 1. Set on
  production AND preview environments. Without this the route returns
  500 (refuses to accept unsigned inbound).
- `FEEDBACK_INBOX_HOST` (optional) — only set if you used a host other
  than `inbox.ibuild4you.com`.
- `RESEND_INBOUND_FETCH_URL` (optional) — only set if the default
  body-retrieval URL (`https://api.resend.com/emails/{id}`) returns 404
  against your Resend account. Resend's inbound API surface is in flux;
  the actual URL may be e.g. `https://api.resend.com/emails/received/{id}`.

### 4. Verification

Once setup is live:

1. Use the admin dashboard to flip a feedback row to `acknowledged`. The
   submitter (with a real `submitter_email`) gets the notification with
   `Reply-To: feedback+<id>@inbox.ibuild4you.com`.
2. Reply to that email from the submitter's account.
3. Within ~1 min the reply should appear in the dashboard thread under
   that row, and the row should be back to `new`.
4. Check Vercel logs (`vercel logs --follow`) for any `[resend-inbound]`
   warnings — body-fetch failures, forged-signature attempts, etc.

If body fetches are failing with 404 across the board, the
`RESEND_INBOUND_FETCH_URL` template is wrong — try
`https://api.resend.com/emails/received/{id}` or check the current
Resend API reference and override the env var.

## What's out of scope

- Admin replying from the dashboard (queue as a follow-up)
- Notification when a submitter replies (admin polls the dashboard;
  could add an email digest later)
- Multi-recipient routing (each `feedback/{id}` is its own thread)
- Threading across multiple feedback rows from the same submitter
- SDK upgrade resend@4 → resend@6 to get `emails.receiving.get()` —
  intentionally deferred to keep this PR focused; current REST fallback
  works without it
