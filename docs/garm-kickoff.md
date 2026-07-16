# Garm — status & pointers

Garm = centralized **authz** (not identity) for the ecosystem: `(email, project) → role` (viewer/collaborator/owner, `*` wildcard), checked via `POST /gnipahellir`. Every app keeps its own login. Assigned to ibuild4you 2026-07-13 (prompt-lab #24).

## Status (2026-07-15)

- **Garm service: DONE and live** — https://garm.prompt-labs.org (canonical). Phases 0–4 complete + Howl v1 (daily denial digest). Repo https://github.com/nicolovejoy/garm (private, `~/src/garm`); 119 tests green. **Do not edit that repo from ibuild4you sessions — relay change requests through Nico to the garm agent.** Nothing on the Garm side blocks us.
- **This repo's work**: `docs/garm-consumer-plan.md` — read its "Numbering" table first; the handoff channel's "1/4…4/4" track and the plan's "Phases 1–5 / PRs A–H" are two views of overlapping work.
  - **Done:** 1/4 client (`lib/garm.ts`), 2/4 seed (`scripts/garm-seed-grants.mjs`, 32 grants live).
  - **Blocked:** 3/4 cutover, gated on passcode retirement (plan Phases 1–3, **not started**) — a live passcode route is a second front door that never asks Garm.
  - **Live decision:** whether to start Phase 1 / PR A now. It's the long pole and has no Garm dependency.

## Pointers

- Contract + locked decisions: `~/src/garm/docs/build-plan.md`
- How to consume (reference client, 60s TTL, fail-closed, env `GARM_URL`/`GARM_KEY`): `~/src/garm/docs/consuming.md`
- 7-repo needs assessment (spec source): `~/src/prompt-lab/docs/garm-needs-assessment.md`
- Decision log: cross-repo handoff `~/src/.handoff/ibuild4you-prompt-lab.md`

## Key decisions (locked)

- Centralize authorization, not identity; consumers gate on `allowed`, never the role string (keeps an OpenFGA swap possible — bespoke v1 is explicitly the intermediate step; OSS engines surveyed + rejected at this scale 2026-07-13).
- ibuild4you retires passcodes entirely → makers on Google/password (#104 machinery). All Garm subjects are email-keyed real identities.
- Role mapping: owner→owner, builder→collaborator, maker/apprentice→viewer; per-brief roles/turn-state/names stay local.
