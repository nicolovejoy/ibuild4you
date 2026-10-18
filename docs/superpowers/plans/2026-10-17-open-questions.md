# #220 Open Questions for the Maker — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Open risks carry a typed owner; the Brief tab lists the maker-owned ones with copy-as-markdown; the dashboard row counts them; the agent asks the maker about them.

**Architecture:** `open_risks` elements become `string | { text, owner }` with a canonical form (string when unowned). One helper module (`lib/brief/risks.ts`) is the only place that knows the shape; every writer normalizes through it and the regen coercion carries owners forward by text match, the way locks survive regen. UI is a new card in the ferry desk plus badges/owner select in the editor.

**Tech Stack:** Next.js App Router, TypeScript, vitest (+ @testing-library/react for components), Firestore Admin SDK (hand-rolled mocks in tests), Playwright e2e against preview.

**Spec:** `docs/superpowers/specs/2026-10-17-open-questions-design.md`

## Global Constraints

- Canonical form: unowned risk = plain string; owned = `{ text, owner }`; `{ text }` without owner collapses to the string. Owner values exactly `'maker' | 'builder'`; anything else drops the owner, keeps the text.
- Every writer of `open_risks` goes through `normalizeRisks`. Only the regen coercion carries owners forward (`carryRiskOwners`); paste/PUT does not.
- Agent prompt suffixes, verbatim: ` (the maker owes an answer — ask them when it fits)` and ` (the builder's to resolve — don't push the maker on it)`.
- Markdown export, verbatim: `## Open questions for <makerName> — <title>`, blank line, `- <question>` lines, trailing newline. Whole-brief exports render risks as `- <text>`, `- (maker) <text>`, `- (builder) <text>`.
- Copy keys live in `lib/copy.ts` (builder) / `lib/copy-maker.ts` dashboard (both EN and FR objects must type-check). No inline reader-facing strings in components.
- No maker-facing change. The questions card and dashboard count are builder-side only.
- Worktree verification: run BOTH `npm run build` (with dummy `NEXT_PUBLIC_FIREBASE_API_KEY=x NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=x NEXT_PUBLIC_FIREBASE_PROJECT_ID=x NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=x NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=x NEXT_PUBLIC_FIREBASE_APP_ID=x`) AND `npm run type-check`. Never commit `lib/build-info.json`.

## Review Focus

1. A stored brief from before this change (all strings) renders, edits, saves and regens with no behaviour change — Task 1 (`normalizeRisks` identity on strings), Task 5 (editor round-trip of a string list).
2. The regen model re-emits a maker-owned risk as a plain string with the same text but different case/whitespace — owner restored (Task 2 carry test).
3. The regen model re-emits a risk with changed text — no owner carried, no crash (Task 2).
4. A paste with `owner: "Maker"` (wrong case) or `owner: 42` — text kept, owner dropped, no 400 (Task 1 + Task 2 brief-json test).
5. A brief whose maker-owned risks are all deleted — card unmounts, dashboard count disappears, copy function never called with an empty list (Task 4 hidden-at-zero test, Task 6 count-zero test).

---

### Task 1: Risk helpers and types

**Files:**
- Modify: `lib/types/index.ts` (BriefContent block, ~line 262–270)
- Create: `lib/brief/risks.ts`
- Test: `lib/brief/__tests__/risks.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export type BriefRiskOwner = 'maker' | 'builder'
  export interface BriefRisk { text: string; owner?: BriefRiskOwner }
  // BriefContent.open_risks?: Array<string | BriefRisk>
  export function riskText(r: string | BriefRisk): string
  export function riskOwner(r: string | BriefRisk): BriefRiskOwner | undefined
  export function normalizeRisks(raw: unknown): Array<string | BriefRisk>
  export function makerQuestions(content: BriefContent | undefined): string[]
  export function carryRiskOwners(current: Array<string | BriefRisk> | undefined, next: Array<string | BriefRisk>): Array<string | BriefRisk>
  ```

- [ ] **Step 1: Write the failing tests** in `lib/brief/__tests__/risks.test.ts`

