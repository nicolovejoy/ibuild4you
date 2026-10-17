# Import warning + prep title Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Warn on next-convo import when `seed_questions` / `builder_directives` will be ignored for the effective mode (#216), and stop the Brief tab's "Copy prep context" from emitting `Title: Untitled` (#215).

**Architecture:** A pure warnings function next to the existing payload parser (`lib/api/import-payload.ts`) decides the warning text; the Brief tab shows it inline and stays put instead of auto-switching tabs. The prep-title fix removes a silent `|| 'Untitled'` fallback in the Brief tab's copy handler: the button is disabled until the project record is loaded and the real title is always used.

**Tech Stack:** Next.js App Router, React, vitest (node environment, so no component tests), Tailwind.

**Spec:** `docs/proposals/2026-10-17-tideline-improvements.md` sections "#216 Import warning" and "#215 Prep title".

## Global Constraints

- All user-facing text goes in `lib/copy.ts` (existing `copy.brief` section).
- Import must still succeed when a warning fires; the warning is informational.
- Mode scoping is the #192 rule: `seed_questions` are sent only in `discover`, `builder_directives` only in `converge`. Effective mode = payload `session_mode` if present, else the project's current `session_mode`, else `discover`.
- Before claiming clean, run both `npm run build` and `npm run type-check` (they cover different things, see CLAUDE.md).
- Commit messages end with `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.

## Review Focus

1. Payload sets `session_mode: 'converge'` *and* `seed_questions` while the project is currently `discover`: the payload's mode wins, so warn about seed questions. (Task 1 test.)
2. Payload carries an empty array `seed_questions: []` under converge: no warning, nothing is being ignored. (Task 1 test.)
3. Brief-only (legacy) paste: no projectUpdate, so no warnings and the old auto-switch still happens. (Task 1 test + Task 2 code path.)
4. Both fields present under one mode: exactly one warning (for the field that is ignored), never two. (Task 1 test.)
5. Copy prep context clicked while the project query is still loading or errored: button disabled, never a clipboard write with a placeholder title. (Task 3; verified by build + manual preview since vitest runs in node.)

---

### Task 1: `nextConvoImportWarnings` pure function

**Files:**
- Modify: `lib/api/import-payload.ts` (append after `parseNextConvoPayload`)
- Test: `lib/api/__tests__/import-payload.test.ts` (append a `describe`)

**Interfaces:**
- Produces:
  ```ts
  export type SessionMode = 'discover' | 'converge'
  export function nextConvoImportWarnings(
    projectUpdate: Record<string, unknown>,
    currentMode: SessionMode | undefined,
  ): string[]
  ```
  Returns the warning strings to show. Text comes from `copy.brief.importIgnoredSeedQuestions` / `copy.brief.importIgnoredDirectives` (Task 2 adds them; Task 1 may add them to `lib/copy.ts` first since the test asserts on substrings, not full copy).

- [ ] **Step 1: Write the failing tests**

```ts
describe('nextConvoImportWarnings', () => {
  it('warns about seed_questions when the effective mode is converge', () => {
    const w = nextConvoImportWarnings({ seed_questions: ['q'] }, 'converge')
    expect(w).toHaveLength(1)
    expect(w[0]).toMatch(/seed questions/i)
    expect(w[0]).toMatch(/converge/i)
  })
  it('warns about builder_directives when the effective mode is discover', () => {
    const w = nextConvoImportWarnings({ builder_directives: ['d'] }, 'discover')
    expect(w).toHaveLength(1)
    expect(w[0]).toMatch(/directives/i)
    expect(w[0]).toMatch(/discover/i)
  })
  it('uses the payload session_mode over the current mode', () => {
    const w = nextConvoImportWarnings({ session_mode: 'converge', seed_questions: ['q'] }, 'discover')
    expect(w).toHaveLength(1)
    expect(w[0]).toMatch(/seed questions/i)
  })
  it('defaults to discover when neither payload nor project has a mode', () => {
    expect(nextConvoImportWarnings({ builder_directives: ['d'] }, undefined)).toHaveLength(1)
    expect(nextConvoImportWarnings({ seed_questions: ['q'] }, undefined)).toHaveLength(0)
  })
  it('does not warn on empty arrays', () => {
    expect(nextConvoImportWarnings({ seed_questions: [] }, 'converge')).toHaveLength(0)
    expect(nextConvoImportWarnings({ builder_directives: [] }, 'discover')).toHaveLength(0)
  })
  it('warns once when both fields are present', () => {
    expect(nextConvoImportWarnings({ seed_questions: ['q'], builder_directives: ['d'] }, 'converge')).toHaveLength(1)
    expect(nextConvoImportWarnings({ seed_questions: ['q'], builder_directives: ['d'] }, 'discover')).toHaveLength(1)
  })
  it('returns nothing for a projectUpdate without either field', () => {
    expect(nextConvoImportWarnings({ welcome_message: 'hi' }, 'converge')).toEqual([])
  })
})
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run lib/api/__tests__/import-payload.test.ts`
Expected: FAIL, `nextConvoImportWarnings is not a function` (or not exported).

- [ ] **Step 3: Add the copy and implement**

In `lib/copy.ts` under `brief:` add:
```ts
importIgnoredSeedQuestions:
  'This payload includes seed questions, but the brief is in converge mode — seed questions are only sent in discover mode. They were saved and will apply if the mode flips.',
