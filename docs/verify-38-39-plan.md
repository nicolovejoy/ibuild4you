# Verify #38 (PDF upload) + #39 (prep-prompt ferry)

Both are code-complete (resync 2026-06-25, HEAD `3104fe4`); what's left is
runtime validation. #38 is fully automatable; #39 is split — mechanical half
automatable, posture half goes through the Max-sub ferry (Nico).

Issues: https://github.com/nicolovejoy/ibuild4you/issues/38 ·
https://github.com/nicolovejoy/ibuild4you/issues/39

## Phase 1 — #38 PDF upload (agent self-verifies on preview)

Cache-control logic: `lib/agent/attachments.ts:17-20` (≤1 `cache_control`
marker per attachment message; Anthropic 400s past 4 markers). Usage surface:
`/admin/usage` → "cache r" column (reads `api_usage` Firestore collection).

Preview chat hits real Anthropic (`ANTHROPIC_API_KEY` is on Vercel preview) and
writes `api_usage` to the preview sandbox Firestore — safe to exercise.

Steps (new `scripts/e2e-38-pdf-upload.mjs`, headless Playwright as test admin):
1. Generate 3 tiny PDFs, each with a distinct known sentence (e.g.
   "The mango ledger reconciles on Tuesdays.").
2. Login on `https://preview.ibuild4you.com`, open a sandbox brief's maker chat.
3. Drop all 3 PDFs in ONE message (composer drop / file input in
   `components/maker/MakerProjectView.tsx`), send "Summarize each document I
   attached, one line each, and name the file."
4. Assert the streamed reply contains all 3 known sentences (cites, not
   hallucinates) AND no error envelope (no Anthropic 400 — would surface via the
   `errorMessageFromResponse` path).
5. Send a 2nd turn; query preview `api_usage` for this session/project and
   assert `cache_read_input_tokens > 0` on the 2nd request (cache hit).

Tune-if-needed: if the agent ignores/hallucinates the PDFs, reinforce in
`lib/agent/system-prompt.ts` ("the user has attached files; reference them by
name when they answer your questions"), re-run.

Exit: all 3 cited + no 400 + cache hit on turn 2 → close #38.

Manual fallback (if Nico runs it): same steps in a browser at
`https://preview.ibuild4you.com`, then check the "cache r" column at
`https://preview.ibuild4you.com/admin/usage` (or prod `/admin/usage` if testing
prod). Pass = agent quotes all 3 PDFs, no error bubble, cache r > 0 on turn 2.

## Phase 2 — #39 prep-prompt ferry (mechanical: agent · posture: Nico)

The split = two builders: `lib/agent/new-project-prompt.ts` (new brief) and
`lib/agent/next-convo-prompt.ts` (existing project). #39's eight cases permute
config; verification splits in two.

NOTE: the SHA in #39's body (`21f4c10`) is stale — that's a docs commit. The
real split lives in the two files above.

Mechanical half (agent — new `scripts/snapshot-prep-prompts.mjs`):
Build the ferry prompt for all 8 permutations and assert structure:
1. New-brief (empty brief, no sessions) — new-project flow
2. Next-convo, existing project with 1+ sessions
3. Seed questions + directives populated
4. Empty seed questions + directives
5. `discover` mode
6. `converge` mode
7. Builder `identity` set
8. Non-trivial `brief.decisions` array
For each: assert the prompt embeds the configured fields (mode string, seeds,
directives, decisions, identity) and omits what's unset. Snapshot to catch
future regressions in the split.

Paste-back check (agent): feed a representative valid JSON payload through
`lib/api/brief-json.ts` validator + `PUT /api/briefs`; assert accepted and the
session opens. (Import path already tested; this just confirms the ferry's
return shape round-trips.)

Posture half (Nico, Max sub — can't automate, cost-routed by design):
For 3 representative cases — (a) empty new-brief, (b) converge + identity,
(c) discover + non-trivial decisions — copy the ferry prompt, paste into
Claude.ai, paste the returned JSON back via the Brief tab raw-JSON editor,
confirm the dashboard accepts it and the session opens with the expected agent
posture.

Exit: 8/8 prompts well-formed + paste-back accepted (agent) + 3/3 posture
spot-checks good (Nico) → close #39.

## Order

Phase 1 first (fully automatable, fast, most likely to surface a real bug),
then Phase 2.