```ts
import { describe, it, expect } from 'vitest'
import { riskText, riskOwner, normalizeRisks, makerQuestions, carryRiskOwners } from '@/lib/brief/risks'

describe('riskText / riskOwner', () => {
  it('reads both shapes', () => {
    expect(riskText('a')).toBe('a'); expect(riskOwner('a')).toBeUndefined()
    expect(riskText({ text: 'b', owner: 'maker' })).toBe('b'); expect(riskOwner({ text: 'b', owner: 'maker' })).toBe('maker')
  })
})

describe('normalizeRisks', () => {
  it('is the identity on a clean string list', () => {
    expect(normalizeRisks(['a', 'b'])).toEqual(['a', 'b'])
  })
  it('drops empty/non-string/non-object entries', () => {
    expect(normalizeRisks(['a', '', '  ', 42, null, {}, { text: '' }])).toEqual(['a'])
  })
  it('keeps owned objects, collapses ownerless objects to strings', () => {
    expect(normalizeRisks([{ text: 'x', owner: 'maker' }, { text: 'y' }, { text: 'z', owner: 'builder' }]))
      .toEqual([{ text: 'x', owner: 'maker' }, 'y', { text: 'z', owner: 'builder' }])
  })
  it('drops an unknown owner but keeps the text', () => {
    expect(normalizeRisks([{ text: 'x', owner: 'Maker' }, { text: 'y', owner: 42 }])).toEqual(['x', 'y'])
  })
  it('trims text', () => {
    expect(normalizeRisks([' a ', { text: ' b ', owner: 'maker' }])).toEqual(['a', { text: 'b', owner: 'maker' }])
  })
  it('returns [] for non-arrays', () => {
    expect(normalizeRisks(undefined)).toEqual([]); expect(normalizeRisks('a')).toEqual([])
  })
})

describe('makerQuestions', () => {
  it('returns maker-owned texts in order, nothing else', () => {
    const content = { problem: '', target_users: '', features: [], constraints: '', additional_context: '',
      open_risks: ['plain', { text: 'q1', owner: 'maker' as const }, { text: 'b', owner: 'builder' as const }, { text: 'q2', owner: 'maker' as const }] }
    expect(makerQuestions(content)).toEqual(['q1', 'q2'])
    expect(makerQuestions(undefined)).toEqual([])
    expect(makerQuestions({ ...content, open_risks: undefined })).toEqual([])
  })
})

describe('carryRiskOwners', () => {
  it('restores an owner the next list dropped, matching text case/whitespace-insensitively', () => {
    const current = [{ text: 'Pricing model', owner: 'maker' as const }, 'plain']
    expect(carryRiskOwners(current, ['  pricing MODEL ', 'plain', 'new'])).toEqual([
      { text: '  pricing MODEL ', owner: 'maker' }, 'plain', 'new'])
  })
  it('does not override an owner the next list set', () => {
    expect(carryRiskOwners([{ text: 'a', owner: 'maker' }], [{ text: 'a', owner: 'builder' }])).toEqual([{ text: 'a', owner: 'builder' }])
  })
  it('does not carry when the text changed, and handles undefined current', () => {
    expect(carryRiskOwners([{ text: 'a', owner: 'maker' }], ['a!'])).toEqual(['a!'])
    expect(carryRiskOwners(undefined, ['a'])).toEqual(['a'])
  })
})
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run lib/brief/__tests__/risks.test.ts`
Expected: FAIL (module not found)