importIgnoredDirectives:
  'This payload includes builder directives, but the brief is in discover mode — directives are only sent in converge mode. They were saved and will apply if the mode flips.',
importStayHint: 'Brief updated. Open Conversations to continue.',
```

In `lib/api/import-payload.ts` implement `nextConvoImportWarnings` per the Interfaces block. "Present" means a non-empty array. Import `copy` from `@/lib/copy` (check `lib/copy.ts` has no import back into `lib/api` first; it does not today).

- [ ] **Step 4: Run to verify they pass**

Run: `npx vitest run lib/api/__tests__/import-payload.test.ts`
Expected: PASS, all cases.

- [ ] **Step 5: Commit**

```bash
git add lib/api/import-payload.ts lib/api/__tests__/import-payload.test.ts lib/copy.ts
git commit -m "feat(import): nextConvoImportWarnings for mode-scoped fields (#216)"
```

### Task 2: Show the warning on import and stay on the Brief tab

**Files:**
- Modify: `components/builder/BuilderProjectView.tsx` — `handleImportJson` (around line 575) and the import card JSX (around line 700, next to `{pasteError && …}`)

**Interfaces:**
- Consumes: `nextConvoImportWarnings(projectUpdate, project?.session_mode)` from Task 1; `copy.brief.importStayHint`.
- Produces: new state `const [importWarnings, setImportWarnings] = useState<string[]>([])` in `BriefTab`.

- [ ] **Step 1: Wire the handler**

In `handleImportJson`, after a successful `multi` import, compute `const warnings = nextConvoImportWarnings(result.value.projectUpdate, project?.session_mode)`. For `brief-only` the warnings are `[]`.
- If `warnings.length === 0`: existing behaviour, call `onImported?.({ configUpdated })`.
- Else: `setImportWarnings(warnings)`, clear `pasteJson`, and do **not** call `onImported` (the builder stays on the Brief tab and reads the warning).
- Clear `importWarnings` in the textarea `onChange` alongside `setPasteError(null)`.

- [ ] **Step 2: Render it**

Directly under `{pasteError && <StatusMessage type="error" message={pasteError} />}` render one `<StatusMessage type="warning" … />` per warning, then one `<StatusMessage type="info" message={copy.brief.importStayHint} />` when `importWarnings.length > 0`. Check `StatusMessage`'s props (`components/ui/StatusMessage.tsx`) for the exact prop names before writing.

- [ ] **Step 3: Verify**

Run: `npm run build && npm run type-check && npm test`
Expected: all three clean.

- [ ] **Step 4: Commit**

```bash
git add components/builder/BuilderProjectView.tsx
git commit -m "feat(brief-tab): warn when an imported payload's seed questions or directives are ignored for the mode (#216)"
```

### Task 3: Copy prep context never falls back to "Untitled"

**Files:**
- Modify: `components/builder/BuilderProjectView.tsx` — `handleCopyPayload` (line ~560: `projectTitle: project?.title || 'Untitled'`) and the Copy prep button (line ~662).

**Interfaces:**
- Consumes: `project: Project | undefined` prop already on `BriefTab`.

- [ ] **Step 1: Remove the fallback**

At the top of `handleCopyPayload` add `if (!project) return` and change the prompt input to `projectTitle: project.title, language: project.language`. Delete the `|| 'Untitled'`.

- [ ] **Step 2: Disable the button until the project is loaded**

On the Copy prep `LoadingButton`, add `disabled={!project}` (keep existing props). Add a one-line comment: the project query can be loading or errored while the brief is already shown; copying then produced `Title: Untitled` in the prep export (#215).

- [ ] **Step 3: Verify**

Run: `npm run build && npm run type-check && npm test`
Expected: clean. The prep snapshot test still passes (its fixture passes the literal string `'Untitled'` by choice; leave it).

- [ ] **Step 4: Commit**

```bash
git add components/builder/BuilderProjectView.tsx
git commit -m "fix(brief-tab): copy prep context uses the loaded project title, never 'Untitled' (#215)"
```

### Task 4: Changelog, push, preview, PR

**Files:**
- Modify: `docs/changelog.md` (prepend one entry, newest first, dated 2026-10-17)

- [ ] **Step 1: Prepend the changelog entry** covering #215 and #216 in two sentences each, following the existing entry style at the top of the file.

- [ ] **Step 2: Commit, push, alias to preview**

```bash
git add docs/changelog.md
git commit -m "docs: changelog for #215 and #216"
git push -u origin HEAD
git push origin HEAD:preview --force
```

- [ ] **Step 3: Open the PR** with `gh pr create`, body closing `#215` and `#216`, ending with `🤖 Generated with [Claude Code](https://claude.com/claude-code)`.

- [ ] **Step 4: Manual preview check (hand to Nico as a self-contained smoke test)** at `https://preview.ibuild4you.com`: open any brief in discover mode, Brief tab, paste `{"_payload_type":"next-convo","brief":{"problem":"x"},"builder_directives":["d"]}`, click Import JSON. Pass: a yellow warning about directives in discover mode and the brief updated, still on the Brief tab. Fail: silent tab switch. Then click "Copy prep context" immediately after a hard reload: pass is a prep starting with the brief's real title.
