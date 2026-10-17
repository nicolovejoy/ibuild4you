# Brief tab as a ferry desk — design

2026-10-17. Agreed with Nico in a brainstorm (mock option B chosen).

## Intent

Nico's real use of the Brief tab is one loop: open a brief from the dashboard,
copy the next-convo prep, work it in an outside Claude, paste the resulting
JSON back, Import, leave. Today that loop is buried under a brief read view,
a three-row paste box, a structured editor, history, attachments and a
metered-API regen button that all compete for the page.

Make the ferry loop the whole page. Everything else stays reachable behind
one twiddle.

## Goals

- The page answers three questions at a glance, as stamps across the top:
  1. **Prep copied** — when Nico last copied the next-convo prep for this brief.
  2. **Payload pasted** — when a payload was last imported, with the brief
     version it produced.
  3. **Last maker activity** — when someone who is not builder-side last
     messaged (the existing `last_maker_message_at`), who, and which session.
     Highlighted when it is newer than the last paste: that is the "needs a
     ferry run" signal.
- One full-width paste box that fills most of the viewport (not 3 rows).
- Two actions under it: **Import** (primary) and **Copy next-convo prep**
  (secondary). A muted `Brief vN · session M` on the right.
- One **Details** twiddle, collapsed by default, holding: brief read view
  (with its edit mode and history), Copy markdown, Update from conversation
  (API regen), attachments.
- Esc returns to the dashboard. Already true via `useEscapeBack`, except when
  focus is in a text field; in the paste box, Esc on an empty box navigates,
  Esc on a non-empty box just blurs.
- Dashboard rows show the same two new stamps next to the existing maker
  activity line, and mark maker activity that is newer than the last paste.

## Non-goals

- No change to what the prep prompt contains or what Import accepts.
- No redesign of the Conversations / People / Setup tabs.
- No design-system adoption (prntd's is a persona document for a print shop;
  not transferable as-is). Stay on the current navy/cream tokens.
- No server-side derivation of the copy stamp; a clipboard write is a
  client event, stored the way `last_nudged_at` already is.

## Anti-goals

- Hiding the brief so well a builder cannot find it. Details must be one
  click, labelled, and list what it holds when collapsed.
- Losing the `autoOpenImport` hand-off from the dispatch modal (#115): it
  must still scroll to and focus the paste box.

## Data

Two new optional ISO fields on `projects`, client-set via PATCH (same pattern
as `last_nudged_at`):

- `prep_copied_at` — written after a successful clipboard write of the prep.
- `payload_pasted_at` — written after a successful Import (brief saved,
  and project config PATCHed when the payload carried it).

Both are UTC at rest and shown in Pacific (`Intl` with
`America/Los_Angeles`), per the shared convention. Relative time
("2 hours ago") sits under the absolute time.

"Newer than paste" = `last_maker_message_at > payload_pasted_at`, or maker
activity exists and nothing has ever been pasted.

## Decided how

- Presentational `FerryDesk` component (stamps + paste box + actions +
  Details shell) with the data-fetching logic staying in `BriefTab`.
- Pure helper for the stamp model so the "newer than paste" rule is tested
  once and shared by the Brief tab and the dashboard row.
- Textarea height via a viewport-relative min height, so it grows with the
  window; no resize handle needed beyond the browser default.

## Left to the builder

- Exact Tailwind spacing and the stamp card styling, within the existing
  `Card`/token vocabulary.
- Whether Details remembers its open state within the page session.
