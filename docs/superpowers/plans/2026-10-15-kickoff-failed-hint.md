# Kickoff-Failed Empty-State Hint — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When the agent's automatic greeting (kickoff) fails on an empty return session, show the maker a specific, friendly hint ("Sam couldn't start the conversation just now — say hello to begin.") instead of the generic "Send a message to start the conversation." so a network blip doesn't read as a broken product.

**Architecture:** `useStreamingChat` gains a `kickoffFailed: boolean` state, set in the `kickoff()` catch path (and on a non-OK, non-SSE response that is *not* a deliberate decline), cleared when the maker sends a message. `MakerProjectView`'s empty-state branch picks the hint copy when `kickoffFailed` is true. Copy lives in `lib/copy.ts` (EN) and `lib/copy-maker.ts` (FR), like every other maker string.

**Tech Stack:** React 19, React Query, vitest + @testing-library/react (jsdom).

**Spec:** `CLAUDE.md` § Next Steps → "Blank-second-conversation fix" follow-up (2): *"a static empty-state hint in the maker chat for when the kickoff call itself fails (still a blank screen today)."* The generic `makerEmptyState` copy already exists (`lib/copy.ts:210`); this plan adds the kickoff-specific variant.

## Global Constraints

- A failed greeting must **never** block the composer or set the chat `error` banner (existing contract in `useStreamingChat.kickoff`, comment lines 119–123 and 143–146). The hint is passive text only.
- A **declined** kickoff (route answers JSON `{ kicked_off: false, … }` with status 200) is not a failure — no hint.
- All user-facing copy goes through `lib/copy.ts` / `lib/copy-maker.ts`; never inline strings in the component. The agent's name is "Sam" in the default identity; use the existing pattern in `lib/copy.ts` for naming the agent if one exists (grep `Sam` in `lib/copy.ts`), else write "Sam" literally as the other maker strings do.
- French copy is required for every new maker string (`lib/copy-maker.ts` has a `fr` block mirroring the `en` keys).
- Commit messages end with the line `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.
- Before claiming clean, run `npm test`, `npm run type-check`, `npm run build`.

## Review Focus

1. Network error thrown by `apiFetch` during kickoff → `kickoffFailed` true, no `error` set, `streaming` back to false — pinned in Task 1.
2. HTTP 500 from the kickoff route (non-OK, JSON) → `kickoffFailed` true — pinned in Task 1.
3. HTTP 200 JSON decline (`kicked_off: false`) → `kickoffFailed` stays false — pinned in Task 1.
4. Stream that fails mid-way after the placeholder was added → placeholder removed (existing behaviour) AND `kickoffFailed` true — pinned in Task 1.
5. The hint must disappear once the maker sends a message (the empty-state branch is gone anyway once a message exists, but `kickoffFailed` must also reset so a later remount doesn't resurrect it) — pinned in Task 1 (`streamMessage` resets it) and Task 2 renders only in the empty branch.

---

### Task 1: `kickoffFailed` in `useStreamingChat`

**Files:**
- Modify: `lib/hooks/useStreamingChat.ts`
- Test: `lib/hooks/__tests__/useStreamingChat.test.tsx` (exists — append to it; it already mocks `apiFetch` at the module boundary and provides `sseResponse(chunks)` / `wrapper` helpers)

**Interfaces:**
- Produces: `useStreamingChat()` return gains `kickoffFailed: boolean`. Task 2 reads it.

- [ ] **Step 1: Write the failing tests**

Append to the existing `lib/hooks/__tests__/useStreamingChat.test.tsx`. Its helpers: `mockApiFetch` (module-level `vi.fn()`), `sseResponse(chunks: string[], status = 200)` where each chunk is a **raw SSE fragment** (e.g. `'data: {"text":"Hey"}\n\n'`, terminated by `'data: [DONE]\n\n'`), and `wrapper`. Replace the `sseResponse(['Hey ', 'Sam'])`-style calls below with raw fragments, e.g. `sseResponse(['data: {"text":"Hey "}\n\n', 'data: {"text":"Sam"}\n\n', 'data: [DONE]\n\n'])`. If the file already has a `describe('useStreamingChat — kickoff', …)` block, add the new `it`s inside it and keep its existing tests untouched.

```ts
describe('useStreamingChat — kickoff: kickoffFailed', () => {
  it('starts false', () => {
    const { result } = renderHook(() => useStreamingChat({ projectId: 'p1' }), { wrapper })
    expect(result.current.kickoffFailed).toBe(false)
  })

  it('is true after a thrown network error, with no error banner and streaming reset', async () => {
    mockApiFetch.mockRejectedValueOnce(new Error('Failed to fetch'))
    const { result } = renderHook(() => useStreamingChat({ projectId: 'p1' }), { wrapper })
    await act(async () => { await result.current.kickoff('s1') })
    expect(result.current.kickoffFailed).toBe(true)
    expect(result.current.error).toBeNull()
    expect(result.current.streaming).toBe(false)
    expect(result.current.messages).toEqual([])
  })

  it('is true after a non-OK response', async () => {
    mockApiFetch.mockResolvedValueOnce(new Response('{"error":"boom"}', { status: 500, headers: { 'Content-Type': 'application/json' } }))
    const { result } = renderHook(() => useStreamingChat({ projectId: 'p1' }), { wrapper })
    await act(async () => { await result.current.kickoff('s1') })
    expect(result.current.kickoffFailed).toBe(true)
    expect(result.current.error).toBeNull()
  })

  it('stays false on a deliberate 200 JSON decline', async () => {
    mockApiFetch.mockResolvedValueOnce(new Response('{"kicked_off":false,"reason":"no_prior_maker_activity"}', { status: 200, headers: { 'Content-Type': 'application/json' } }))
    const { result } = renderHook(() => useStreamingChat({ projectId: 'p1' }), { wrapper })
    await act(async () => { await result.current.kickoff('s1') })
    expect(result.current.kickoffFailed).toBe(false)
  })

  it('stays false after a greeting streams successfully', async () => {
    mockApiFetch.mockResolvedValueOnce(sseResponse(['Hey ', 'Sam']))
    const { result } = renderHook(() => useStreamingChat({ projectId: 'p1' }), { wrapper })
    await act(async () => { await result.current.kickoff('s1') })
    expect(result.current.kickoffFailed).toBe(false)
    expect(result.current.messages).toHaveLength(1)
    expect(result.current.messages[0].content).toBe('Hey Sam')
  })

  it('is true and the placeholder is dropped when the stream breaks mid-way', async () => {
    const broken = new Response(
      new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('data: {"text":"Hey"}\n\n'))
          controller.error(new Error('connection reset'))
        },
      }),
      { status: 200, headers: { 'Content-Type': 'text/event-stream' } },
    )
    mockApiFetch.mockResolvedValueOnce(broken)
    const { result } = renderHook(() => useStreamingChat({ projectId: 'p1' }), { wrapper })
    await act(async () => { await result.current.kickoff('s1') })
    expect(result.current.kickoffFailed).toBe(true)
    expect(result.current.messages).toEqual([])
  })

  it('resets to false when the maker sends a message', async () => {
    mockApiFetch.mockRejectedValueOnce(new Error('Failed to fetch'))
    const { result } = renderHook(() => useStreamingChat({ projectId: 'p1' }), { wrapper })
    await act(async () => { await result.current.kickoff('s1') })
    expect(result.current.kickoffFailed).toBe(true)

    mockApiFetch.mockResolvedValueOnce(sseResponse(['Hi!']))
    await act(async () => { await result.current.streamMessage('s1', 'hello') })
    expect(result.current.kickoffFailed).toBe(false)
  })
})
```

Note: the file is `.test.ts` but contains JSX in `wrapper` — name it `useStreamingChat.test.tsx` instead. Check `vitest.config.*` / an existing `.test.tsx` under `lib/query/__tests__` for the jsdom + React setup pattern and mirror it.

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run lib/hooks/__tests__/useStreamingChat.test.tsx`
Expected: FAIL — `kickoffFailed` is `undefined`.

