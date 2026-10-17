# Proposal: improvements from the Tideline run (Oct 8–17, 8 sessions)

Source: the coding agent's eight-item list, filed as issues #213–#220 on
2026-10-17. This proposal says what we build, in what order, and where it
departs from that list. Nico's call on every departure.

## Principles

- The maker knows they are talking to Nico as well as to the agent. Copy may
  say plainly what Nico has or has not done ("Nico hasn't queued anything for
  this session yet"). No workflow-hiding.
- Keep the shipped posture rules: "looks good" = accept, address the maker as
  "you", verbatim welcome_message, decisions scoped to the question asked,
  conversation feedback only in session 1.
- Small items ship first so #213 never blocks them.

## Order

1. **#216 Import warning** + **#215 Prep title** — one warm-up PR.
2. **#218 Decision revisions** — small schema + merge change.
3. **#214 Stale-greeting guard** — small, touches session snapshotting.
4. **#213 Session rollup** — design doc, then plan. The big one.
5. **#217 Checks**, **#219 shipped/queued**, **#220 open questions** — one
   design pass, since all three change the brief/session shape and the prep
   export together.

## What each item builds

### #216 Import warning
On import, if the payload carries `seed_questions` while `session_mode` is
`converge`, or `builder_directives` while `discover`, show a non-blocking
warning naming the field and that it is stored but not sent. Import still
succeeds. (The list said "confirm it is done" — it is not; the import handler
has no warning today.)

### #215 Prep title
Not where the list assumed: the prep route already reads `projects.title`
and falls back to "your brief", never "Untitled". First step is a read-only
inspect of the Tideline project on prod to see what `title` holds. Then fix
whichever reader or writer is wrong.

### #218 Decision revisions
Decisions gain optional `revised_at` / `revised_in_session`. Original
`decided_at` / `decided_in_session` are never overwritten by regen or paste.
**Builder's call:** regen matches "same decision, refined" by `topic`
(case-insensitive, trimmed). A changed topic is a new decision. Imperfect but
deterministic; the model does not get to decide what counts as a revision.

### #214 Stale-greeting guard
When a maker opens a session that has no imported next-convo payload yet
(session config equals the previous session's, no new directives/seed
questions/welcome), the agent's opener says Nico has not queued anything for
this session yet and offers to take notes on whatever the maker wants to
raise. The builder gets an email (Resend, same channel as reminders).
If a payload is imported while that session is open and the maker has not
replied yet, the session re-snapshots its config from the payload and the
agent proceeds as if the payload had been there first.

### #213 Session rollup
Per project, sessions older than the last N (default 2, global)
are replaced in the agent's context by a rollup block: one paragraph per
session — what was asked, what the maker answered, which decisions it
produced, with session ids. The brief and the last N transcripts stay
verbatim. Decision provenance keeps pointing at original session ids.

- "Compact history" button on the dashboard generates the rollup and shows it
  to the builder for edit; nothing changes in agent context until saved.
- The maker sees no change.
- Rollup is its own stable system block so prompt caching still hits.

### #217 Checks as data
Optional `checks: [{id, text, options?}]` on the next-convo payload; options
default to Pass / Fail / Pass with notes. The session stores a cursor; the
agent presents the current check, records `{id, result, notes}` on the
session when answered, then moves to the next. Results show on the dashboard
session view and in the next prep export. `builder_directives` stay for
everything else.

### #219 Brief shape
Optional `shipped: [{date, items[]}]` and `queued: string[]` on the brief.
Prep export shows the last two shipped entries and the full queue.
`additional_context` goes back to being background.

### #220 Open questions for the maker
Dashboard view listing open risks owned by the maker, with copy-as-markdown.
**Departure:** derive from a typed `owner: 'maker'` field on `open_risks`
rather than a free-text "ask maker" tag — a tag the model forgets makes the
view silently empty, which recreates the stale-list problem this item exists
to fix. Regen prompt instructs the model to set `owner` where it can.

## Not included, or changed, from the agent's list

- **#213 automatic re-run "when sessions age out".** Not automatic. The same
  item asks for builder review before the rollup takes effect; an automatic
  re-run would change agent context with no review. Instead the dashboard
  shows a "history has N uncompacted sessions" nudge and the builder clicks
  Compact. Revisit if the nudge gets ignored.
- **#214 wording.** Kept the list's wording naming Nico. (My earlier
  suggestion to hide the builder's name is dropped on Nico's instruction.)
- **#217 "one per turn".** Softened to "one at a time": the agent stays on a
  check until it has a result, then advances. A maker answering two at once
  is recorded as two results, not pushed back.
- **#220 "ask maker" tag.** Replaced by the typed `owner` field (above).
- **Order.** The list said implement 1→8. This proposal front-loads the small
  ones; #213 is fourth.

## Decided by Nico (2026-10-17)

1. #213: N=2, global default, no per-project override.
2. #214: builder email on every stale-opened session, not once per gap.
3. #219 and #220 stay separate: `queued` is the builder's build list, open
   questions are what the maker owes.
