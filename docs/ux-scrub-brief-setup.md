# UX scrub — Brief & Setup pages

**Status:** proposal / awaiting Nico. Written 2026-06-17 after the dispatch-card work
(slices 1+2 shipped). Scope: the builder's Brief and Setup surfaces + the share
modal + navigation. Method Nico asked for: assume every field should be **deleted
unless it justifies itself**, then propose a simpler UI including navigation.

No code changed. This is the plan to react to.

---

## TL;DR — what's actually wrong

1. **The Setup tab edits the same things three times.** `session_mode`,
   seed questions / directives, opening message, nudge override, and agent
   identity each appear in *both* the "Agent setup" card *and* the dispatch
   card's "Edit details" (identity a third time, nested under "Advanced").
   Two different Save paths ("Save setup" vs "Create & send"). This is the
   single biggest source of "shit."

2. **Four ways to share, none of them obviously the one.** Header, "Project
   ready" banner, "Invite a maker" card, and People-panel "+ Invite" all open
   the same modal.

3. **The Brief is read-only + a clipboard round-trip.** The only way to change
   it is copy-prep → paste into an outside Claude → paste JSON back → Import,
   or "Generate via API." Slices 1/2 just proved the app can do the AI work
   itself — the clipboard era is over, but the Brief tab still assumes it.

4. **The share modal re-introduces an established maker.** The screenshot that
   triggered this (a *session 3* contact) shows the first-time invite copy
   ("I'm putting together a brief… want your input to shape it") + passcode.
   Wrong tone for someone three conversations deep. "Give access" and "nudge
   for the next round" are two different jobs welded into one modal.

5. **Dead/stranded fields.** Layout mockups (editor exists, never rendered),
   voice sample (in schema, no UI), reviews/annotations (types only, no UI),
   "additional context" (low-signal dumping ground), github_repo (a Loop
   integration setting living in the maker-send flow).

---

## Principles for the redesign

- **One field, one home.** Nothing editable in two places.
- **One primary action per surface.** Hero button obvious; everything else is
  "Edit details" / "Advanced."
- **The AI writes the defaults; the builder overrides only when they care.**
  Opening message, nudge, focus — all generated. Overrides live behind a fold.
- **Navigation maps to the builder's actual loop:** read/shape the brief →
  send the next conversation → manage who's on it. Three jobs → three tabs.
- **Separate "access" from "nudge."** Giving a link+passcode is a one-time
  thing. Inviting them to the next round is the recurring dispatch action.

---

## Proposed navigation

Today: **Sessions · Brief · Files · Setup** (4 tabs; "Setup" is really
"configure agent" + "send next conversation" mashed together).

Proposed: **Brief · Conversations · People** (3 tabs).

```
┌──────────────────────────────────────────────────────────┐
│ ◐ Sam's Cafe App  ▾        [Waiting on Ryan]      ⌂  ◔   │   header
├────────────┬─────────────────────────────────────────────┤
│  BRIEF     │   ← the living document. inline-editable.    │
│  Convers.  │     "Update from conversation" button.       │
│  People    │     files/attachments live here.             │
│            │                                              │
└────────────┴─────────────────────────────────────────────┘
```

- **Brief** — the living document, now **inline-editable**, is the center of
  gravity. Files fold in here as an attachments strip (drop the separate Files
  tab). A compact "Send next conversation →" shortcut deep-links to Conversations.
- **Conversations** (was Sessions) — past conversations (read) **with the
  dispatch card pinned at the top**. The dispatch card is the home of all
  agent config (behind "Edit details"). This is where "send the next round"
  lives, invite or nudge.
- **People** (extracted from Setup) — roster, roles, access (link + passcode),
  invite. Replaces the share *modal* with a real panel. One share entry point.

"Setup" disappears as a name — it described a junk drawer, not a job.

---

## Setup tab — field-by-field verdict

Verdict legend: **KEEP** (earns prominence) · **DEMOTE** (keep behind a fold) ·
**MOVE** (belongs elsewhere) · **CUT** (delete).

| Field / control | Today | Verdict | Why |
|---|---|---|---|
| **Dispatch card** (Create conversation N & message {maker} / Copy) | hero | **KEEP** | This is the job. Slice 1/2 nailed it. Make it the top of Conversations. |
| AI **focus** line | on card | **KEEP** | Good at-a-glance. |
| "Agent setup" card (EditableSetup, full form + Save) | always visible | **CUT** | 100% duplicate of the dispatch card's Edit details. Delete the card and its separate save path. One config surface. |
| Session **mode** (Discover/Converge) | 2 places | **KEEP** (1 place, in Edit details) | Genuinely changes agent posture. But only the dispatch card's copy survives. |
| **Seed questions / directives** | 2 places | **KEEP** (1 place) | The main steering lever. Collapse to one mode-aware list ("What should this round focus on?"). |
| **Opening message** + Generate | 2 places | **DEMOTE** | AI-generated by default. Editable in Edit details only. Kill the duplicate. |
| **Nudge note** ("short hook woven in") | dispatch card | **CUT** | Redundant now that AI prep writes the nudge from brief+config. If the builder wants specific words, that's the override. |
| **Nudge override** | 2 places | **DEMOTE** (Advanced, 1 place) | Escape hatch only. AI writes the default. |
| **Agent identity** | 3 places | **DEMOTE** (Advanced, 1 place) | Rarely touched. |
| **Auto-reminders** toggle | setup card | **KEEP** (in Edit details) | Set-and-forget; worth keeping. |
| Reminder **status strip** | nested | **DEMOTE** | Useful but verbose. One line ("next reminder: …"), not the full breakdown. |
| **github_repo** | setup card | **MOVE** | A Loop/feedback integration setting, not maker-send config. Move to a brief-level settings spot (or admin). Out of the dispatch flow. |
| **Layout mockups** | data only, no UI | **CUT** | Already mothballed. Remove the dead data path when convenient. |
| **Voice sample** | schema only | leave as-is | Optional AI-tone override; keep JSON/advanced-only per slice-2 spec. Don't surface yet. |
| **JSON import** | Brief tab | **DEMOTE** | Power/bulk-create escape hatch. Tuck behind an "Import" affordance, not a primary surface. |
| "Project ready" banner | conditional | **CUT** | Transient confetti. |
| Post-import banner | conditional | **CUT** (or one subtle toast) | Same. |
| 4× share entry points | scattered | **CUT → 1** | Header (or People) is the single entry. |

