# Mode-Scoped Seed Questions and Directives (#192) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the system prompt match the documented contract: seed questions (`## Topics to explore`) are injected only in discover mode, builder directives (`## Directives`) only in converge mode.

**Architecture:** One conditional each in `buildSystemPrompt` in `lib/agent/system-prompt.ts`. Project/session data is untouched — both fields stay stored, so flipping the mode never loses them. The digest doc is updated to say the code now matches.

**Tech Stack:** TypeScript, vitest.

**Spec:** GitHub issue #192 (`gh issue view 192`). Key text: *"In `buildSystemPrompt`, emit the seed-questions block only when `sessionMode !== 'converge'` and the directives block only when `sessionMode === 'converge'`. Keep both fields on the project doc so a mode flip does not lose data. Update `docs/brief-rules-digest.md` to say the code now matches. Tests in `lib/agent/__tests__/system-prompt.test.ts`."*

## Global Constraints

- `sessionMode` is `'discover' | 'converge' | undefined`; `undefined` means discover (matches the existing rule-set selection on line 59 of `system-prompt.ts`).
- No data-model change. No change to `app/api/sessions/route.ts` snapshotting.
- Code style: clarity over cleverness; keep the existing comment explaining `aboutTheMaker`.
- Commit messages end with the line `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.
- Before claiming clean, run `npm test`, `npm run type-check`, `npm run build`.

## Review Focus

1. `sessionMode: undefined` must behave as discover (seed questions in, directives out) — pinned in Task 1.
2. Converge with seed questions set must omit `## Topics to explore` even though the array is non-empty — pinned in Task 1.
3. Discover with directives set must omit `## Directives` — pinned in Task 1.
4. The existing third-person-rewrite tests (`aboutTheMaker` text in both blocks) must still pass once their inputs carry the right mode — Task 1 updates them rather than deleting them.
5. The dashboard Setup tab already shows one field or the other per mode; nothing in this plan touches it, but a JSON-import payload can still set both — Task 2 documents that the hidden one is simply unused in that mode.

---

### Task 1: Gate the two blocks on `sessionMode`

**Files:**
- Modify: `lib/agent/system-prompt.ts` (the `seedQuestions` block at ~lines 104–114 and the `builderDirectives` block at ~lines 125–135; if the branch already contains `buildSystemPromptParts` from the caching plan, the same blocks live inside it — edit them there)
- Test: `lib/agent/__tests__/system-prompt.test.ts`

**Interfaces:**
- Consumes/Produces: `buildSystemPrompt` signature unchanged.

- [ ] **Step 1: Write the failing tests and fix up existing ones**

In `lib/agent/__tests__/system-prompt.test.ts`:

1. Find every existing test that passes `builderDirectives` without `sessionMode: 'converge'` and add `sessionMode: 'converge'` to its input. Known ones (line numbers approximate): the `includes numbered directives` test (~line 103), `omits directives section when empty` (~line 113), the two Yield-to-maker tests (~lines 394–408), and the third-person-rewrite directives test (~line 595). Grep: `grep -n builderDirectives lib/agent/__tests__/system-prompt.test.ts`.

2. Append a new `describe` block:

```ts
// =============================================================================
// Mode scoping (#192): seed questions are a discover-mode tool, directives a
// converge-mode tool. The dashboard shows one or the other per mode; the
// prompt now matches instead of injecting both every session.
// =============================================================================

describe('mode-scoped seed questions and directives (#192)', () => {
  const seedQuestions = ['What does the app do?']
  const builderDirectives = ['Nail down the payment flow']

  it('discover (default, mode undefined): seed questions in, directives out', () => {
    const result = buildSystemPrompt({ ...minimalInput, seedQuestions, builderDirectives })
    expect(result).toContain('## Topics to explore')
    expect(result).toContain('1. What does the app do?')
    expect(result).not.toContain('## Directives')
    expect(result).not.toContain('Nail down the payment flow')
  })

  it('discover (explicit): same as default', () => {
    const result = buildSystemPrompt({ ...minimalInput, sessionMode: 'discover', seedQuestions, builderDirectives })
    expect(result).toContain('## Topics to explore')
    expect(result).not.toContain('## Directives')
  })

  it('converge: directives in, seed questions out', () => {
    const result = buildSystemPrompt({ ...minimalInput, sessionMode: 'converge', seedQuestions, builderDirectives })
    expect(result).toContain('## Directives')
    expect(result).toContain('1. Nail down the payment flow')
    expect(result).not.toContain('## Topics to explore')
    expect(result).not.toContain('What does the app do?')
  })
})
```

- [ ] **Step 2: Run to verify the new tests fail**

Run: `npx vitest run lib/agent/__tests__/system-prompt.test.ts`
Expected: the three new tests FAIL (`## Directives` present in discover; `## Topics to explore` present in converge). The updated existing tests PASS.

- [ ] **Step 3: Implement**

In `lib/agent/system-prompt.ts`, right above the `aboutTheMaker` comment, add:

```ts
  // #192: seed questions are a discover-mode tool and directives a
  // converge-mode tool — the dashboard Setup tab shows one or the other per
  // mode, and the prompt now matches. Both fields stay on the project doc so
  // flipping the mode never loses them; the hidden one is simply not sent.
  const converge = sessionMode === 'converge'
```

Change the two guards:

```ts
  if (!converge && seedQuestions && seedQuestions.length > 0) {
```

```ts
  if (converge && builderDirectives && builderDirectives.length > 0) {
```

- [ ] **Step 4: Run the suite**

Run: `npx vitest run lib/agent`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/agent/system-prompt.ts lib/agent/__tests__/system-prompt.test.ts
git commit -m "feat(agent): scope seed questions to discover and directives to converge (#192)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 2: Docs

**Files:**
- Modify: `docs/brief-rules-digest.md` — line ~154 (the bullet beginning `**Seed questions only in discover, directives only in converge**`) and line ~167 (question 3).
- Modify: `CLAUDE.md` § Project Setup JSON, directly under the create-payload code block, add one sentence to the `language` paragraph's neighbourhood (a new short paragraph is fine): `\`seed_questions\` reach the agent only in \`discover\` mode and \`builder_directives\` only in \`converge\` mode (#192); both are stored regardless, so flipping \`session_mode\` never loses them.`
- Modify: `docs/changelog.md` — prepend one entry in the file's existing `**Shipped <date> (...)**` style, 2–3 sentences.

- [ ] **Step 1: Edit the digest**

Replace the line-154 bullet with:

```
- **Seed questions only in discover, directives only in converge** — code now matches the docs (#192, 2026-10-15): `buildSystemPrompt` emits `## Topics to explore` only when `session_mode !== 'converge'` and `## Directives` only when it is `converge`. Both fields stay stored on the project/session (`lib/agent/system-prompt.ts`).
```

Replace question 3 (~line 167) with: `3. ~~Should seed questions and directives be mode-scoped as the docs say, or stay injected in both modes?~~ Decided: mode-scoped, shipped (#192).`

- [ ] **Step 2: Edit CLAUDE.md and the changelog as described in Files**

- [ ] **Step 3: Full verification**

```bash
npm test
npm run type-check
npm run build
npm run lint
```

Expected: all exit 0.

- [ ] **Step 4: Commit**

```bash
git add docs/brief-rules-digest.md CLAUDE.md docs/changelog.md
git commit -m "docs: seed questions and directives are mode-scoped (#192)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```
