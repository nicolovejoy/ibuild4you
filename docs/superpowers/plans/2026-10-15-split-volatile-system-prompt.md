# Split Volatile System-Prompt Content Out of the Cached Block — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the chat agent's cached system-prompt prefix byte-stable across a return visit by moving the parts that change between back-to-back turns (the "Returning after a break" gap block, and the prototype feedback/context blocks whose age labels roll over daily) into a second, *unmarked* system block that follows the cached one.

**Architecture:** `buildSystemPrompt` keeps its string signature (tests and route mocks depend on it) but becomes a thin join over a new `buildSystemPromptParts()` that returns `{ stable, volatile }`. `cacheSystemPrompt` / `applyPromptCaching` accept either a plain string or those parts and emit one cache-marked text block plus, when `volatile` is non-empty, a second text block with no `cache_control`. The chat and kickoff routes switch to the parts builder. Nothing else about marker placement or the 4-marker guard changes.

**Tech Stack:** Next.js App Router route handlers, `@anthropic-ai/sdk` (`system` accepts an array of text blocks; cache_control on block N caches the prefix up to and including N — later unmarked blocks are sent uncached), vitest.

**Spec:** No separate spec file. The requirement is the "Follow-up PR" note in `CLAUDE.md` § Next Steps → "Prompt caching for the chat agent": *"move volatile system-prompt content (the ≥1hr 'coming back after a gap' block, prototype age labels) into a second, unmarked system block after the cached one — today every return visit pays two full ~24k cache writes before caching saves anything (turn 1 writes; turn 2 misses because the gap block dropped out)."* Background: `docs/superpowers/plans/2026-09-18-chat-prompt-caching.md`.

## Global Constraints

- `buildSystemPrompt(input): string` must keep returning exactly `[stable, volatile].filter(Boolean).join('\n\n')` — every existing test in `lib/agent/__tests__/system-prompt.test.ts` must keep passing unchanged, except that the position of the gap block relative to `## Context` may move (no test pins that order).
- Anthropic 400s on more than 4 `cache_control` markers per request. The second system block carries **no** `cache_control`, so the marker count is unchanged by this plan.
- Never mutate inputs in `lib/agent/prompt-cache.ts` (existing contract, tested).
- `lib/integration/facilitator.ts` calls `cacheSystemPrompt(string)` — the string form must keep working unchanged.
- Code style: clarity over cleverness, comments where non-obvious, match the surrounding files' comment density.
- Commit messages end with the line `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.
- Before claiming the branch clean, run **both** `npm run build` and `npm run type-check` (plus `npm test`). In a worktree `type-check` alone silently skips Next's route-export validation (no `.next/types`), and `build` skips test files.

## Review Focus

1. A return visit's turn 1 (gap ≥ 1h) and turn 2 (gap < 1h, a minute later) must produce a byte-identical `stable` string — pinned by a test in Task 1.
2. A prompt with no volatile content must send exactly one system block (no empty second block, which would waste tokens and could 400) — pinned in Task 2.
3. The kickoff route and the chat route must emit the *same* stable block for the same project state so a kickoff greeting followed by the maker's first reply is a cache read — covered by both routes calling the same `buildSystemPromptParts` and asserted per route in Tasks 3 and 4.
4. The facilitator (stars-demo) path must be untouched: `cacheSystemPrompt('string')` still returns one marked block — pinned in Task 2.
5. Marker-count guard: with a volatile block present plus an attachment marker plus the last-message marker, total markers stay ≤ 4 — pinned in Task 2.

---

### Task 1: `buildSystemPromptParts` in `lib/agent/system-prompt.ts`

**Files:**
- Modify: `lib/agent/system-prompt.ts` (the `buildSystemPrompt` function, lines 55–258)
- Test: `lib/agent/__tests__/system-prompt.test.ts` (append a new `describe`)

**Interfaces:**
- Consumes: nothing new.
- Produces:
  ```ts
  export type SystemPromptParts = { stable: string; volatile: string | null }
  export function buildSystemPromptParts(input: SystemPromptInput): SystemPromptParts
  export function buildSystemPrompt(input: SystemPromptInput): string  // unchanged signature
  ```
  `volatile` is `null` when there is nothing volatile (no gap ≥ 1h, no prototype feedback, no prototype context). Tasks 2–4 rely on exactly these names.

- [ ] **Step 1: Write the failing tests**

Append to `lib/agent/__tests__/system-prompt.test.ts` (after the last `describe` block; add `buildSystemPromptParts` to the existing import from `'../system-prompt'`):

```ts
// =============================================================================
// buildSystemPromptParts — stable vs volatile split for prompt caching
//
// The chat route caches the system prompt. Anything that changes between two
// back-to-back turns (the ≥1h "Returning after a break" block, prototype age
// labels like "3 days ago") must live in `volatile` so the cached `stable`
// prefix is byte-identical across a return visit.
// =============================================================================

