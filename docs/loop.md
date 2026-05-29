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
| Widget (form) | `components/FeedbackWidget.tsx` |
| Launcher (corner button) | `components/feedback-launcher.tsx` *(in host apps; see below)* |
| Payload builder + validation | `lib/feedback/payload.ts` |
| Ingestion endpoint | `app/api/feedback/route.ts` (public, CORS-open) |
| Admin inbox | `app/admin/feedback/` |
| Convert to GitHub issue | `app/api/admin/feedback/[id]/to-github/route.ts` |

## Embedding Loop in a host app

The widget is a React component you **copy in**, not a script bundle. Two files
travel together:

1. Copy `components/FeedbackWidget.tsx` + `lib/feedback/payload.ts` into the host
   repo (`FeedbackType` is inlined in `payload.ts` so there's no iBuild4you
   dependency).
2. Render it, pointing `projectId` at an existing iBuild4you `projects.slug`:

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
a `projects.slug` in iBuild4you. Slugs are kebab-case (e.g.
`prntd-mobile-flow-rethink`, not `prntd`). Confirm the real slug with
`node scripts/with-prod-env-ro.mjs node scripts/list-projects.mjs --grep <term>`.

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

## Changing the contract

Additive fields are safe; renames/removals are an API version bump that every
embedder feels. The checklist for adding a field is in the
[wire contract](../lib/feedback/README.md#adding-a-new-field).
