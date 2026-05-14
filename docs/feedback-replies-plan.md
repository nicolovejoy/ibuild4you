# Feedback replies — design notes for sub-task (d)

Issue #3 sub-task (d): wire up Resend's inbound mail webhook so that when a
submitter replies to the "your feedback was acknowledged/done" notification
email, the reply lands in `feedback/{id}/replies` and shows up in the admin
dashboard.

The `FeedbackReply` type in `lib/types/index.ts` is already defined.

## Roles (this confused us once — write it down)

- **Submitter** — whoever filled out the `<FeedbackWidget>` on a client
  site. With the current `?feedback=on` gate this is the **owner of that
  site** (e.g. Louise on bakerylouise.com), not arbitrary visitors. Often
  the same human as the project's `maker` member, but conceptually
  distinct.
- **Admin** — whoever triages at `/admin/feedback`. This is a system role
  (`system_roles: ['admin']`), distinct from project roles. Currently
  always Nico, but architecturally not assumed to be the project's
  builder.

## Threading: how do inbound replies find the right feedback row?

When `/api/admin/feedback/[id]` PATCHes status into `acknowledged` or
`done` and there's a `submitter_email`, it sends a notification via
Resend. If the submitter hits reply, the reply needs to route back to
the right `feedback/{id}` doc. Three patterns considered:

1. **Plus-addressing on the Reply-To** ✅ recommended.
   Outbound: `Reply-To: feedback+{id}@ibuild4you.com`.
   Inbound webhook receives mail; we extract `{id}` from the `To` header.
   No DB lookup, no extra state. Requires Resend's inbound to support
   plus-addressing on the domain (it does — standard pattern).

2. **Message-ID threading.** Store the outbound `Message-ID` on the
   feedback doc; inbound's `In-Reply-To` header points back to it; we
   look up by that. More state, more correct (handles users who reply
   to *any* of our emails to them, not just the one we sent on
   acknowledged). Worth considering once we have multiple outbound
   email types per feedback.

3. **Subject-line token** (e.g. `[#abc123]`). Fragile — users edit
   subjects, clients strip brackets. Skip.

Start with (1). Migrate to (2) only if a real need shows up.

## Open design questions

- **Should the admin be able to reply from the dashboard?**
  - If yes: dashboard shows the replies thread + a "Reply" composer that
    POSTs to a new endpoint, which writes a `from: 'admin'` reply to the
    subcollection AND emails the submitter (using the same plus-addressing
    so their reply continues the thread).
  - If no for v1: ingest-only. Admin's only outbound is the
    automatic acknowledged/done notification. Cleaner first cut.
  - Recommendation: ingest-only for v1. Add reply-from-dashboard as a
    follow-up once we see whether submitters actually use the email
    reply path.
- **Should an inbound submitter reply bump the feedback row's status?**
  - Option A: leave status alone, just append the reply.
  - Option B: bump back to `new` so the admin notices (e.g. row reappears
    in the default filter).
  - Option C: a new `awaiting_admin` status.
  - Recommendation: Option B. Reuses existing UX. New replies surface
    naturally. Status churn is the price.

## Implementation sketch (when you build it)

1. **Outbound adjustment** — `app/api/admin/feedback/[id]/route.ts`,
   the Resend `emails.send` call: add `replyTo: 'feedback+{id}@ibuild4you.com'`.
2. **Inbound webhook route** — `app/api/webhooks/resend/inbound/route.ts`:
   - Verify Resend's signature (Svix-style HMAC, see Resend docs)
   - Parse the `to` field to extract `{id}` from `feedback+{id}@...`
   - Reject (404) if the feedback doc doesn't exist
   - Write a row to `feedback/{id}/replies` subcollection:
     `{ feedback_id, from: 'submitter', from_email, body, via_email: true, created_at, updated_at }`
   - Bump parent feedback's `status` to `new` (per recommendation above)
     and set `updated_at`
3. **Dashboard surfacing** — `/admin/feedback` row: load + render replies
   inline (chronological), distinguish `from: 'submitter'` vs
   `from: 'admin'` visually.
4. **Pure helper** — `lib/feedback/inbound.ts`:
   - `parseFeedbackIdFromAddress('feedback+abc123@ibuild4you.com') → 'abc123'`
   - `buildInboundReply(payload) → FeedbackReply` (or close to it)
   - Tested in isolation.
5. **Tests** — route test with mocked Firestore, helper test for
   address parsing edge cases (no plus tag, multiple recipients,
   weird whitespace).

## Resend setup (manual, before deploying)

- Verify `ibuild4you.com` is configured for inbound mail in the Resend
  dashboard
- Configure inbound forwarding so `feedback+*@ibuild4you.com` (or all
  `*@ibuild4you.com`) routes to the new webhook endpoint
- Copy the inbound signing secret into `RESEND_INBOUND_SECRET` in Vercel
  production + preview

## What's out of scope for (d)

- Admin replying from the dashboard (queue as a follow-up)
- Notification when a submitter replies (admin can poll the dashboard;
  add an email digest later if needed)
- Threading across multiple feedback rows from the same submitter
  (each `feedback/{id}` is its own thread)