describe('buildSystemPromptParts', () => {
  const HOUR = 60 * 60 * 1000

  it('returns volatile: null when nothing volatile is present', () => {
    const parts = buildSystemPromptParts(minimalInput)
    expect(parts.volatile).toBeNull()
    expect(parts.stable).toContain(DEFAULT_IDENTITY)
  })

  it('puts the gap block in volatile and keeps stable byte-identical across turn 1 (gap) and turn 2 (no gap)', () => {
    const turn1 = buildSystemPromptParts({ ...minimalInput, sessionNumber: 2, gapSinceLastMakerMessageMs: 3 * HOUR })
    const turn2 = buildSystemPromptParts({ ...minimalInput, sessionNumber: 2, gapSinceLastMakerMessageMs: 60 * 1000 })
    expect(turn1.volatile).toContain('## Returning after a break')
    expect(turn1.stable).not.toContain('## Returning after a break')
    expect(turn2.volatile).toBeNull()
    expect(turn1.stable).toBe(turn2.stable)
  })

  it('puts prototype feedback and prototype context blocks in volatile', () => {
    const parts = buildSystemPromptParts({
      ...minimalInput,
      prototypeFeedback: [
        { type: 'bug', body: 'Checkout button does nothing', path: '/checkout', ageLabel: 'today', resolved: false },
      ],
      prototypeContext: [
        { route: '/checkout', title: 'Checkout', outline: '# Checkout\n- Pay', ageLabel: '2 days ago' },
      ],
    })
    expect(parts.volatile).toContain('## What the maker has reported from the prototype')
    expect(parts.volatile).toContain("## What the maker's screen looked like (structure)")
    expect(parts.stable).not.toContain('## What the maker has reported from the prototype')
    expect(parts.stable).not.toContain("## What the maker's screen looked like (structure)")
  })

  it('keeps pinned artifacts and sibling decisions in stable (they carry no age labels)', () => {
    const parts = buildSystemPromptParts({
      ...minimalInput,
      pinnedArtifacts: [{ kind: 'link', name: 'Figma board', description: 'Early sketches', url: 'https://example.com' }],
      siblingDecisions: [{ projectTitle: 'Sibling', topic: 'Auth', decision: 'Google only' }],
    })
    expect(parts.stable).toContain('Figma board')
    expect(parts.stable).toContain('Google only')
    expect(parts.volatile).toBeNull()
  })

  it('buildSystemPrompt is the two parts joined by a blank line', () => {
    const input = { ...minimalInput, sessionNumber: 2, gapSinceLastMakerMessageMs: 3 * HOUR }
    const parts = buildSystemPromptParts(input)
    expect(buildSystemPrompt(input)).toBe(`${parts.stable}\n\n${parts.volatile}`)
    expect(buildSystemPrompt(minimalInput)).toBe(buildSystemPromptParts(minimalInput).stable)
  })
})
```

Note for the implementer: the `pinnedArtifacts` and `siblingDecisions` item shapes above are illustrative — read `lib/agent/artifact-context.ts` (`ArtifactContextItem`) and `lib/agent/sibling-decisions.ts` (`SiblingDecision`) and use whatever fields those types actually require, keeping the assertions on the visible strings. The block headings for prototype feedback/context are the exact strings already used in `lib/agent/prototype-feedback.ts` and `lib/agent/prototype-context.ts`; copy them from there if the ones above differ.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run lib/agent/__tests__/system-prompt.test.ts`
Expected: FAIL — `buildSystemPromptParts` is not exported.

