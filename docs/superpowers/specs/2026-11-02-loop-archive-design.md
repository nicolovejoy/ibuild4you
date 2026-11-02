# #232 — clear test feedback out of the Loop inbox (design)

Approved by Nico 2026-11-02. Copied from the session spec
(`small-three-spec.md`, "#232") so the reference survives.

- **Archive** (soft): sets `archived_at` (ISO UTC) on the feedback doc; clearing it unarchives. Archived items are hidden by default from the inbox (`/admin/feedback`) and the per-app page (`/admin/apps/<slug>`), with a "Show archived" toggle. The doc and any linked GitHub issue stay.
- **Delete** (hard): removes the feedback doc. System admin only (not app owners/collaborators); the UI asks to confirm. A GitHub issue created from it is left alone (never touch GitHub).
- **Bulk**: checkboxes on the inbox and the per-app page; "Archive selected" and "Delete selected" (delete shown only to system admin). Selection only — no "all for this app" button.
- Check what other readers of the feedback collection exist (e.g. `GET /api/feedback/read` for host apps, contract `lib/feedback/READ.md`) and decide, as a recorded ruling, whether archived items are excluded there too. Deleted docs obviously vanish. Do not change the READ.md contract shape.
- Access control mirrors the existing feedback admin routes (`lib/api/feedback-access.ts`, app access via Garm in `lib/api/app-access.ts`).

## Controller rulings (2026-11-02)

1. Archived rows are also excluded from `GET /api/feedback/read` (host apps) and from Sam's prototype-feedback context (`lib/api/prototype-feedback.ts`). Archive means "this was noise"; a host dashboard or Sam seeing test rows is the problem #232 exists to fix. READ.md gets one sentence; its shape is unchanged.
2. The API takes `archived: boolean` on the existing PATCH; the server stamps `archived_at` (true) or sets it to `null` (false). No client-supplied timestamps.
3. Hard delete also deletes the row's `replies` subcollection docs (Firestore does not cascade; orphaned replies would be unreachable PII).
4. Bulk actions fan out per-row requests from the client (`Promise.allSettled`); no bulk endpoint. Selections are small; each row keeps its own access check.
5. "Show archived" lists archived rows alongside the rest (with an "Archived" badge) via `?include_archived=1`; with it on, the bulk bar also offers "Unarchive selected".
