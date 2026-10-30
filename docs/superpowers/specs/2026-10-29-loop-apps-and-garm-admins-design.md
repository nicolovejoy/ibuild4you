# Loop apps, app admins, and Garm as the authority — design

**Status:** approved by Nico 2026-10-29 (brainstorm + one builder-check
round). Supersedes the problem statement in #237 (musicforge #412). Phase A
plan: `docs/superpowers/plans/2026-10-29-loop-apps-phase-a.md`.

## Intent

Loop collects feedback for many apps (musicforge, tideline, photomirande,
byside, prntd, bakerylouise) and only Nico can read it, because Loop has no
idea of its own: it borrows the **brief**. To let a new app send feedback,
Nico asks iBuild4you for a sample payload, pastes it into "New brief", and
gets a dashboard row for a conversation that will never happen. The clumsiness
is a shape problem. Two different things share one record.

At the same time, Garm, the ecosystem's authorization service, is being used
as a mirror: iBuild4you keeps membership in Firestore and copies it into Garm
on every write, with an hourly repair job. A mirror costs upkeep and has
caused one lockout, while giving nothing a local allowlist would not.

This design fixes both with one model: **apps** are first-class, **app
admins** are a fact held once in Garm, and every app, including Loop, reads
that fact instead of keeping a copy.

## The mental model (decided with Nico, 2026-10-29)

- An **app** is a thing people use. It has a slug, a display name, and
  admins. Tideline, musicforge, photomirande and iBuild4you are apps.
- A **brief** is a conversation inside iBuild4you that may produce an app.
  A brief may point at the app it became. An app may exist with no brief.
  Most never have one.
- **Feedback belongs to the app**, never to the brief. Loop stops borrowing
  briefs entirely.
- **"Who administers which app" is one fact, held once, in Garm.** An app's
  own admin area asks Garm when someone signs in. Loop asks Garm the same
  thing to decide whose inbox a person sees. Add a friend as Tideline's admin
  once, and Tideline's admin pages and Tideline's feedback inbox both open
  for them. Remove them once, both close.
- **Garm holds existence and people; each app holds its own settings.**
  Garm's record of an app is small: slug, display name, owner, admins. Loop
  keeps a row per app for the things only Loop cares about (verified-identity
  requirement, GitHub repo for issue filing, signing secret), keyed by the
  Garm slug.
- **App owners may grant on their own apps.** The owner of Tideline can add
  a second Tideline admin without Nico. (Confirmed by Nico 2026-10-29,
  "good enough for now".)
- **Brief membership stays in iBuild4you.** A brief's maker, builder and
  apprentice roles are a conversation's cast, not app access. That table
  stays in Firestore and is out of scope here.

## Goals

1. Registering a new Loop participant is one action that creates an app with
   a name, a slug and (once Garm holds admins, Phase B) its first admin. No
   brief payload, no dashboard cruft. In Phase A the action takes slug and
   name only; `created_by` is provenance, not an admin list.
2. A person who administers an app can sign into Loop and see that app's
   feedback and nothing else, with reply and status change.
3. The same grant that opens Loop's inbox opens the app's own admin area, so
   musicforge's dashboard panel (#412) and Tideline's admin pages need no
   access model of their own.
4. Garm becomes the thing apps read, starting with Loop. No new mirrors.

## Non-goals

- The musicforge dashboard panel itself, or any host app's admin UI. Hosts
  read Garm and then read Loop with the same identity; what they draw is
  theirs.
- Replies or status changes from inside a host app. Those stay in Loop.
- Replacing brief membership (`project_members`) or the existing dual-write
  of brief members into Garm's `ibuild4you` project. Noted as a later
  cleanup once this design proves the read-only pattern.
- Howl alerting, aliases, OpenFGA. Garm's existing roadmap is untouched.

## Anti-goals (a failure even if it works)

- **Any copy of the admin list outside Garm.** Loop must never store "who
  administers app X", cache it beyond a request, or write it back to Garm
  from a local table. If Garm is down, the inbox says so; it does not fall
  back to a stale list.
- **App configuration leaking into Garm.** Garm never learns about GitHub
  repos, identity requirements, signing secrets or feedback settings.
- **A second copy of user feedback** in a host app's own database (musicforge
  option b). One store, no orphaned personal data.
