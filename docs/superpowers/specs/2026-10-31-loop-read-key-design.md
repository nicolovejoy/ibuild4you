# Loop per-app read key (rough design)

Status: rough design agreed with Nico 2026-10-31. Not reviewed, not planned. Next session: review, plan, build (SDD).
Issues: ibuild4you #237, musicforge #412.

## Why

musicforge wants recent Loop feedback on its own admin dashboard (https://www.musicforge.org/dashboard). Since Loop Phase B, per-app admins (Garm owner/collaborator grants) already see their app in the Loop inbox; what is missing is a way for a host app's *server* to read its own feedback for a panel.

## Rule that shapes everything

Submitter email addresses stay in Loop. They may reach a human's eyes in Loop, but never pass through or get stored by a host app's server.

## Phase 1: read key + panel (build this)

- **Key.** On `/admin/apps/<slug>`, a "Read key" section: Mint / Rotate / Revoke. System admin only (Nico's call; app owners do not mint). Shown once; only a hash is stored. One live key per app. Server-to-server only, never in a browser.
- **Endpoint.** `GET /api/feedback/read?app=<slug>&limit=20&before=<cursor>`, `Authorization: Bearer <key>`. Newest first, limit max 50, paged by `before`. Wrong key, or a key for another app: the same 404. Read only.
- **Fields per item.** id, type, first line of the body, platform (derived from user_agent), created_at, status, Loop link `https://ibuild4you.com/admin/apps/<slug>?id=<feedbackId>` (deep link already works), and a sender tag.
- **Sender tag.** Loop stores no submitter name (the widget sends only an optional email). Tag = short keyed hash of the normalized email, e.g. "Sender 3f9a", using a server-only secret, so one person always gets the same tag and it cannot be reversed. No email: "anonymous". Clicking through to Loop shows who it is.
- **musicforge side.** Thin consumer: its server calls the endpoint and renders the panel. Post the contract on the `ibuild4you-musicforge` handoff channel once merged; musicforge closes #412 pointing at #237.

## Phase 2: embed spike (try after)

Frame Loop's per-app page (`/admin/apps/<slug>`) inside the host dashboard. The admin's browser talks to Loop directly with their own Loop sign-in and Garm grant, so full detail, replies and status changes work and the host server touches nothing. Risk to test: browsers partition a framed site's storage, so sign-in inside the frame may be needed once or repeatedly; also needs frame-ancestors/CSP allowing named host origins. If sign-in is tolerable, the embed may replace the panel.

Rejected: the host server vouching for its admin and Loop returning emails to it (addresses would transit the host server).

## Left to the builder

Secret names and where the hash/tag secret lives (1Password + Vercel Production; preview behaviour), key storage shape (likely on `apps` or `loop_read_keys/{slug}`), platform derivation rules, rate limiting, logging (never the key or an email), tests, and the musicforge-facing contract doc (probably next to `lib/feedback/README.md`).
