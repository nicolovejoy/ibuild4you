# Prep Prompts Plan — `new-project` vs `next-convo`

## Why this exists

There are two distinct JSON payload shapes the builder copies between the iBuild4you UI and external Claude conversations:

1. **new-project payload** — used to create a brand-new project. Pasted into the Dashboard's "Import JSON" modal. POSTs to `/api/projects`. Has `title` (required), `requester_email`, names, etc.
2. **next-convo payload** — used to update an existing project's brief and agent config before the maker's next session. Pasted into the Brief tab's import field inside a project view. PATCHes the project and writes a new brief revision. Has no `title` or maker-create fields.

Today only one prep-prompt builder exists in code (`buildPrepPrompt`), and it targets the next-convo shape. The new-project payload is hand-crafted ad hoc, so receiving Claude conversations frequently confuse the two shapes and emit the wrong fields.

Additionally, the existing prompt has schema drift vs the actual API (missing fields, accepts fields the prompt doesn't document, etc.). See Section 4.

## The fix in one sentence

Introduce two clearly-named prep-prompt builders, surface each from its own "Copy" button next to the modal/tab that consumes its output, prefix every payload with a self-identifying `_payload_type` field at the very top, and lock the schemas down with tests.

## 1. Naming and labels

Everywhere in the codebase, the docs, and the user-facing UI, these two shapes are called by these exact names:

- **`new-project` payload** — for project creation (POST `/api/projects`)
- **`next-convo` payload** — for updating an existing project before the next conversation (PATCH `/api/projects` + new brief revision)

UI button labels:

- Dashboard "Import JSON" modal → new button: **"Copy new-project prep"**
- Brief tab inside a project view → relabel existing button from "Copy prep context" → **"Copy next-convo prep"**

Prompt builders in code:

- `lib/agent/new-project-prompt.ts` exporting `buildNewProjectPrompt()`
- `lib/agent/next-convo-prompt.ts` exporting `buildNextConvoPrompt()` (renamed from `lib/agent/brief-prompt.ts` / `buildPrepPrompt`)

## 2. Self-identifying JSON — `_payload_type` at the top

Both prompts instruct the receiving Claude to emit `_payload_type` as the FIRST key of the JSON output. The value is the literal string `"new-project"` or `"next-convo"`. This makes the blobs unambiguous at a glance, no matter where they're pasted.

Both import handlers (`handleImport` in `app/dashboard/page.tsx` and `handleImportJson` in `BuilderProjectView.tsx`) read `_payload_type` and:

- If it's present and matches the expected type, proceed.
- If it's present and doesn't match, refuse with a clear error: "This is a `new-project` payload — paste it into the Dashboard's Import JSON modal, not the Brief tab" (and vice versa).
- If it's absent, proceed (backward compatible with hand-rolled blobs and any external Claude that ignores the instruction).

The field is dropped before forwarding to the API — it's a routing hint, not stored data.

## 3. The two payload schemas

### `new-project` payload (POST `/api/projects`)

Required: `title`. All other fields optional. Source of truth: the POST handler in `app/api/projects/route.ts`.

Top-level fields documented in the prompt:

- `_payload_type` — literal `"new-project"`
- `title` (required)
- `requester_email`
- `requester_first_name`
- `requester_last_name`
- `context`
- `welcome_message` (alias: `session_opener` — both accepted)
- `nudge_message`
- `voice_sample`
- `identity`
- `session_mode` — `"discover"` or `"converge"`
- `seed_questions` — array of strings
- `builder_directives` — array of strings
- `layout_mockups` — array per CLAUDE.md shape
- `brief` — sub-object: `problem`, `target_users`, `features`, `constraints`, `additional_context`, `decisions`, `open_risks`

### `next-convo` payload (PATCH `/api/projects` + brief regen)

No `title`, no `requester_*`, no `context` (per current PATCH whitelist, `context` IS accepted by PATCH — see open question below).

Top-level fields documented in the prompt:

- `_payload_type` — literal `"next-convo"`
- `welcome_message` (alias: `session_opener`)
- `nudge_message`
- `voice_sample`
- `identity`
- `session_mode`
- `seed_questions`
- `builder_directives`
- `layout_mockups`
- `brief` — same sub-shape as new-project

## 4. Drift fixes folded in

These are the schema-vs-reality bugs the prior investigation surfaced. They get fixed as part of this same change.

- `buildPrepPrompt` (the soon-to-be `buildNextConvoPrompt`) currently omits `welcome_message` as a top-level field name (only uses `session_opener`), and omits `nudge_message`, `voice_sample`, `identity`, `seed_questions`. Add them.
- `handleImportJson` in `BuilderProjectView.tsx` does NOT accept `seed_questions` today, even though PATCH does. Add one line to accept it.
- POST `/api/projects` brief coercion (route.ts ~lines 475-491) drops `open_risks` from the initial brief shape, even though `brief.open_risks` is a first-class field elsewhere. Add it.
- `docs/mockup-system.md` line 79 inlines schema prose — replace with a pointer to `lib/agent/next-convo-prompt.ts` to avoid a fourth copy to keep in sync.
- `CLAUDE.md` Next Steps #9 — rewrite to reflect the fix landing (or remove if fully resolved).

## 5. Files changed

New:

- `lib/agent/new-project-prompt.ts` — exports `buildNewProjectPrompt(input)`. Takes optional context the builder already has (e.g. a stub title, requester name) so the prompt can pre-fill placeholders. Output instructs receiving Claude on the new-project schema with `_payload_type: "new-project"` at the top.
- `lib/agent/__tests__/new-project-prompt.test.ts` — lockstep tests (see Section 6).
- `lib/agent/__tests__/next-convo-prompt.test.ts` — renamed/extended from the (non-existent today) brief-prompt test. Lockstep tests.

Renamed:

- `lib/agent/brief-prompt.ts` → `lib/agent/next-convo-prompt.ts`
- Function `buildPrepPrompt` → `buildNextConvoPrompt`

Modified:

- `components/builder/BuilderProjectView.tsx`
  - Import path updates for the rename.
  - Button label "Copy prep context" → "Copy next-convo prep" (line ~676).
  - Helper text on line ~690 updated to reference the new name.
  - `handleImportJson` — accept `seed_questions`; check `_payload_type` and reject mismatched payloads with a clear message; strip `_payload_type` before forwarding.
- `app/dashboard/page.tsx`
  - Add "Copy new-project prep" button to the Import JSON modal (state: `prepCopied`, handler: copies `buildNewProjectPrompt({})` output to clipboard).
  - `handleImport` — check `_payload_type` and reject mismatched payloads; strip before forwarding.
  - Update placeholder/help text to mention the new prep button.
- `app/api/projects/route.ts` — POST handler brief coercion adds `open_risks`.
- `lib/api/briefs.ts` — uses `buildNextConvoPrompt` (import rename only).
- `docs/mockup-system.md` line 79 — pointer instead of inline prose.
- `CLAUDE.md` Next Steps #9 — rewrite or remove.

Explicitly NOT changing:

- No Zod, no shared schema constant, no JSON-Schema renderer. Each prompt hand-writes its schema block in plain TypeScript. Tests enforce lockstep with the consumers. Matches the project's "no clever abstractions" style.

## 6. Test strategy

One test file per prompt. Each file holds a constant list of expected top-level field names and asserts:

1. The prompt's output contains a top-level key for each expected field (regex match against the schema block).
2. The prompt's output begins (in the schema block) with `_payload_type` set to the right literal.
3. The corresponding import handler accepts every name in the expected list (verified by source-text grep, since `handleImport` / `handleImportJson` are inline in components today — see "small refactor" note below).
4. Brief sub-fields (`problem`, `target_users`, `features`, `constraints`, `additional_context`, `decisions`, `open_risks`) appear in both prompts' brief sections.

Plus one assertion in `app/api/projects/__tests__/create-project.test.ts`: a POST with `brief.open_risks` round-trips.

Small refactor to consider during this work (recommend yes, scoped tight): extract `handleImportJson` and `handleImport` into pure functions in `lib/api/import-payload.ts` (e.g. `parseNextConvoPayload`, `parseNewProjectPayload`). Lets the tests call them directly instead of grepping component source. Keep the React glue in the components as a one-liner that calls the pure function.

## 7. Implementation order

1. Write the doc (this file).
2. Add the failing tests for both prompts.
3. Rename `brief-prompt.ts` → `next-convo-prompt.ts`, update call sites, fix drift in the prompt body (add the missing fields). Test 1 turns green.
4. Create `new-project-prompt.ts`. Test 1 (its file) turns green.
5. Extract the two import handlers into pure functions in `lib/api/import-payload.ts`. Wire components to call them.
6. Add `_payload_type` handling in both pure functions (check, strip).
7. Add the "Copy new-project prep" button to the Dashboard modal.
8. Relabel "Copy prep context" → "Copy next-convo prep".
9. Fix `seed_questions` in the next-convo import handler.
10. Fix POST `open_risks` brief coercion.
11. Update `docs/mockup-system.md` and `CLAUDE.md` Next Steps #9.
12. Manual smoke test: hit both copy buttons, paste into a Claude conversation, ask for output, paste back into the matching import field; verify a mismatched paste is rejected.

## 8. Open questions

- **`context` in next-convo**: PATCH accepts `context` but the current `buildPrepPrompt` doesn't document it. Include it in the next-convo schema or not? Default: yes, include it — if the builder learned new background, they should be able to update it from the prep flow.
- **`identity` placement**: it's an agent persona override. Reasonable in both prompts. Confirm.
- **Payload-type strictness**: should a missing `_payload_type` warn (e.g. status banner "consider regenerating with the new prep") or just silently proceed? Default: silently proceed, no banner. Backward compatibility wins.
- **Renaming**: `brief-prompt.ts` is referenced from `lib/api/briefs.ts` (the brief regen path). The rename to `next-convo-prompt.ts` is fine semantically — that path IS preparing for the next convo. Confirm the rename doesn't read weird in `briefs.ts`.

## 9. Risk

Low. Adds one button, renames a file, fixes accepted fields, and adds a check that's permissive when omitted. No data migration. No breaking changes to the API. Old pasted JSON without `_payload_type` keeps working.
