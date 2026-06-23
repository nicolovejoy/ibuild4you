# Builder Setup dispatch — slice 2 (AI-written nudge + focus summary)

**Status:** Slice 1 SHIPPED in PR #82 (`feat/setup-dispatch-card`) — compact one-click
dispatch card (create session + email maker in one click), Edit-details collapse,
layout-mockups mothballed, dev/preview email gating. Focus line is an interim
mechanical derivation (`mode · first directive/seed`). Slice 2 replaces that + the
"terrible" boilerplate nudge with one Sonnet call.

## Goal

Replace the static `copy.nudge.body()` template (generic, dated) with a good,
up-to-date, in-voice "next session" email — and reuse the same call to produce the
card's one-line focus summary.

## Design (agreed with Nico)

**One Sonnet "prep" call** returns both:
- `nudge_message` — maker-facing email body
- `focus` — one-line builder-facing summary for the dispatch card

**Trigger: eager, at config-set time** (the moment the next-session payload lands —
JSON import / config save — NOT on send-button click). Pre-warm so both are already
sitting on the card when the builder arrives. Most responsive.

**Context fed to the model (this is what makes it "up to date"):**
- Brief so far (problem, features, decisions)
- Last session recap (what the maker just covered / where they left off)
- Next-session intent (session_mode + seed_questions/directives + opening message)
- `voice_sample` if set (optional per-brief override; see below)
- Maker first name + share link

**House tone (locked — use throughout outbound copy):** friendly + helpful, terse,
on-point, **2–3 sentences max**, clear, not over-detailed. Approved example:
> Hi Tom — ready for round 2 on the Koma advisory board. Last time you landed on
> Chris, Mark, and Nicholas; this round we'll pin down the ask for each and who to
> approach first. ~10 min whenever you've got them: [link]

**Voice:** bake the house tone as the system default NOW. Treat `voice_sample`
(already in the schema) as an optional per-brief override layered on later — not
required for slice 2.

## Wiring (mirror the existing `generateWelcome` opener generator)

- New prompt in `lib/agent/` + a route (e.g. `POST /api/projects/[id]/prep/generate`),
  using the same Anthropic client as brief/welcome generation.
- Store generated `{focus, nudge_message}` on the session (or project) when ready.
- **Non-blocking send:** card shows placeholder while generating — copy: `Summarizing… ✨ send anytime — you're CC'd.` (Nico leaned option A.) If the builder
  sends before generation finishes, fall back to the template; the polished version
  is stored for next time.
- **Precedence unchanged:** a manual `nudge_message` override still wins verbatim;
  generation only fills the default.
- **Fallback:** Sonnet error → silently use today's `copy.nudge.body()` template. No
  blank email, no builder-visible failure.
- Watch cost/loops (see the brief-regen runaway lesson — guard against repeated
  regeneration; generate once per config change, not per tick).

## Open/"""todo when resuming
- Decide storage field names + whether focus/nudge live on session vs project.
- Add the placeholder state to the dispatch card (PrepNextSession in
  `components/builder/BuilderProjectView.tsx`).
- Tests: prep-generate route (happy + fallback), tone/length guard if cheap.
