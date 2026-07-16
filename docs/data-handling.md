# Data handling

Internal note on what personal data this app stores, where, and what's not
solved yet. Not a public privacy policy.

## What's stored, where

**Firestore** (`ibuild4you-a0c4d`, Admin SDK only — see `lib/firebase/admin.ts`):

- `users` — email, first/last name, self-assigned `account_label`.
- `approved_emails` — sign-in allowlist, keyed by lowercased email.
- `project_members` — email, name, role, per-brief membership; **stores a
  plaintext `passcode`** (maker auth secret, minted in 5 routes, pasted into
  invite emails). Being retired — see `docs/garm-consumer-plan.md`.
- `projects` — `requester_email` / `requester_first_name` / `requester_last_name`,
  builder `context` notes about the requester.
- `sessions` / `messages` — the full maker↔agent conversation transcript
  (`sender_email`, `sender_display_name`, message content). This is the
  richest PII surface in the app — it's the actual chat.
- `files` — upload metadata (filename, `uploaded_by_email`, `uploaded_by_name`);
  bytes live in S3, not Firestore.
- `prototype_context` — structural page snapshots from the Loop widget
  (headings, nav/button/field *labels*; the widget never captures values).
- `reviews` — builder annotations on a brief.

**S3** (`ibuild4you-files` bucket) — uploaded file bytes (whatever the maker
attaches: images, docs, PDFs). No independent access control beyond what the
Firestore `files` doc + API route enforce; deleting the Firestore doc deletes
the S3 object (`deleteS3Object`), but see the no-deletion-path caveat below.

## Processors (third parties that see this data)

- **Anthropic** — full conversation content (system prompt + message history)
  goes to the Claude API on every chat turn. This is the core product.
- **Resend** — transactional email (invite/nudge/reminder), sees maker email +
  name + message body.
- **AWS S3** — file bytes.
- **Google Firebase** — auth (Google OAuth + email/password) + Firestore host.
- **Vercel** — hosts the app; sees request logs / runtime logs.

## No deletion path

**There is no user-facing data deletion anywhere in this app.** The house
convention is no hard deletes — everything is a flag: `archived_at` (per-viewer
dashboard hide), `removed_at` (member moved out of a brief), `status: 'expired'`
(prototype_context retention). None of these remove data from Firestore or S3.
A maker or builder who wants their conversation actually gone has no self-serve
way to do that today; it would require a manual admin/DB operation. This is the
single most important line in this doc — flag it before promising anyone
deletion.

## `firestore.rules` — messages read (investigated 2026-07-15, not fixed)

Current rule: any authenticated user can read the entire `messages` collection
(`allow read: if request.auth != null`) — this is issue #40's documented drift
(`useRealtimeMessages` subscribes directly from the client, bypassing the
API-route authz layer that every other read goes through).

**Investigated whether this can be tightened via rules alone — it can't,
without a data-shape change first.** Message docs carry only `session_id`, not
`project_id` (confirmed in `lib/types/index.ts` and every write site in
`app/api/chat/route.ts` etc.) — the project has to be looked up via
`sessions/{id}.project_id`. Firestore rules can `get()` that in one hop. The
real blocker is one level deeper: `project_members` rows are membership-role
lookups (auto-generated doc IDs, found by a `where(project_id, email/uid)`
query), and Firestore security rules cannot execute a `where` query to
authorize another query — only `get()`/`exists()` on a fully known document
path. So there's no rule that can ask "is this caller a member of this
project" without either:

1. Denormalizing a `member_uids`/`member_emails` array onto the `projects` doc
   (so the rule can do `request.auth.uid in get(projects/X).data.member_uids`),
   kept in sync across every write path that touches `project_members` — create,
   share/invite, role change, remove, restore, claim (~7 call sites found). Get
   this wrong on any one path and it fails open (stale array still lists a
   removed member) or fails closed (locks out a legit member) silently.
2. Or retiring the client-direct subscription entirely (#40's stated
   resolution) and reading messages through an authenticated API route the
   same way every other collection does — the route already has
   `getProjectRole()` to check membership correctly.

Did not implement either — (1) is a real migration with real risk of breaking
live maker chat if a write path is missed, (2) is a feature-sized change on its
own. `firestore.rules` is unchanged. Recommendation: treat this as tracked by
#40, do (2) when convenient, and don't attempt a partial rules-only fix.

## Retention

`prototype_context` (Loop captures) expire after 30 days via a daily cron
(`/api/cron/expire-captures`) that flags rows `status: 'expired'` — a flag, not
a delete, so old captures stop feeding the agent prompt but remain queryable.
Everything else has no retention policy; it lives until manually removed.