- [ ] **Step 3: Implement**

In `lib/hooks/useStreamingChat.ts`:

1. Add state after `error`:

```ts
  // A kickoff greeting that failed (network error, 5xx, or a stream that
  // broke mid-way). Not the same as a deliberate decline (200 JSON). The
  // maker view uses it to swap the generic empty-state line for a hint that
  // the greeting failed — a blank chat otherwise reads as a broken product.
  const [kickoffFailed, setKickoffFailed] = useState(false)
```

2. In `streamMessage`, right after `setStreaming(true)`: `setKickoffFailed(false)`.

3. In `kickoff`, replace the early-return line:

```ts
      if (!res.ok || !res.headers.get('Content-Type')?.includes('text/event-stream')) return
```

with:

```ts
      const isStream = res.headers.get('Content-Type')?.includes('text/event-stream')
      if (!res.ok) {
        setKickoffFailed(true)
        return
      }
      // A 200 that isn't a stream is the route declining on purpose — silent.
      if (!isStream) return
```

4. In the `catch` of `kickoff`, add `setKickoffFailed(true)` as the first statement (before the placeholder cleanup).

5. Return `kickoffFailed` from the hook: `return { messages, setMessages, streaming, error, setError, streamMessage, kickoff, kickoffFailed }`.

- [ ] **Step 4: Run tests**

Run: `npx vitest run lib/hooks`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/hooks/useStreamingChat.ts lib/hooks/__tests__/useStreamingChat.test.tsx
git commit -m "feat(chat): track a failed kickoff greeting in useStreamingChat

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 2: Hint copy + empty-state render in `MakerProjectView`