- **A new brief per app.** Loop registration must not create a `projects`
  row.

## Constraints

- Garm is authorization only. It never sees a credential or session; every
  app keeps its own login. Garm has no UI; writes go through its HTTP API
  behind a single admin key today (`docs/build-plan.md`, decision 2 and the
  admin API section).
- Garm's locked contract today has **no project registry** ("unknown project
  simply resolves to no grant") and three roles, viewer < collaborator <
  owner. Consumer keys are scoped to one project slug. Changing either is a
  Garm decision, confirmed with Nico, not something iBuild4you improvises.
- iBuild4you sign-in fails closed on a Garm check for project `ibuild4you`.
  A Tideline admin with no `ibuild4you` grant cannot log in today.
- Loop's public ingest (`/api/feedback`) is CORS-open and gated on an exact
  slug match. Six slugs are live in production; the widget and the iOS
  sender on musicforge must keep working unchanged through the migration.
- Timestamps UTC at rest, Pacific on display. Reader-facing strings in
  `lib/copy.ts`, English and French.
- Communication: the plan goes to **prompt-lab**, which carries it to garm,
  tideline, musicforge and the rest. iBuild4you does not conduct the
  cross-repo change. Two courtesy replies (musicforge, tideline) were sent
  2026-10-29 saying "hold, plan coming via prompt-lab".

## What Garm needs (requirements for the garm repo, via prompt-lab)

Stated as needs, not designs. The garm session decides how.

1. **An app registry.** An app is a first-class record: slug, display name,
   created by, created at. Grants attach to registered apps. The existing
   "unknown project resolves to no grant" behaviour can stay for checks, but
   "which apps exist" must have one answer.
2. **List an app's admins** for an authorised reader: given a slug, the
   active grants with role, for display and for Loop's "Manage admins" page.
3. **A cross-app reader.** Loop must ask about every registered app, not one.
   Today a consumer key is scoped to a single slug. Either an unscoped
   reader key with a stated purpose, or a listing of "all apps where this
   email is owner or collaborator", with the same probing safeguards the
   alias work established.
4. **Delegated writes.** The owner of app X may grant and revoke on X. Garm
   has no login, so the write arrives through a consumer (first: Loop,
   because it is the only one with a UI) carrying the acting owner's email;
   Garm verifies the actor is an owner of that app before writing. Every
   write stays an audit row. Whether an owner may create another owner, and
   whether the single admin key keeps a superset of this, are Garm's calls.
5. **Role meaning for apps**, proposed, Garm's call: `owner` = admin, may
   grant; `collaborator` = may read and act on the app's feedback, may not
   grant; `viewer` = unused by Loop.

Until 1 to 4 exist, Loop's inbox stays admin-only. Nothing below in Phase A
depends on them.

## What iBuild4you builds

### Phase A — Loop stands on its own (no Garm dependency)

- A new `apps` collection: `slug` (document id, the Garm slug), `name`,
  `github_repo`, `feedback_requires_identity`, `brief_id` (optional link to
  the brief it came from), `legacy_slugs` (other `projectId` values live
  widgets still send; see migration), `created_by`, `created_at`. Slugs are
  kebab-case and unique across `apps.slug` and every `legacy_slugs` entry.
- `/api/feedback` resolves `projectId` against `apps.slug` or an app's
  `legacy_slugs`, not `projects.slug`. The wire contract is unchanged; the
  field keeps its name. Rows written under a legacy id are stored with the
  app's canonical slug in `project_id`.