- [ ] **Step 3: Implement `buildSystemPromptParts`**

In `lib/agent/system-prompt.ts`:

1. Add the exported type right above `buildSystemPrompt`:

```ts
// The prompt is sent as two system blocks (lib/agent/prompt-cache.ts):
// `stable` is cache-marked and must be byte-identical from one turn to the
// next; `volatile` is sent uncached and holds the parts that legitimately
// change between back-to-back turns — the "Returning after a break" block
// (present on turn 1 of a return visit, gone on turn 2) and the prototype
// blocks (their "3 days ago" labels roll over daily). Keeping them out of the
// cached prefix is what makes turn 2 a cache read instead of a second write.
export type SystemPromptParts = { stable: string; volatile: string | null }
```

2. Rename the existing function body to `buildSystemPromptParts(...)`: `SystemPromptParts`. Inside it, add a second array `const volatileParts: string[] = []` next to `parts`. Change exactly these three pushes to go to `volatileParts` instead of `parts`:
   - the `prototypeFeedback` block (`renderPrototypeFeedbackBlock`)
   - the `prototypeContext` block (`renderPrototypeContextBlock`)
   - the `gapSinceLastMakerMessageMs >= ONE_HOUR_MS` block (`## Returning after a break`)

   Leave `pinnedArtifacts` and `siblingDecisions` in `parts`. Leave the `## Context` block in `parts` (it is keyed on `sessionNumber`, which is stable). Replace the final `return parts.join('\n\n')` with:

```ts
  return {
    stable: parts.join('\n\n'),
    volatile: volatileParts.length > 0 ? volatileParts.join('\n\n') : null,
  }
```

3. Re-add `buildSystemPrompt` as the join:

```ts
// Single-string form, used by tests and anywhere caching doesn't matter.
export function buildSystemPrompt(input: SystemPromptInput): string {
  const { stable, volatile } = buildSystemPromptParts(input)
  return volatile ? `${stable}\n\n${volatile}` : stable
}
```

4. Update the header comment on `SystemPromptInput` (lines 10–12) to mention that the live-read fields end up in the volatile block.

- [ ] **Step 4: Run the whole system-prompt suite**

Run: `npx vitest run lib/agent/__tests__/system-prompt.test.ts lib/agent/__tests__/facilitator-prompt.test.ts`
Expected: PASS, including every pre-existing test (the gap-humanizing `it.each` still finds its phrase because `buildSystemPrompt` joins both parts).

- [ ] **Step 5: Commit**

