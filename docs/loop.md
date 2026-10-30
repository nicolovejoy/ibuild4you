# Loop — the feedback mechanism

**Loop** is iBuild4you's lightweight feedback channel. A small widget embedded
on a host app lets that app's users send bug reports, ideas, and notes; they
land in the iBuild4you admin inbox at `/admin/feedback`, where a builder can
triage them and convert any one into a GitHub issue. It closes the loop between
the people using a built app and the builder iterating on it.

This doc is the **home / overview**. The byte-level request/response spec lives
with the code at [`lib/feedback/README.md`](../lib/feedback/README.md) (the
"Feedback wire contract") — it's colocated with `lib/feedback/payload.ts`
because the widget and payload helper are meant to travel together. Update the
wire contract there when the contract changes; update this doc when the
how-to-embed or triage story changes.

## Moving parts

| Piece | Where |
| ----- | ----- |
| Widget (form) | `lib/feedback/reference/FeedbackWidget.tsx` |
| Launcher (corner button) | `components/feedback-launcher.tsx` *(in host apps; see below)* |
| Payload builder + validation | `lib/feedback/payload.ts` |
| Ingestion endpoint | `app/api/feedback/route.ts` (public, CORS-open) |
| Admin inbox | `app/admin/feedback/` (all apps) and `app/admin/apps/` (app list, New app, per-app settings + inbox; deep link `/admin/apps/<slug>?id=<feedbackId>`) |
| Convert to GitHub issue | `app/api/admin/feedback/[id]/to-github/route.ts` |

## Embedding Loop in a host app

The widget is a React component you **copy in**, not a script bundle. Three
files travel together:

1. Copy `lib/feedback/reference/FeedbackWidget.tsx` + `lib/feedback/payload.ts` +
   `lib/feedback/capture.ts` into the host repo. Two `@/` imports need
   replacing in the copies: `FeedbackType` from `@/lib/types` (inline
   `type FeedbackType = 'bug' | 'idea' | 'other'` in `payload.ts`) and
   `normalizeEmail` from `@/lib/email/normalize` (inline a trim + lowercase).
   `capture.ts` is the #72 structural page snapshot — plain DOM APIs, zero
   deps. `'use client'` is a Next directive; drop it outside Next.
2. Render it, pointing `projectId` at an iBuild4you app slug (`apps.slug`, or one of its `legacy_slugs`):

   ```tsx
   <FeedbackWidget
     projectId="your-project-slug"
     endpoint="https://ibuild4you.com/api/feedback"
   />
   ```

   Render it in the host's root layout so it works on every page and captures
   the page URL with each submission.

3. Optional: set `NEXT_PUBLIC_FEEDBACK_PROJECT_ID` in the host app and read it
   into `projectId`, so the slug isn't hardcoded. (Public value — fine as a
   `NEXT_PUBLIC_` var.)

If you'd rather POST directly instead of using the component, the exact body,
anti-abuse rules (honeypot, render-time `_ts` window, rate limit, slug gate),
and responses are all in the [wire contract](../lib/feedback/README.md).

### The slug must exist

`/api/feedback` returns `404 Unknown project` unless `projectId` exactly matches
an app slug in iBuild4you (`apps.slug`, or one of that app's `legacy_slugs`, which
older widgets keep posting). Feedback is always stored under the app's canonical
slug. Slugs are kebab-case (e.g. `byside`). Create the app at `/admin/apps` (New app) before the widget goes live. Confirm the real slug with
`node scripts/with-prod-env-ro.mjs node scripts/list-apps.mjs`.

### Verified identity (#149) — host recipe lands in a follow-up PR

By default, `submitterEmail` is self-reported (a submitter can type anything,
or nothing). If a host app has real login and wants attributed feedback, its
**server** can sign a short-lived assertion vouching for the logged-in user's
email and hand it to the widget as the `identityAssertion` prop/field — the
widget never signs anything itself. Verified submissions bypass the rate
limit and, if the app turns on `feedback_requires_identity` (#150; `apps.feedback_requires_identity`, set at `/admin/apps/<slug>`),
unverified submissions are rejected outright.

The token format, freshness rules, and verification contract are documented
in [`lib/feedback/README.md`](../lib/feedback/README.md#the-identityassertion-field-149)
and implemented in `lib/feedback/identity.ts`. Per-project secrets are minted
with `scripts/loop-secret.mjs` (CLI-only — no admin-UI reveal). The
**host-side integration recipe** (a Next.js route handler example the host
app copies in to mint tokens server-side) is a separate follow-up PR — this
repo only ships the verification side and the signing primitives.

## Triage + Convert to GitHub

Submissions appear at `/admin/feedback` (admin-gated) with status, internal
notes, and a **Convert to GitHub issue** button. For that button to work on a
given project:

1. The project needs a `github_repo` set (`owner/name`). Set it from the
   builder's **Agent setup** panel ("GitHub repo" field), or via PATCH
   `/api/projects`.
2. The server's `GITHUB_TOKEN` (fine-grained PAT) must have `Issues: Read &
   write` on that repo. The PAT's repo scope is managed on GitHub — add new host
   repos there or the conversion 500s.

## Who can see an app's feedback

- System admins (`ADMIN_EMAILS`) see every app, independent of Garm.
- Anyone else needs a Garm grant on the app: `owner` or `collaborator` sees that
  app's inbox, replies, sets status and files GitHub issues. They can sign in
  with just that grant and see nothing else of the iBuild4you admin.
- Each app's people are listed under "Your apps" (dashboard and user menu) and at
  `/admin/apps/<slug>`.

### Adding or removing an admin

An app owner (or a system admin) opens `/admin/apps/<slug>`, **Manage admins**,
and adds an email as `owner` or `collaborator`, or removes one. This writes to
Garm directly.

### The admin list lives only in Garm

Loop keeps no copy of it: no Firestore field, no cache beyond a 60 s sign-in
yes-answer. Every check asks Garm (`lib/garm-loop.ts`, key `GARM_LOOP_KEY`) and
fails closed if Garm is unreachable. New-feedback email goes to
`NOTIFICATION_EMAILS` plus the app's Garm owners and collaborators. Read-only
check: `GARM_LOOP_KEY=op://dev-secrets/garm-consumer-loop/password op run -- node scripts/garm-loop-smoke.mjs`.
A host app reading its own feedback from Loop is not built yet.

## Changing the contract

Additive fields are safe; renames/removals are an API version bump that every
embedder feels. The checklist for adding a field is in the
[wire contract](../lib/feedback/README.md#adding-a-new-field).
