# Garm kickoff — start here next session

Nico's verbatim kickoff prompt for the Garm initiative (pasted 2026-07-13, to start **next** session). **Read `~/src/prompt-lab/docs/garm-needs-assessment.md` in full first, then come back with a proposed build plan before writing any code.** New security-sensitive standalone repo — plan + confirm, don't improvise.

Related context already on disk:
- Full spec: `~/src/prompt-lab/docs/garm-needs-assessment.md`
- Assignment note (how this got decided): top of `~/src/.handoff/ibuild4you-prompt-lab.md` (`## Active`)
- Prior memory: `reference_garm` (in this project's auto-memory)

---

You're starting a new initiative: Garm, a centralized per-repo, per-user
authorization service for Nico's project ecosystem (~15 repos). This
session should scaffold it as a new standalone repo and wire ibuild4you
as its first real consumer.

Design principle (already decided, do not relitigate): centralize
authorization, not identity. Every app — including ibuild4you — keeps
its own login/identity mechanism exactly as it is today. Garm's only
job is centralizing the mapping (email, project) -> role (role is one
of viewer/collaborator/owner; project can be "*" as a wildcard for "all
projects"), served via an authz-check endpoint at /gnipahellir. Howl is
a separate alerting/audit channel (denial anomalies -> Resend email
and/or an event) — not built yet, lower priority than the core mapping.

Read the full spec first, it's not this message: read
~/src/prompt-lab/docs/garm-needs-assessment.md in full before doing
anything else. Condensed version of why ibuild4you was picked over
byside (the other real candidate, surveyed in that doc): ibuild4you
already has the closest literal match to Garm's target shape — your own
project_members table is effectively a hand-rolled (email, project) ->
role mapping (roles: maker/apprentice/builder/owner). byside's role
system is cleaner (one flat table, no PII entanglement) but
structurally less similar to what Garm needs to become.

Two things flagged in that survey are ibuild4you-specific and should be
resolved before or alongside this work, not ignored:
1. /api/auth/passcode matches email+passcode together — a passcode
   shared to the wrong person currently logs them in AS that person.
   Decide explicitly: are passcode-holders going to be real Garm role
   subjects (they get a proper identity), or app-local guests that stay
   invisible to Garm entirely? This choice shapes the rest of the
   integration.
2. project_members today conflates four things in one row: identity
   credential (plaintext passcode), authz (role), PII (names), and
   per-viewer state (archived_at, brief_role, removal lifecycle from
   issue #106). A Garm migration only takes the role column — the rest
   needs to be split apart first.

What to build — propose a plan and confirm with Nico before
implementing (new repo, security-sensitive service, not a quick
script):
1. A new standalone repo, garm. Do not build this inside ibuild4you —
   it needs to serve every app in the ecosystem, not just this one.
2. Core schema: (email, project, role) rows, role in
   viewer/collaborator/owner, project = "*" as the any-project
   wildcard. Keep this generic — do NOT add ibuild4you-specific
   concepts like per-brief roles or turn-state into Garm itself. Those
   stay local to ibuild4you, layered on top of whatever coarse role
   Garm returns.
3. The /gnipahellir endpoint: given a caller's email + project, return
   the role, or none. Design the auth on this endpoint itself
   carefully — it's the thing every other app will end up trusting.
4. A people-admin capability (create/update/remove (email,project,role)
   rows) — API only for now; a UI is planned separately inside
   prompt-lab's own dashboard (prompt-labs.org), not part of this build.
5. Wire ibuild4you itself as the first consumer: replace (or sit
   alongside, your call after resolving the passcode question above)
   the approved_emails + project_members role lookup with a call to
   Garm's /gnipahellir.

When you make progress or hit a decision point, log it back so the
wider effort stays visible — append to the cross-repo handoff file:

~/.claude/bin/handoff.sh append ibuild4you-prompt-lab.md "### YYYY-MM-DD ibuild4you to prompt-lab: <subject>

<body>"

(That file already has today's assignment note at the top of ##
Active, for full context on how this got decided.)

Start by reading ~/src/prompt-lab/docs/garm-needs-assessment.md in
full, then come back with your proposed build plan before writing any
code.