- Briefs keep their own `projects.github_repo`: it feeds sibling-decision
  matching in the agent context (#142) and is a fact about the
  conversation's codebase. `apps.github_repo` is where Loop files issues.
  Two fields, two purposes, no sync between them (builder-check call).
- `feedback.project_id` stays as the column name (it is the app slug and
  always was); the type comment and docs say so.
- `loop_signing_secrets` keyed by app slug instead of the brief's document
  id. `scripts/loop-secret.mjs` takes the slug it already takes.
- Admin: a **New app** action (slug, name) in the Loop admin replaces the
  brief paste for Loop participants. An app page per slug shows its
  feedback, its settings, and (Phase B) its admins.
- Admin inbox: grouped or filtered by app, deep link per feedback item (host
  dashboards will link to one row).
- Migration script, read-first then `--apply`, driven by an explicit slug
  map (below), not by inference. Production state on 2026-10-29, feedback
  rows per `project_id`: musicforge 10, byside-validate-the-buyers-offer-to-
  close-journey 8, prntd-mobile-flow-rethink 6, bakery-louise 2,
  l6-shapes-positions-game 2, tideline 1, photomirande 1.
  - Cruft briefs that exist only to carry Loop: `tideline`, `photomirande`,
    `musicforge`. Their `apps` rows take the same slug; the script prints
    the brief ids for Nico to delete by hand. Never delete a brief in the
    script. (`tideline-sarahs-feedback` and `musicforge-web-craigs-…` are
    real briefs about those apps and may be linked via `brief_id`.)
  - Real briefs whose slug is used as a Loop id by a live widget:
    `byside-validate-the-buyers-offer-to-close-journey`,
    `prntd-mobile-flow-rethink`, `bakery-louise`, `l6-shapes-positions-game`.
    Each becomes an app under a short app slug, decided by Nico 2026-10-29:
    `byside`, `prntd`, `bakerylouise`, `l6-music` (the F4FC game). The brief
    slug goes in `legacy_slugs` and `brief_id` is set, so the widget keeps
    working until the host updates its `projectId`.
  - `loop_signing_secrets`: copy to the slug-keyed doc, keep the old doc
    until the host's next verified submission, delete in a later cleanup.
- `projects.feedback_requires_identity` moves to `apps` and is dropped from
  the PATCH allowlist and the setup JSON. `projects.github_repo` stays (see
  above).
- New-feedback email keeps going to `NOTIFICATION_EMAILS` in Phase A, titled
  with `apps.name`; Phase B sends it to the app's owners and collaborators
  as Garm lists them at send time. GitHub issue titles use `apps.name`.
- Docs: `docs/loop.md` and `lib/feedback/README.md` say "app slug", and the
  slug lookup command points at the new collection.

### Phase B — access through Garm (after Garm ships the needs above)

Plan: docs/superpowers/plans/2026-10-29-loop-apps-phase-b.md; host-facing read deferred.

- Sign-in gate: a person is admitted if Garm allows them on `ibuild4you`
  **or** they hold owner or collaborator on any registered app. One Garm
  call per sign-in, no fan-out.
- Loop inbox for a non-iBuild4you-admin: only the apps Garm says they hold,
  with reply, status, GitHub filing (if that app has a repo), and nothing
  else of the iBuild4you admin.
- App page, **Manage admins**: lists Garm's grants for the app; an owner may
  add or remove; the write goes to Garm through the delegated-write
  surface. Loop renders what Garm returns and stores nothing.
- Registering an app becomes: Loop creates the Garm app and its first owner
  grant, then its own `apps` settings row, in that order. If Garm refuses,
  nothing is created.
- Host-facing read: a host backend that already knows the signed-in user
  is an owner (because it asked Garm) can read that app's feedback from
  Loop. The exact surface (short-lived token minted by Loop, or the host's
  Garm-verified identity forwarded) is left to the Phase B plan; the
  requirement is that no long-lived per-project key ships to a host.

### Sequencing

Phase A is a normal iBuild4you PR and can start now. Phase B starts when
prompt-lab reports the Garm needs are live on production. The two phases are
separate plans; the first plan written from this document covers Phase A
only.

## Left to the builder

- Firestore shape details, indexes, and the admin UI layout for the app page.
- Whether `apps` lookup caches the slug set in memory for the public ingest
  (a slug list is not an admin list; caching it is fine).
- How the migration handles feedback rows whose slug matches no brief and no
  known widget.
- Test plan and e2e script shape, following `scripts/e2e-*.mjs`.

## Decided by Nico, 2026-10-29 (closing the builder-check round)

1. Owners grant on their own apps: yes.
2. The three cruft briefs (`tideline`, `photomirande`, `musicforge`) are
   deleted by Nico once their `apps` rows exist. None is a real brief.
3. iBuild4you is itself a Garm app under slug `ibuild4you`, today's system
   admins as owners. Phase B.
4. App slugs for the four brief-slug Loop ids: `byside`, `prntd`,
   `bakerylouise`, `l6-music`.