- [ ] **Step 3: Add the types** to `lib/types/index.ts` next to `BriefContent` (export `BriefRiskOwner`, `BriefRisk`; change `open_risks?: string[]` to `open_risks?: Array<string | BriefRisk>` with a one-line comment pointing at `lib/brief/risks.ts` and #220).

- [ ] **Step 4: Implement `lib/brief/risks.ts`** with the five exports. Header comment: the canonical-form rule and why (every pre-#220 brief stays valid and byte-identical). `carryRiskOwners` matches on `text.trim().toLowerCase()`; it returns `next` elements unchanged except for the restored owner.

- [ ] **Step 5: Run the tests and the type-check**

Run: `npx vitest run lib/brief/__tests__/risks.test.ts && npm run type-check`
Expected: tests PASS. `type-check` will now FAIL in the readers that treat elements as strings (`system-prompt.ts`, `BriefEditor.tsx`, `brief-json.ts`, `briefs.ts`, `app/api/briefs/route.ts`, `app/api/projects/route.ts`, `BuilderProjectView.tsx`?). Fix only what is needed to compile by routing through `riskText` / `normalizeRisks` with **no behaviour change yet** (the real changes are Tasks 2–5). List each file you touched in your report.

- [ ] **Step 6: Run the whole suite**

Run: `npm test -- --run 2>&1 | tail -5`
Expected: all green.

- [ ] **Step 7: Commit**

```bash
git add lib/types/index.ts lib/brief/risks.ts lib/brief/__tests__/risks.test.ts <files touched in step 5>
git commit -m "feat(brief): typed owner on open risks — helpers and types (#220)"
```

---

### Task 2: Writers normalize; regen schema, prompt, and owner carry-forward

**Files:**
- Modify: `lib/api/brief-json.ts` (normalizeBriefContent `open_risks` line ~84; the `isStringArray` check at ~40 must accept both shapes)
- Modify: `app/api/briefs/route.ts` (~line 97)
- Modify: `app/api/projects/route.ts` (~line 593)
- Modify: `lib/api/briefs.ts` (tool schema ~line 62; coercion ~line 233; carry next to `reconcileBrief`)
- Modify: `lib/agent/next-convo-prompt.ts` (schema line 34; rule line ~62)
- Test: `lib/api/__tests__/brief-json.test.ts`, `lib/api/__tests__/briefs.test.ts`, `app/api/projects/__tests__/create-project.test.ts`, `lib/agent/__tests__/next-convo-prompt.test.ts`, `lib/agent/__tests__/prep-prompts-snapshot.test.ts` (update snapshots only if the prompt text change breaks them — say so in the report)

**Interfaces:**
- Consumes: `normalizeRisks`, `carryRiskOwners` from Task 1.

- [ ] **Step 1: Write the failing tests**

In `lib/api/__tests__/brief-json.test.ts`:
```ts
it('accepts owned risks and canonicalizes ownerless objects', () => {
  const r = normalizeBriefContent({ open_risks: [{ text: 'q', owner: 'maker' }, { text: 'p' }, 'plain'] })
  expect(r.ok && r.value.open_risks).toEqual([{ text: 'q', owner: 'maker' }, 'p', 'plain'])
})
it('does not 400 on a bad owner — keeps the text', () => {
  const r = normalizeBriefContent({ open_risks: [{ text: 'q', owner: 'Maker' }] })
  expect(r.ok && r.value.open_risks).toEqual(['q'])
})
it('round-trips an owned risk through serialize → parse', () => {
  const b = { ...emptyBrief(), open_risks: [{ text: 'q', owner: 'maker' as const }] }
  const r = parseBriefJson(serializeBriefContent(b))
  expect(r.ok && r.value.open_risks).toEqual(b.open_risks)
})
```

In `lib/api/__tests__/briefs.test.ts` (follow the existing regen test harness there; the stored current brief is whatever that file's fixture sets):
```ts
it('stores owned risks from the model and canonicalizes strings/ownerless objects', async () => {
  // model emits: [{ text: 'q', owner: 'maker' }, { text: 'p' }, 'plain', { text: '', owner: 'maker' }]
  // expect stored open_risks: [{ text: 'q', owner: 'maker' }, 'p', 'plain']
})
it('restores an owner the model dropped when the text still matches', async () => {
  // current brief open_risks: [{ text: 'Pricing model', owner: 'maker' }]
  // model emits: ['pricing model']
  // expect stored: [{ text: 'pricing model', owner: 'maker' }]
})
it('does not carry an owner onto changed text', async () => {
  // current: [{ text: 'Pricing model', owner: 'maker' }]; model emits: ['Pricing model for teams']
  // expect stored: ['Pricing model for teams']
})
it('tool schema open_risks items are objects with text + owner enum', () => {
  // expect BRIEF_TOOL.input_schema.properties.brief.properties.open_risks.items.properties.owner.enum toEqual ['maker','builder']
  // and .required toEqual ['text']  (adapt the path to the exported schema object's real name)
})
```

In `app/api/projects/__tests__/create-project.test.ts`, extend the existing `filters non-string open_risks entries when seeding` test's neighbour:
```ts
it('seeds owned risks and canonicalizes', async () => {
  // brief.open_risks: [{ text: 'q', owner: 'maker' }, { text: 'p' }, 'plain', 42]
  // expect stored: [{ text: 'q', owner: 'maker' }, 'p', 'plain']
})
```

In `lib/agent/__tests__/next-convo-prompt.test.ts`:
```ts
it('tells the model about risk owners', () => {
  expect(NEXT_CONVO_SYSTEM_PROMPT).toContain('"owner": "maker"')
  expect(NEXT_CONVO_SYSTEM_PROMPT).toContain('Carry an existing owner forward')
})
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run lib/api/__tests__/brief-json.test.ts lib/api/__tests__/briefs.test.ts app/api/projects/__tests__/create-project.test.ts lib/agent/__tests__/next-convo-prompt.test.ts`
Expected: the new tests FAIL.

- [ ] **Step 3: Implement**

- `brief-json.ts`: validation accepts an array whose elements are strings or objects with string `text` (anything else → `"open_risks" must be a list of strings or { text, owner } objects`); value = `normalizeRisks(o.open_risks)`.
- `app/api/briefs/route.ts` and `app/api/projects/route.ts`: replace the string filter with `normalizeRisks(...)` (projects: keep the "only when non-empty" spread).
- `lib/api/briefs.ts`: tool schema `open_risks: { type: 'array', items: { type: 'object', properties: { text: { type: 'string' }, owner: { type: 'string', enum: ['maker', 'builder'], description: 'maker = only the maker can settle it (their preference, a fact about their world, a decision that is theirs); builder = the builder\'s to resolve. Omit when unclear. Carry an existing owner forward unless the conversation resolved the risk.' } }, required: ['text'] } }`. Coercion: `open_risks: normalizeRisks(raw.open_risks)`, then after `reconcileBrief` (or inside the same merge step) `open_risks: carryRiskOwners(currentBrief?.open_risks, reconciled.open_risks ?? [])`.
- `next-convo-prompt.ts`: schema line becomes `"open_risks": ["plain-language description of something unresolved, unclear, or risky", { "text": "a risk only one side can settle", "owner": "maker" }]`; append to the open-risks rule: ` A risk may carry \`"owner": "maker"\` when only the maker can settle it (their preference, a fact about their world, a decision that is theirs to make) or \`"owner": "builder"\` when it is the builder's to resolve (technical, scheduling, something the builder said they would look into); omit \`owner\` when unclear. Carry an existing owner forward unless the conversation resolved the risk.`

- [ ] **Step 4: Run the tests**

Run: same command as Step 2, then `npx vitest run lib/agent/__tests__/prep-prompts-snapshot.test.ts`
Expected: PASS. If the snapshot test fails only because the prompt text changed, update the snapshot (`-u`) and name it in the report.

- [ ] **Step 5: Full suite + type-check**

Run: `npm test -- --run 2>&1 | tail -5 && npm run type-check`
Expected: green.

- [ ] **Step 6: Commit**

```bash
git add lib/api/brief-json.ts app/api/briefs/route.ts app/api/projects/route.ts lib/api/briefs.ts lib/agent/next-convo-prompt.ts lib/api/__tests__ app/api/projects/__tests__ lib/agent/__tests__
git commit -m "feat(brief): writers normalize risk owners; regen sets and carries them (#220)"
```

---

### Task 3: Agent system prompt marks owned risks

**Files:**
- Modify: `lib/agent/system-prompt.ts` (~line 189–196)
- Test: `lib/agent/__tests__/system-prompt.test.ts` (near line 301)

- [ ] **Step 1: Write the failing test**

```ts
it('marks maker- and builder-owned open risks', () => {
  // same builder as the existing open_risks test, with
  // open_risks: ['plain', { text: 'q', owner: 'maker' }, { text: 'b', owner: 'builder' }]
  expect(result).toContain('- plain\n')
  expect(result).toContain('- q (the maker owes an answer — ask them when it fits)')
  expect(result).toContain("- b (the builder's to resolve — don't push the maker on it)")
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run lib/agent/__tests__/system-prompt.test.ts`

- [ ] **Step 3: Implement** — map each risk through `riskText` / `riskOwner` and append the verbatim suffix from Global Constraints. Keep the heading and intro text unchanged.

- [ ] **Step 4: Run the test, then commit**

```bash
git add lib/agent/system-prompt.ts lib/agent/__tests__/system-prompt.test.ts
git commit -m "feat(agent): system prompt marks maker- and builder-owned risks (#220)"
```

---

### Task 4: Open questions card, markdown, ferry-desk slot, whole-brief export

**Files:**
- Create: `lib/builder/open-questions.ts`
- Create: `components/builder/OpenQuestionsCard.tsx`
- Modify: `components/builder/FerryDesk.tsx` (new `openQuestions?: React.ReactNode` prop, rendered after `notices`, before the Details `border-t` block)
- Modify: `components/builder/BuilderProjectView.tsx` (pass the card into `FerryDesk`; `formatBrief()` ~line 662 gains the `## Open risks` section)
- Modify: `lib/copy.ts` `brief` block (~line 167+)
- Test: `lib/builder/__tests__/open-questions.test.ts`, `components/builder/__tests__/OpenQuestionsCard.test.tsx`, `components/builder/__tests__/FerryDesk.test.tsx` (one test: slot renders)

**Interfaces:**
- Consumes: `makerQuestions`, `riskText`, `riskOwner` (Task 1).
- Produces:
  ```ts
  export function openQuestionsMarkdown(args: { title: string; makerName: string; questions: string[] }): string
  export function OpenQuestionsCard(props: { title: string; makerName: string; questions: string[] }): JSX.Element | null
  ```
- Copy keys (`copy.brief`): `openQuestionsTitle: (name: string, n: number) => \`Open questions for ${name} (${n})\``, `openQuestionsFallbackName: 'the maker'`, `openQuestionsCopy: 'Copy as markdown'`, `openQuestionsCopied: 'Copied!'`, `exportOpenRisks: 'Open risks'` (heading used by `formatBrief`).

- [ ] **Step 1: Write the failing tests**

`lib/builder/__tests__/open-questions.test.ts`:
```ts
it('renders the exact markdown', () => {
  expect(openQuestionsMarkdown({ title: 'Tideline', makerName: 'Mara', questions: ['Which three tide stations matter most?', 'Should the app work offline?'] }))
    .toBe('## Open questions for Mara — Tideline\n\n- Which three tide stations matter most?\n- Should the app work offline?\n')
})
```

`components/builder/__tests__/OpenQuestionsCard.test.tsx` (pattern on `FerryDesk.test.tsx` for render setup):
```ts
it('renders nothing with no questions', () => { /* container.firstChild null */ })
it('lists the questions with the title and count', () => {
  // title 'Tideline', makerName 'Mara', questions ['a','b'] → heading text 'Open questions for Mara (2)', two list items
  // data-testid open-questions present
})
it('copies the markdown', async () => {
  // stub navigator.clipboard.writeText; click button data-testid open-questions-copy
  // expect writeText called with openQuestionsMarkdown({...}); button text becomes 'Copied!'
})
```

`FerryDesk.test.tsx`: one test that a node passed as `openQuestions` renders between the actions row and the Details toggle (assert presence is enough).

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run lib/builder/__tests__/open-questions.test.ts components/builder/__tests__/OpenQuestionsCard.test.tsx components/builder/__tests__/FerryDesk.test.tsx`

- [ ] **Step 3: Implement**

- `open-questions.ts`: the pure function, exact format from Global Constraints.
- `OpenQuestionsCard.tsx`: `'use client'`; returns `null` when `questions.length === 0`; a `rounded-lg border border-gray-200 bg-white px-3 py-2` box with the heading in the Brief tab's `text-xs font-semibold text-brand-slate uppercase tracking-wide` style, a `list-disc list-inside` list, and the copy button in the Brief tab's small-button style (`Copy`/`Check` lucide icons, 2 s flash via `setTimeout`). All strings from `copy.brief`.
- `FerryDesk.tsx`: add the prop; render `{openQuestions}` directly after the `notices` block.
- `BuilderProjectView.tsx`: compute `const questions = makerQuestions(briefContent)` and `const makerName = project?.requester_first_name || copy.brief.openQuestionsFallbackName`; pass `openQuestions={<OpenQuestionsCard title={project?.title ?? ''} makerName={makerName} questions={questions} />}`. In `formatBrief()`, after Decisions: `if (briefContent.open_risks?.length) sections.push(\`## ${copy.brief.exportOpenRisks}\`, ...briefContent.open_risks.map((r) => { const o = riskOwner(r); return \`- ${o ? \`(${o}) \` : ''}${riskText(r)}\` }), '')`.

- [ ] **Step 4: Run tests, full suite, type-check and build**

Run: `npm test -- --run 2>&1 | tail -5 && npm run type-check && NEXT_PUBLIC_FIREBASE_API_KEY=x NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=x NEXT_PUBLIC_FIREBASE_PROJECT_ID=x NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=x NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=x NEXT_PUBLIC_FIREBASE_APP_ID=x npm run build 2>&1 | tail -5`
Expected: green; do not stage `lib/build-info.json`.

- [ ] **Step 5: Commit**

```bash
git add lib/builder/open-questions.ts lib/builder/__tests__/open-questions.test.ts components/builder/OpenQuestionsCard.tsx components/builder/FerryDesk.tsx components/builder/BuilderProjectView.tsx components/builder/__tests__ lib/copy.ts
git commit -m "feat(brief): open-questions card with copy-as-markdown in the ferry desk (#220)"
```

---

### Task 5: Brief editor — owner badges and owner select

**Files:**
- Modify: `components/builder/BriefEditor.tsx` (`BriefReadView` ~line 381; `StructuredEditor` ~line 534; new `RiskListField` next to `StringListField`)
- Modify: `lib/copy.ts` `brief` block: `riskOwnerMaker: 'Maker'`, `riskOwnerBuilder: 'Builder'`, `riskOwnerNone: '—'`, `riskOwnerLabel: 'Owner'`
- Test: `components/builder/__tests__/BriefEditor.test.tsx`

**Interfaces:**
- Consumes: `riskText`, `riskOwner`, `BriefRisk` (Task 1).

- [ ] **Step 1: Write the failing tests** (follow the file's existing render/edit helpers)

```ts
it('read view badges owned risks', () => {
  // content.open_risks: ['plain', { text: 'q', owner: 'maker' }, { text: 'b', owner: 'builder' }]
  // expect text 'Maker' badge once, 'Builder' badge once, all three texts present
})
it('edit view: owner select round-trips to canonical form on save', async () => {
  // enter edit; the Open risks rows show a select aria-label 'Owner' with values '', 'maker', 'builder'
  // change row 0 (plain) to 'maker', row 1 (maker) to '' ; click Save
  // expect the PUT body open_risks toEqual [{ text: 'plain', owner: 'maker' }, 'q', { text: 'b', owner: 'builder' }]
})
it('edit view: adding a risk creates an unowned string', async () => { /* add 'new' → draft/open_risks ends with 'new' */ })
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run components/builder/__tests__/BriefEditor.test.tsx`

- [ ] **Step 3: Implement**

- `BriefReadView`: before each risk text, when `riskOwner(r)` is set, a badge span in the Locked-badge style: Maker → `bg-blue-100 text-blue-800`, Builder → `bg-gray-100 text-gray-700`, text from copy.
- `RiskListField({ items: Array<string | BriefRisk>, onChange, placeholder })`: rows = text `<input>` (editing keeps the owner) + `<select aria-label={copy.brief.riskOwnerLabel}>` + remove button; the add row is text-only and appends a string. Owner `''` → element becomes the plain string; `'maker' | 'builder'` → `{ text, owner }`.
- `StructuredEditor`: use `RiskListField` for open risks. `hasAnyContent` unchanged.

- [ ] **Step 4: Run the test file, full suite, type-check; commit**

```bash
git add components/builder/BriefEditor.tsx components/builder/__tests__/BriefEditor.test.tsx lib/copy.ts
git commit -m "feat(brief-editor): owner badge in read view, owner select in edit view (#220)"
```

---

### Task 6: Dashboard count

**Files:**
- Modify: `lib/api/enrich-projects.ts` (~line 100–105 and the return at ~127)
- Modify: `lib/types/index.ts` (`Project`: `brief_maker_question_count?: number | null` after `brief_feature_count`)
- Modify: `app/dashboard/page.tsx` (~line 326–331, after the decisions count)
- Modify: `lib/copy-maker.ts` dashboard EN (~line 93) and FR (~line 275): `makerQuestions: (n: number, name: string) => \`${n} for ${name}\`` (FR: `` `${n} pour ${name}` ``)
- Test: `app/api/projects/__tests__/read-budget.test.ts` (next to the `brief_feature_count` assertion at ~206)

- [ ] **Step 1: Write the failing test** — in the existing enrichment test, give the fixture brief `open_risks: ['x', { text: 'q', owner: 'maker' }]` and assert `first.brief_maker_question_count` is `1`; a project without a brief → `0`.

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run app/api/projects/__tests__/read-budget.test.ts`

- [ ] **Step 3: Implement** — in `enrich-projects.ts`, from the already-read `content`, `briefMakerQuestionCount = makerQuestions(content as BriefContent | undefined).length` (0 when no brief); add to the return. In the dashboard card, inside the `project.brief_version != null` span, after the decisions fragment: `{builderSide && (project.brief_maker_question_count ?? 0) > 0 && (<> &middot; {d.makerQuestions(project.brief_maker_question_count ?? 0, makerDisplayName(project) || d.makerFallbackName)}</>)}` — if no fallback-name key exists in the dashboard copy, add `makerFallbackName: 'the maker'` / FR `'le maker'`… use the existing project-level maker fallback if one exists in that file (check first; say which you used in the report).

- [ ] **Step 4: Run test, full suite, type-check; commit**

```bash
git add lib/api/enrich-projects.ts lib/types/index.ts app/dashboard/page.tsx lib/copy-maker.ts app/api/projects/__tests__/read-budget.test.ts
git commit -m "feat(dashboard): count maker-owned open questions on the brief row (#220)"
```

---

### Task 7: Ops export, docs, changelog, e2e script

**Files:**
- Modify: `scripts/lib/brief-markdown.mjs` (~line 68–71) and `scripts/lib/brief-markdown.test.mjs`
- Modify: `app/dashboard/docs/start-a-brief/page.tsx` (~line 28), `app/dashboard/docs/next-conversation/page.tsx` (~line 16)
- Modify: `CLAUDE.md` (Project Setup JSON after the create example; Data Model `briefs` bullet; Agent Behavior Rules), `docs/changelog.md` (prepend)
- Create: `scripts/e2e-220-open-questions.mjs`

- [ ] **Step 1: Write the failing test** in `brief-markdown.test.mjs`: `open_risks: ['Payment fees', { text: 'Which stations?', owner: 'maker' }, { text: 'Hosting', owner: 'builder' }]` → output contains `- Payment fees`, `- (maker) Which stations?`, `- (builder) Hosting`.

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run scripts/lib/brief-markdown.test.mjs`

- [ ] **Step 3: Implement** — `brief-markdown.mjs` renders the three forms (it is plain JS: inline `typeof r === 'string' ? r : …`; do not import from `lib/`). Docs pages: the `open_risks` example line shows both forms (same as the prompt's schema line). CLAUDE.md: one sentence after the create example — an open risk may be `{ "text": "…", "owner": "maker" | "builder" }`; maker = only they can settle it, builder = the builder's to resolve; regen sets owners where it can and carries an existing owner forward by text match (#220); the Brief tab lists maker-owned ones with Copy as markdown and the dashboard row counts them. Data Model `briefs` bullet: append `open_risks` elements are `string | { text, owner }`. Agent Behavior Rules: one sentence — Sam asks the maker about maker-owned open risks when it fits and does not push them on builder-owned ones. Changelog entry dated 2026-10-17 (#220).

- [ ] **Step 4: Write `scripts/e2e-220-open-questions.mjs`** modelled on `scripts/e2e-221-import-warning-prep-title.mjs` (admin login, clipboard stub, PASS/FAIL list, exit 1 on any FAIL):
  1. `POST /api/projects` via `page.request` with the bypass/auth the helper provides (see how e2e-214 calls the API) — `{ title: 'E2E220 open questions <stamp> — delete me', requester_first_name: 'Mara', brief: { problem: 'smoke', open_risks: ['plain risk', { text: 'Which stations?', owner: 'maker' }, { text: 'Hosting', owner: 'builder' }] } }`; keep the returned `project_id`/slug.
  2. Open `/projects/<slug>`, Brief tab; `[data-testid=open-questions]` visible; its list has exactly one item, text `Which stations?`; heading contains `Open questions for Mara (1)`.
  3. Click `[data-testid=open-questions-copy]`; `window.__clip` last entry equals `## Open questions for Mara — E2E220 open questions <stamp> — delete me\n\n- Which stations?\n`.
  4. `/dashboard`: the card with that title contains `1 for Mara`.
  5. `PUT /api/briefs` with `source: 'paste'` and `open_risks` where Hosting is now `owner: 'maker'`; reload the Brief tab: list has 2 items; dashboard shows `2 for Mara`.
  6. Screenshots to `shotDir`; print `ALL PASS n/n` or exit 1.
  Do not run it against preview — the controller runs it after the push.

- [ ] **Step 5: Run the ops test, full suite, type-check, build; commit**

```bash
git add scripts/lib/brief-markdown.mjs scripts/lib/brief-markdown.test.mjs app/dashboard/docs CLAUDE.md docs/changelog.md scripts/e2e-220-open-questions.mjs
git commit -m "docs+ops: risk owners in exports, payload docs, changelog; e2e-220 script (#220)"
```