**Files:**
- Modify: `lib/copy.ts` — next to `makerEmptyState` (~line 210) add `makerKickoffFailed`.
- Modify: `lib/copy-maker.ts` — add `kickoffFailed` to the `chat` object in both the EN mapping (~line 129, `emptyState: copy.chat.makerEmptyState`) and the FR block (~line 314).
- Modify: `components/maker/MakerProjectView.tsx` — destructure `kickoffFailed` from `useStreamingChat` (~line 242) and use it in the empty-state branch (~line 608–611).
- Test: `components/maker/__tests__/MakerProjectView.test.tsx` — the `useStreamingChat` mock (~line 70) and a new test.

**Interfaces:**
- Consumes: `kickoffFailed` from Task 1.

- [ ] **Step 1: Write the failing test**

In `components/maker/__tests__/MakerProjectView.test.tsx`:

1. Make the `useStreamingChat` mock configurable. Replace the existing mock with:

```ts
const mockStreamMessage = vi.fn()
let mockKickoffFailed = false

vi.mock('@/lib/hooks/useStreamingChat', () => ({
  useStreamingChat: () => ({
    messages: [],
    setMessages: vi.fn(),
    streaming: false,
    error: null,
    setError: vi.fn(),
    streamMessage: mockStreamMessage,
    kickoff: vi.fn(),
    kickoffFailed: mockKickoffFailed,
  }),
}))
```

and in `beforeEach` add `mockKickoffFailed = false`.

2. Add inside `describe('MakerProjectView', …)`:

```ts
  it('shows the generic empty-state line when the chat is empty and no kickoff failed', () => {
    renderView()
    expect(screen.getByText('Send a message to start the conversation.')).toBeTruthy()
  })

  it('shows the kickoff-failed hint instead when the greeting failed', () => {
    mockKickoffFailed = true
    renderView()
    expect(screen.getByText("Sam couldn't start the conversation just now — say hello to begin.")).toBeTruthy()
    expect(screen.queryByText('Send a message to start the conversation.')).toBeNull()
    // The composer stays usable.
    expect(document.querySelectorAll('textarea').length).toBeGreaterThan(0)
  })
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run components/maker/__tests__/MakerProjectView.test.tsx`
Expected: the second new test FAILS (hint text not found).

- [ ] **Step 3: Implement**

`lib/copy.ts`, directly after `makerEmptyState`:

```ts
    // Shown in place of makerEmptyState when the agent's automatic greeting
    // (kickoff) failed — a blank chat otherwise reads as broken.
    makerKickoffFailed: "Sam couldn't start the conversation just now — say hello to begin.",
```

`lib/copy-maker.ts`, EN mapping after `emptyState`:

```ts
    kickoffFailed: copy.chat.makerKickoffFailed,
```

FR block after `emptyState`:

```ts
    kickoffFailed: 'Sam n’a pas pu lancer la conversation — dites bonjour pour commencer.',
```

(If the FR block is typed against the EN shape, TypeScript will tell you if a key is missing.)

`components/maker/MakerProjectView.tsx`:
- line ~242: add `kickoffFailed` to the destructure.
- empty-state branch:

```tsx
      ) : displayMessages.length === 0 ? (
        <div className="text-center text-brand-slate py-8">
          <MessageSquare className="h-10 w-10 mx-auto mb-3 text-gray-300" />
          <p>{kickoffFailed ? c.kickoffFailed : c.emptyState}</p>
        </div>
      ) : (
```

- [ ] **Step 4: Run tests + type-check**

Run: `npx vitest run components/maker lib/hooks && npm run type-check`
Expected: PASS, no type errors.

- [ ] **Step 5: Commit**

```bash
git add lib/copy.ts lib/copy-maker.ts components/maker/MakerProjectView.tsx components/maker/__tests__/MakerProjectView.test.tsx
git commit -m "feat(maker): show a hint when the kickoff greeting fails

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 3: Docs + full verification

**Files:**
- Modify: `CLAUDE.md` § Next Steps → "Blank-second-conversation fix" paragraph: in the `**Follow-ups, none started:**` list, change item (2) to `(2) ~~a static empty-state hint …~~ SHIPPED (this branch): \`kickoffFailed\` in \`useStreamingChat\` swaps the empty-state line for \`makerKickoffFailed\` copy;` and change the lead-in from "none started" to "(2) shipped".
- Modify: `docs/changelog.md` — prepend one entry in the existing style, 2 sentences.

- [ ] **Step 1: Make the edits**

- [ ] **Step 2: Full verification**

```bash
npm test
npm run type-check
npm run build
npm run lint
```

Expected: all exit 0.

- [ ] **Step 3: Commit**

```bash
git add CLAUDE.md docs/changelog.md
git commit -m "docs: kickoff-failed hint shipped

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```
