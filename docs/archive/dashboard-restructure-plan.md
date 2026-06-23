# #44 — Dashboard restructure: group briefs by role + turn-state

Status: **planned, not started.** Awaiting final clearance before coding.
Decisions locked 2026-06-13 (see "Decisions" below).

## Goal

Replace the flat dashboard list with role- and turn-state-aware sections, so the
briefs that need the viewer's action today float to a pinned action list, and the
rest organize by the viewer's stake (Originator / Reviewer / Contributor). Builds
on the brief-identity vocabulary (color/code/glyph) and the existing role + turn
badges.

## Decisions (locked)

1. **Grouping model: Hybrid.** A pinned cross-role **Awaiting you** section at top
   (today's action list), then role sections (**Yours** / **Reviewing** /
   **Contributing**) for everything not awaiting the viewer, then a collapsed
   **Done** section. Each brief appears in exactly one section.
2. **Scope: Phases 0–2 in one PR.** Defer the closed/role filter (Phase 3) to a
   separate follow-up (overlaps the backlog "Dashboard filter + sort" item).
3. **Audience: everyone, with low-N collapse.** Same grouping logic for makers and
   operators, but render a flat list (no headers) when there's effectively one
   bucket — a maker with 2 briefs sees no sections; multi-brief operators do.

## Current state (as found)

- `app/dashboard/page.tsx` (781 lines): `ProjectList` maps a flat
  `useProjects()` array, sorted server-side by `sortProjectsByActivity`.
- Card already renders: `BriefBadge` (identity), a role badge via
  `viewerBriefRole(project.viewer_role)`, and `TurnBadge` via `getTurnIndicator`.
- Dashboard themes by viewer: admin/builder = dark slate; pure maker = cream.

## Two data gaps that block honest grouping

1. **`enrichProjects` carries `viewer_role` but not `viewer_brief_role`.** The role
   badge therefore uses the access-tier *default* only — a Contributor (maker tier)
   mislabels as Originator. The projects GET (`app/api/projects/route.ts`) already
   loops the membership docs (which carry `brief_role`) to build the `viewer_role`
   map, so adding a parallel `viewer_brief_role` map is **zero extra Firestore
   reads**. The `Project.viewer_brief_role` type field already exists.
2. **`getTurnIndicator` returns only display strings** (label + className). Grouping
   by urgency would mean string-matching labels. Needs a machine-readable
   discriminant.

## Phase 0 — server plumbing (no UI)

- **Thread `viewer_brief_role` through `enrichProjects`.** In the projects GET list
  path, build a `viewerBriefRoles: Map<projectId, BriefRole|null>` from the same
  `memberSnap` / `memberByEmail` docs (`d.brief_role`). Pass into `enrichProjects`;
  set `viewer_brief_role` on each enriched project. Zero extra reads.
- **Add a turn-state discriminant to `getTurnIndicator`.** Return
  `state: 'your_turn' | 'waiting' | 'needs_setup' | 'completed'` alongside the
  existing `label` / `className` (non-breaking — existing callers ignore the new
  field). Pure function.
- Tests: enrich carries brief_role; turn-state mapping for each branch.

## Phase 1 — grouping engine (pure lib, TDD)

- New `lib/dashboard/group-briefs.ts`:
  `groupBriefs(projects, viewer) -> Section[]` where
  `Section = { key, title, briefs, emptyHint }`.
- Section assignment (each brief lands in exactly one), in priority order:
  1. **Awaiting you** — `turnState === 'your_turn'` (any role). Also catches
     `needs_setup` for operators (it's an action). TBD: keep needs-setup here vs.
     its own line — resolve in review.
  2. Else by stored brief role (`viewer_brief_role`, fall back to
     `viewerBriefRole(viewer_role)`): **Yours** (originator) / **Reviewing**
     (reviewer) / **Contributing** (contributor).
  3. **Done** — `status === 'completed'` (overrides all; collapsed by default).
- Within each section: sort by turn urgency, then `projectActivityKey` (reuse the
  existing activity sorter).
- **Low-N collapse:** expose `shouldFlatten(sections)` — true when ≥ all non-empty
  briefs fall in a single section, or total briefs ≤ a threshold (≈3). UI renders
  flat in that case.
- Fully unit-tested with fixture projects; no React.

## Phase 2 — UI sections

- `ProjectList` consumes `groupBriefs`. When `shouldFlatten`, render today's flat
  list unchanged. Otherwise render sections:
  - Section header: title + count (+ optional last-activity summary).
  - Empty sections show a one-line role hint ("nothing to review right now") —
    skip entirely for empty non-role sections to avoid clutter.
  - **Done** section collapsed behind a disclosure.
- Card markup stays; the role badge now reads `viewer_brief_role` (fixes the
  Contributor-as-Originator mislabel for free).
- New copy keys under `copy.dashboard` for section titles + empty hints (centralized
  per `lib/copy.ts` convention).
- Theming: section headers styled for both the dark console and cream maker views.

## Phase 3 — filter affordance (separate PR, deferred)

- "Show closed/Done", maybe a role filter. Merge with the backlog
  "Dashboard filter + sort" item.

## Out of scope (per issue #44)

- Renaming `MakerProjectView` / `BuilderProjectView` files (Phase 3d).
- API route renames.

## Risks / open questions for review

- Whether `needs_setup` belongs in "Awaiting you" or its own operator-only line.
- Exact low-N threshold for the flat-list collapse.
- Owned/shared-but-not-member briefs (admins): `viewer_role` is null in the map for
  those today, so they fall back to `reviewer` via `viewerBriefRole`. Confirm that
  bucketing reads sensibly for an admin viewing everything.