```bash
git add lib/agent/system-prompt.ts lib/agent/__tests__/system-prompt.test.ts
git commit -m "feat(agent): split volatile system-prompt blocks out of the cacheable prefix

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 2: Two-block system in `lib/agent/prompt-cache.ts`

**Files:**
- Modify: `lib/agent/prompt-cache.ts`
- Test: `lib/agent/__tests__/prompt-cache.test.ts`

**Interfaces:**
- Consumes: `SystemPromptParts` from Task 1 (`import type { SystemPromptParts } from './system-prompt'`).
- Produces:
  ```ts
  export function cacheSystemPrompt(system: string | SystemPromptParts): Anthropic.TextBlockParam[]
  export function applyPromptCaching<M extends CacheableMessage>(
    system: string | SystemPromptParts,
    messages: M[]
  ): { system: Anthropic.TextBlockParam[]; messages: M[] }
  ```
  Behaviour: a string → one marked block (unchanged). Parts → `[{ text: stable, cache_control }, { text: volatile }]` when `volatile` is a non-empty string, else just the marked block.

- [ ] **Step 1: Write the failing tests**

Append to `lib/agent/__tests__/prompt-cache.test.ts` (add `cacheSystemPrompt` to the import):

```ts
describe('two-block system prompt (stable cached, volatile uncached)', () => {
  it('cacheSystemPrompt keeps the single-string form: one marked block', () => {
    expect(cacheSystemPrompt('You are Sam.')).toEqual([
      { type: 'text', text: 'You are Sam.', cache_control: { type: 'ephemeral' } },
    ])
  })

  it('cacheSystemPrompt emits a marked stable block followed by an unmarked volatile block', () => {
    expect(cacheSystemPrompt({ stable: 'STABLE', volatile: 'VOLATILE' })).toEqual([
      { type: 'text', text: 'STABLE', cache_control: { type: 'ephemeral' } },
      { type: 'text', text: 'VOLATILE' },
    ])
  })

  it('cacheSystemPrompt sends only the stable block when volatile is null or empty', () => {
    expect(cacheSystemPrompt({ stable: 'STABLE', volatile: null })).toHaveLength(1)
    expect(cacheSystemPrompt({ stable: 'STABLE', volatile: '' })).toHaveLength(1)
  })

  it('applyPromptCaching accepts parts and never counts the volatile block as a marker', () => {
    const input: CacheableMessage[] = [
      {
        role: 'user',
        content: [
          { type: 'document', cache_control: { type: 'ephemeral' } },
          { type: 'text', text: 'first' },
        ],
      },
      {
        role: 'user',
        content: [
          { type: 'document', cache_control: { type: 'ephemeral' } },
          { type: 'text', text: 'second' },
        ],
      },
      { role: 'assistant', content: 'ok' },
      { role: 'user', content: 'third' },
    ]
    const { system, messages } = applyPromptCaching({ stable: 'STABLE', volatile: 'VOLATILE' }, input)
    expect(system).toHaveLength(2)
    expect(system[1].cache_control).toBeUndefined()

    let markers = system.filter((b) => b.cache_control).length
    for (const m of messages) {
      if (typeof m.content === 'string') continue
      markers += m.content.filter((b) => b.cache_control).length
    }
    expect(markers).toBeLessThanOrEqual(4)
    // The last-message marker is still placed.
    const last = messages[messages.length - 1].content as { cache_control?: unknown }[]
    expect(last[last.length - 1].cache_control).toEqual({ type: 'ephemeral' })
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run lib/agent/__tests__/prompt-cache.test.ts`
Expected: FAIL — TypeScript/runtime error on the object argument (`system.text` undefined / type mismatch).

- [ ] **Step 3: Implement**

In `lib/agent/prompt-cache.ts`:

```ts
import type { SystemPromptParts } from './system-prompt'
```

Replace `cacheSystemPrompt`:

```ts
// Wraps a system prompt into the text blocks Anthropic's `system` param
// expects. A plain string becomes one cache-marked block. SystemPromptParts
// becomes a cache-marked `stable` block followed by an UNMARKED `volatile`
// block: Anthropic caches the prefix up to the last marker, so the volatile
// tail (gap recap, prototype age labels — lib/agent/system-prompt.ts) can
// change every turn without invalidating the cached prefix. Shared by
// applyPromptCaching (chat), kickoff (app/api/chat/kickoff/route.ts) and
// the stars-demo facilitator (string form).
export function cacheSystemPrompt(system: string | SystemPromptParts): Anthropic.TextBlockParam[] {
  const stable = typeof system === 'string' ? system : system.stable
  const volatile = typeof system === 'string' ? null : system.volatile
  const blocks: Anthropic.TextBlockParam[] = [{ type: 'text', text: stable, cache_control: CACHE_CONTROL }]
  if (volatile) blocks.push({ type: 'text', text: volatile })
  return blocks
}
```

Change the `applyPromptCaching` signature's first parameter to `system: string | SystemPromptParts` (body unchanged — it already calls `cacheSystemPrompt(system)`). The marker guard counts `1` for the system marker; that stays correct because only the stable block is marked. Keep the existing kickoff-specific paragraph in the comment but move it next to the kickoff route's own comment if it reads awkwardly after the rewrite — the implementer's call, as long as the "why kickoff doesn't mark messages" rationale survives somewhere.

- [ ] **Step 4: Run tests + type-check**

Run: `npx vitest run lib/agent/__tests__/prompt-cache.test.ts && npx tsc --noEmit -p tsconfig.json 2>&1 | head -20`
Expected: PASS; no type errors in `lib/agent/prompt-cache.ts` or `lib/integration/facilitator.ts`.

- [ ] **Step 5: Commit**

```bash
git add lib/agent/prompt-cache.ts lib/agent/__tests__/prompt-cache.test.ts
git commit -m "feat(agent): cacheSystemPrompt emits an unmarked volatile block after the cached one

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 3: Chat route sends the two-block system

**Files:**
- Modify: `app/api/chat/route.ts` (import at line 4; the `buildSystemPrompt(...)` call at ~line 350; the `applyPromptCaching` call at ~line 375)
- Test: `app/api/chat/__tests__/chat.test.ts` (the `vi.mock('@/lib/agent/system-prompt', …)` at ~line 133; the caching test at ~line 325; the two `expect(buildSystemPrompt).toHaveBeenCalledWith(` assertions at ~lines 547 and 625)
- Test: `app/api/chat/__tests__/chat-attachments.test.ts` (the mock at ~line 85)

**Interfaces:**
- Consumes: `buildSystemPromptParts` (Task 1), `applyPromptCaching(parts, messages)` (Task 2).

- [ ] **Step 1: Update the mocks and write the failing test**

In `app/api/chat/__tests__/chat.test.ts`:

1. Change the import on line 3 to `import { buildSystemPromptParts } from '@/lib/agent/system-prompt'`.
2. Change the mock to:

```ts
vi.mock('@/lib/agent/system-prompt', () => ({
  buildSystemPromptParts: vi.fn(() => ({ stable: 'You are a helpful assistant', volatile: null })),
}))
```

3. Replace every `expect(buildSystemPrompt).toHaveBeenCalledWith(` with `expect(buildSystemPromptParts).toHaveBeenCalledWith(` (the argument matchers stay the same — the input object is unchanged).
4. Add a new test right after `'marks the system prompt and the last message for prompt caching'`:

```ts
  it('sends the volatile part as a second, unmarked system block', async () => {
    vi.mocked(buildSystemPromptParts).mockReturnValueOnce({
      stable: 'You are a helpful assistant',
      volatile: '## Returning after a break\n\nThe user is coming back after a gap of a few hours.',
    })
    const res = await POST(makeRequest({ session_id: 's1', content: 'Hello' }))
    await readSSE(res)

    expect(capturedStreamArgs?.system).toEqual([
      { type: 'text', text: 'You are a helpful assistant', cache_control: { type: 'ephemeral' } },
      { type: 'text', text: '## Returning after a break\n\nThe user is coming back after a gap of a few hours.' },
    ])
  })
```

In `app/api/chat/__tests__/chat-attachments.test.ts`, change the mock to export `buildSystemPromptParts: vi.fn(() => ({ stable: 'system', volatile: null }))` instead of `buildSystemPrompt`. If any assertion in that file reads `capturedStreamArgs.system[0].text === 'system'` it stays valid.

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run app/api/chat/__tests__/chat.test.ts app/api/chat/__tests__/chat-attachments.test.ts`
Expected: FAIL — the route still imports `buildSystemPrompt`, which the mock no longer provides.

- [ ] **Step 3: Switch the route**

In `app/api/chat/route.ts`:
- line 4: `import { buildSystemPromptParts } from '@/lib/agent/system-prompt'`
- ~line 350: `const systemPrompt = buildSystemPromptParts({ … })` (same argument object).
- The comment above `applyPromptCaching` (~line 372) gains one sentence: *"The volatile tail (gap recap, prototype age labels) rides in a second, unmarked block so the cached prefix stays byte-identical across a return visit."*
- `applyPromptCaching(systemPrompt, claudeMessages)` is unchanged (it now receives parts).

- [ ] **Step 4: Run tests**

Run: `npx vitest run app/api/chat`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/api/chat/route.ts app/api/chat/__tests__/chat.test.ts app/api/chat/__tests__/chat-attachments.test.ts
git commit -m "feat(chat): send the volatile system block uncached after the cached prefix

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 4: Kickoff route sends the two-block system

**Files:**
- Modify: `app/api/chat/kickoff/route.ts` (import at line 4; `buildSystemPrompt(...)` at ~line 246; comment + `cacheSystemPrompt(systemPrompt)` at ~lines 268–274)
- Test: `app/api/chat/kickoff/__tests__/kickoff.test.ts` (mock at ~line 111; caching test at ~line 230)

**Interfaces:**
- Consumes: `buildSystemPromptParts` (Task 1), `cacheSystemPrompt(parts)` (Task 2).

- [ ] **Step 1: Update the mock and write the failing test**

In `app/api/chat/kickoff/__tests__/kickoff.test.ts`, change the mock to:

```ts
vi.mock('@/lib/agent/system-prompt', () => ({
  buildSystemPromptParts: vi.fn(() => ({ stable: 'You are a helpful assistant', volatile: null })),
}))
```

(If the file imports `buildSystemPrompt` by name anywhere, switch it to `buildSystemPromptParts`.) Add after the existing caching test:

```ts
  it('sends the gap recap as a second, unmarked system block so the cached prefix matches the next /api/chat turn', async () => {
    const { buildSystemPromptParts } = await import('@/lib/agent/system-prompt')
    vi.mocked(buildSystemPromptParts).mockReturnValueOnce({
      stable: 'You are a helpful assistant',
      volatile: '## Returning after a break\n\nrecap',
    })
    setup({
      messages: [msg('agent', 5 * HOUR), msg('user', 3 * HOUR), msg('agent', 3 * HOUR)],
      lastMakerMessageAt: iso(3 * HOUR),
    })
    await drain(await POST(makeRequest({ session_id: 'sess-1' })))

    expect(capturedStreamArgs?.system).toEqual([
      { type: 'text', text: 'You are a helpful assistant', cache_control: { type: 'ephemeral' } },
      { type: 'text', text: '## Returning after a break\n\nrecap' },
    ])
  })
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run app/api/chat/kickoff`
Expected: FAIL — route imports `buildSystemPrompt`.

- [ ] **Step 3: Switch the route**

In `app/api/chat/kickoff/route.ts`:
- line 4: `import { buildSystemPromptParts } from '@/lib/agent/system-prompt'`
- ~line 246: `const systemPrompt = buildSystemPromptParts({ … })`
- Rewrite the comment above `cacheSystemPrompt` to:

```ts
  // Cache the stable system block only. Kickoff never advances
  // last_maker_message_at, and the gap recap now rides in the uncached
  // volatile block, so the cached prefix here is byte-identical to the
  // maker's very next /api/chat turn — a real cache read. The messages end
  // in a synthetic turn that's never sent again, so marking them would only
  // pay the cache-write premium for no read — see lib/agent/prompt-cache.ts.
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run app/api/chat/kickoff`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/api/chat/kickoff/route.ts app/api/chat/kickoff/__tests__/kickoff.test.ts
git commit -m "feat(kickoff): cache only the stable system block

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 5: Docs + full verification

**Files:**
- Modify: `docs/superpowers/plans/2026-09-18-chat-prompt-caching.md` (append a short "Follow-up shipped" note at the end)
- Modify: `CLAUDE.md` § Next Steps, the "Prompt caching for the chat agent" paragraph: replace the sentence beginning `**Follow-up PR:** move volatile system-prompt content …` with `**Follow-up SHIPPED (this branch):** volatile content (gap recap, prototype blocks) now rides in a second, unmarked system block (\`buildSystemPromptParts\` → \`cacheSystemPrompt\`), so a return visit's turn 2 reads the prefix turn 1 wrote. Verify on prod \`api_usage\` (route \`chat\`): back-to-back turns after a ≥1h gap should show a cache read on turn 2.`
- Modify: `docs/changelog.md` — prepend one entry (newest first, follow the file's existing `**Shipped <date> (...)**` style) summarising the change in 2–4 sentences.

- [ ] **Step 1: Make the doc edits above**

- [ ] **Step 2: Full verification**

Run, in order, and paste the tail of each into the report:

```bash
npm test
npm run type-check
npm run build
npm run lint
```

Expected: all four exit 0.

- [ ] **Step 3: Commit**

```bash
git add CLAUDE.md docs/changelog.md docs/superpowers/plans/2026-09-18-chat-prompt-caching.md
git commit -m "docs: prompt-caching follow-up — volatile block shipped

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```
