# Welcome-message replay fix (#70) — implementation plan

Approach **A** (approved 2026-06-14): stop canning the greeting on return; let the
live, state-aware agent handle it. Reject regenerating a canned opener per session.

## The bug (confirmed)
`welcome_message` is a static project field re-inserted verbatim as message-zero
every time a session is created (`app/api/sessions/route.ts:100-109`; also
`/api/projects` first-session and `/api/projects/share`). Sessions are created
two ways and both hit it:
- Builder clicks "new session" in Setup.
- Maker auto-creates one by sending when none is active
  (`MakerProjectView.tsx:324-338`) — so the canned "tell me about your idea"
  opener lands right after the maker already typed substance.

Kickoff (#31) deliberately abstains: a fresh session has no prior in-session
maker messages, so `app/api/chat/kickoff/route.ts` noops with `no_maker_history`.
Net: every new session = the same stale string, nothing else.

Root cause: one static field is doing two jobs — the **first hello** and **every
welcome-back** — and the first-hello copy is wrong for every return.

## Changes

### 1. Suppress the canned welcome on return (`app/api/sessions/route.ts`)
Insert the static `welcome_message` only for the project's **first** session.
For session 2+, insert no canned first message.
- Determine "first session": query existing sessions for the project (the POST
  already loads active sessions to complete them — extend to a count, or check if
  any session exists before this one).
- Leave `/api/projects` POST (first-ever session) and the create-on-share path
  unchanged — those are genuinely first contact.

### 2. Two return paths, both already state-aware
- **Maker-typed-to-create** (common): no canned message → the agent's normal
  reply answers their actual message using the brief + the existing "Returning
  after a break" recap block in `lib/agent/system-prompt.ts`. Naturally
  contextual; no extra greeting needed.
- **Builder pre-created an empty session** the maker opens without typing: relax
  the kickoff gate so it fires a generated, identity-aware recap. Change
  `lib/agent/kickoff.ts` `shouldKickoff` (and the server mirror in
  `app/api/chat/kickoff/route.ts`) from "needs prior maker messages **in this
  session**" to "needs prior maker history **in the project**". Pass project-level
  maker history into the decision (the kickoff route already loads the project).

### 3. Guard the true first-ever maker
A brand-new maker with no project history must still get the static welcome (or
the default), not a confused recap. The first-session branch in (1) covers this;
verify the kickoff relaxation in (2) checks project history, not just any session.

## Tests (TDD)
- `app/api/sessions` route: session #1 inserts the welcome message; session #2+
  inserts no canned message.
- `lib/agent/kickoff.ts`: fires on a fresh session when the project has prior
  maker history; does not fire for a true first-ever session.
- Keep the existing reload/multi-tab guards (`last_kickoff_at`) green.

## Don't regress
One-question-at-a-time elicitation, converge prompts, decision-framed session
summaries — all untouched.

## Verify
Preview with the backdated cast (`scripts/backdate-cast-session.mjs`): open a
2nd+ session and confirm the maker is greeted with a state-aware recap, never the
verbatim first-hello opener.
