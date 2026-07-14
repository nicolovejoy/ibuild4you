# Garm — status & pointers

Garm = centralized **authz** (not identity) for the ecosystem: `(email, project) → role` (viewer/collaborator/owner, `*` wildcard), checked via `POST /gnipahellir`. Every app keeps its own login. Assigned to ibuild4you 2026-07-13 (prompt-lab #24).

## Status (2026-07-13)

- **Planned + built (phases 0–3)** in the standalone repo: https://github.com/nicolovejoy/garm (private, `~/src/garm`). Next.js API-only + Drizzle → Neon + PGlite-backed tests; 76 tests green. **Do not edit that repo from ibuild4you sessions — relay change requests through Nico to the garm agent.**
- **Phase 4 pending** (that session): Vercel project + Neon via Marketplace, migrations, mint the `ibuild4you` consumer key, live smoke.
- **This repo's work** (passcode retirement + gnip consumption): `docs/garm-consumer-plan.md` — PRs A–H, open questions at the bottom awaiting Nico.

## Pointers

- Contract + locked decisions: `~/src/garm/docs/build-plan.md`
- How to consume (reference client, 60s TTL, fail-closed, env `GARM_URL`/`GARM_KEY`): `~/src/garm/docs/consuming.md`
- 7-repo needs assessment (spec source): `~/src/prompt-lab/docs/garm-needs-assessment.md`
- Decision log: cross-repo handoff `~/src/.handoff/ibuild4you-prompt-lab.md`

## Key decisions (locked)

- Centralize authorization, not identity; consumers gate on `allowed`, never the role string (keeps an OpenFGA swap possible — bespoke v1 is explicitly the intermediate step; OSS engines surveyed + rejected at this scale 2026-07-13).
- ibuild4you retires passcodes entirely → makers on Google/password (#104 machinery). All Garm subjects are email-keyed real identities.
- Role mapping: owner→owner, builder→collaborator, maker/apprentice→viewer; per-brief roles/turn-state/names stay local.