**Net:** the Setup tab collapses into "the dispatch card at the top of
Conversations, with one Edit-details fold." Everything else either moves to
People, folds into Advanced, or dies.

---

## Brief tab — field-by-field verdict

The headline change: **make the brief inline-editable.** Click a section, edit
it, save. This kills the copy-prep → paste-JSON → import round-trip as the
primary path.

| Section / control | Today | Verdict | Why |
|---|---|---|---|
| Problem | read-only | **KEEP + edit inline** | Core. |
| Target users | read-only | **KEEP + edit inline** | Core. |
| Features (list) | read-only | **KEEP + edit inline** | Core. |
| Constraints | read-only | **KEEP + edit inline** | Core. |
| Decisions (topic→decision) | read-only | **KEEP + edit inline** | Core; the highest-value section. |
| Open risks (list) | read-only | **KEEP + edit inline** | Useful. |
| Additional context | read-only | **DEMOTE/CUT** | Low-signal catch-all. Hide when empty; consider removing. |
| Version badge (v3) | small | **KEEP** | Cheap, orienting. |
| "Copy next-convo prep" button | primary | **CUT** | Clipboard-era. Gone. |
| "Generate via API" + "Regenerate via API" (two buttons, same endpoint) | dual | **MERGE → 1** | One button: **"Update brief from conversation."** |
| JSON paste textarea | primary | **DEMOTE** | Move behind an "Import" affordance (advanced/admin). |
| "Copy markdown" | minor | **KEEP** (small) | Handy for sharing the brief out. |
| Reviews / annotations | types only, no UI | ignore | Out of scope; revisit if/when the editor lands (per the parked voice-attribution work). |
| Standalone `/brief` page | duplicate BriefView | **KEEP for makers** (read-only share view); builder edits in-tab. Unify the rendering. |

---

## People (replaces the share modal)

Today sharing is a dense modal that, for an established maker, wrongly shows
the **first-time invite** ("I'm putting together a brief… want your input")
plus the passcode. That's the screenshot Nico flagged.

Split the two jobs:

- **Access** (one-time, lives in People): the person's link + passcode, a
  "Resend access" action, role selector, "+ Invite" another person. Compact
  row per person. The big invite-message textarea shows **only on first
  invite**, never again.
- **Nudge / next round** (recurring, lives in the dispatch card): the AI-written
  nudge (slice 2). This is how you contact an established maker — not by
  re-opening the invite modal.

```
People on this brief                              [ + Invite ]
─────────────────────────────────────────────────────────────
 Ryan Sawyer   ryanpsawyer@gmail.com    [Originator ▾]
   link ⧉   passcode I3F75W ⧉ ↻   ·   Resend access
─────────────────────────────────────────────────────────────
```

The "contact Ryan for session 3" action moves entirely to the dispatch card,
where the message is the AI nudge, not the invite boilerplate.

**Bug to fix regardless of redesign:** for a maker who's already several
conversations in, the "contact maker" path should use the dispatch nudge, not
`copy.invite.body()`. Right now the share modal's confirmation view re-serves
the invite copy + passcode for anyone already shared.

---

## Suggested phasing (each shippable on its own)

1. **Kill the duplication.** Delete the "Agent setup" (EditableSetup) card;
   the dispatch card's Edit details becomes the only config surface. Remove the
   nudge-note field. Collapse share entry points to one. *(Biggest win, lowest
   risk — pure deletion + consolidation.)*
2. **Rename nav → Brief · Conversations · People.** Move the dispatch card to
   the top of Conversations; extract People from Setup; fold Files into Brief.
3. **Inline-edit the brief.** Per-section click-to-edit + one "Update from
   conversation" button; demote JSON paste to an Import affordance.
4. **People panel replaces the share modal**; fix the established-maker
   invite-vs-nudge bug; move github_repo out of the send flow.
5. **Cleanup:** remove dead layout-mockups path; hide empty "additional
   context."

---

## Open questions for Nico

1. **Tab names.** Comfortable with **Brief · Conversations · People**? Or keep
   "Sessions" over "Conversations"? (Maker-facing vocab is "brief"; "session"
   is internal — leaning Conversations.)
2. **Where does the dispatch card live** — top of **Conversations** (my pick),
   or pinned on the **Brief** page so you shape-then-send in one place?
3. **Files** — fold into Brief as an attachments strip (my pick), or keep a
   4th tab?
4. **Inline brief editing** — do you want full click-to-edit on every section
   (slice 3), or is "Update from conversation" + occasional JSON import enough
   for now? Inline editing is the most work.
5. **github_repo / voice sample / mockups** — OK to move github_repo to a
   small "Brief settings" area, leave voice sample JSON-only, and delete the
   mockups data path? Or keep any of them surfaced?
6. **Additional context** — cut it, or keep hidden-when-empty?
```
