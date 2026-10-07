# Phone-friendly maker composer — Implementation Plan (#183)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** On a phone the maker can see what they are typing (the box grows with the text) and Enter inserts a newline; on desktop Enter still sends and Shift+Enter inserts a newline.

**Architecture:** One pure decision function (`shouldSendOnEnter`) and one pure sizing function (`composerHeightPx`) in `lib/chat/composer.ts`, unit-tested in isolation. A tiny `useCoarsePointer()` hook wraps `matchMedia('(pointer: coarse)')`. `MakerProjectView.tsx` consumes both: the textarea auto-grows up to a cap and the key handler asks the pure function. No new copy, no layout rework.

**Tech Stack:** React 19, Tailwind v4, Vitest + Testing Library (jsdom for the component test).

**Spec:** GitHub issue #183 (https://github.com/nicolovejoy/ibuild4you/issues/183). Design decisions recorded here because Nico delegated the design (2026-10-07).

## Global Constraints

- Desktop behaviour is unchanged: Enter sends, Shift+Enter newlines.
- Touch detection is `(pointer: coarse)`, not user-agent sniffing. SSR-safe: default `false` when `window` or `matchMedia` is missing.
- The textarea keeps `font-size: 16px` or larger on touch (`text-base`) — iOS Safari zooms the page on focus for anything smaller, which is part of "can't see what you're typing".
- IME composition (`event.nativeEvent.isComposing`) never sends — Japanese/Chinese keyboards commit candidates with Enter.
- Code style: clear over clever; comment the non-obvious.
- Run `npm test`, `npm run type-check`, `npm run lint` before every commit. In a worktree also run `npm run build` before claiming clean (CLAUDE.md: type-check alone is a false green in a worktree).

## Review Focus

1. Enter during IME composition on desktop must not send — Task 1 pins `shouldSendOnEnter` returning false when `isComposing` is true.
2. A single very long unbroken word on a phone must not grow the box past the cap — Task 1 pins `composerHeightPx` clamping to `COMPOSER_MAX_PX`.
3. After a successful send the box must shrink back to one line, not stay tall and empty — Task 3 pins this by asserting the inline height resets when `input` becomes `''`.
4. `matchMedia` missing (old WebView, jsdom without a shim) must not throw on first render — Task 2 pins the hook returning `false` when `window.matchMedia` is undefined.
5. The disabled state (streaming/uploading) must still render the grown height without flicker — covered by Task 3 keeping height derived from `input`, not from `disabled`.

---

### Task 1: Pure composer helpers

**Files:**
- Create: `lib/chat/composer.ts`
- Test: `lib/chat/__tests__/composer.test.ts`

**Interfaces:**
- Produces:
  - `shouldSendOnEnter(args: { key: string; shiftKey: boolean; isComposing: boolean; coarsePointer: boolean }): boolean`
  - `COMPOSER_MAX_PX = 200` and `composerHeightPx(scrollHeight: number): number` → `Math.min(scrollHeight, COMPOSER_MAX_PX)`, never below 0.

- [ ] **Step 1: Write the failing tests**

```ts
// lib/chat/__tests__/composer.test.ts
import { describe, it, expect } from 'vitest'
import { shouldSendOnEnter, composerHeightPx, COMPOSER_MAX_PX } from '../composer'

const base = { key: 'Enter', shiftKey: false, isComposing: false, coarsePointer: false }

describe('shouldSendOnEnter', () => {
  it('sends on plain Enter with a fine pointer (desktop)', () => {
    expect(shouldSendOnEnter(base)).toBe(true)
  })
  it('does not send on Shift+Enter (desktop newline)', () => {
    expect(shouldSendOnEnter({ ...base, shiftKey: true })).toBe(false)
  })
  it('does not send on Enter with a coarse pointer (phone newline)', () => {
    expect(shouldSendOnEnter({ ...base, coarsePointer: true })).toBe(false)
  })
  it('does not send while an IME composition is in progress', () => {
    expect(shouldSendOnEnter({ ...base, isComposing: true })).toBe(false)
  })
  it('ignores every other key', () => {
    expect(shouldSendOnEnter({ ...base, key: 'a' })).toBe(false)
    expect(shouldSendOnEnter({ ...base, key: 'Tab' })).toBe(false)
  })
})

describe('composerHeightPx', () => {
  it('returns the content height when under the cap', () => {
    expect(composerHeightPx(44)).toBe(44)
  })
  it('clamps to the cap so a wall of text cannot push the chat off screen', () => {
    expect(composerHeightPx(900)).toBe(COMPOSER_MAX_PX)
  })
  it('never returns a negative height', () => {
    expect(composerHeightPx(-10)).toBe(0)
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run lib/chat/__tests__/composer.test.ts`
Expected: FAIL — cannot resolve `../composer`.

- [ ] **Step 3: Implement**

```ts
// lib/chat/composer.ts
// Pure decisions for the maker chat composer (#183). Kept free of React so
// the Enter-vs-newline rule and the auto-grow cap are unit-testable.

// Tallest the composer grows before it scrolls internally. ~8 lines at the
// 16px/24px line-height we use; past that the transcript would be crowded
// out on a phone.
export const COMPOSER_MAX_PX = 200

export interface EnterDecision {
  key: string
  shiftKey: boolean
  // event.nativeEvent.isComposing — true while an IME (Japanese, Chinese,
  // Korean keyboards) is still choosing a candidate. Enter commits the
  // candidate there; it must never send the message.
  isComposing: boolean
  // (pointer: coarse) — a touch screen. There is no Shift key worth relying
  // on, so Enter means "new line" and the send button is the only submit.
  coarsePointer: boolean
}

export function shouldSendOnEnter({ key, shiftKey, isComposing, coarsePointer }: EnterDecision): boolean {
  if (key !== 'Enter') return false
  if (isComposing) return false
  if (coarsePointer) return false
  return !shiftKey
}

// Auto-grow: the textarea's scrollHeight (content height) clamped to the cap.
export function composerHeightPx(scrollHeight: number): number {
  return Math.max(0, Math.min(scrollHeight, COMPOSER_MAX_PX))
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run lib/chat/__tests__/composer.test.ts`
Expected: PASS (8 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/chat/composer.ts lib/chat/__tests__/composer.test.ts
git commit -m "feat(chat): pure Enter-vs-newline and auto-grow helpers for the composer (#183)"
```

---

### Task 2: `useCoarsePointer` hook

**Files:**
- Create: `lib/hooks/useCoarsePointer.ts`
- Test: `lib/hooks/__tests__/useCoarsePointer.test.tsx`

**Interfaces:**
- Produces: `useCoarsePointer(): boolean`.

- [ ] **Step 1: Write the failing test**

```tsx
// lib/hooks/__tests__/useCoarsePointer.test.tsx
// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest'
import { renderHook, act, cleanup } from '@testing-library/react'
import { useCoarsePointer } from '../useCoarsePointer'

type Listener = (e: { matches: boolean }) => void

function installMatchMedia(matches: boolean) {
  const listeners = new Set<Listener>()
  const mql = {
    matches,
    media: '(pointer: coarse)',
    addEventListener: (_: 'change', l: Listener) => { listeners.add(l) },
    removeEventListener: (_: 'change', l: Listener) => { listeners.delete(l) },
  }
  Object.defineProperty(window, 'matchMedia', { configurable: true, writable: true, value: vi.fn(() => mql) })
  return { fire: (m: boolean) => listeners.forEach((l) => l({ matches: m })), listeners }
}

afterEach(() => {
  cleanup()
  // @ts-expect-error — restore to "absent" between tests
  delete window.matchMedia
})

describe('useCoarsePointer', () => {
  it('is false when matchMedia is unavailable', () => {
    const { result } = renderHook(() => useCoarsePointer())
    expect(result.current).toBe(false)
  })

  it('reflects the initial media query result', () => {
    installMatchMedia(true)
    const { result } = renderHook(() => useCoarsePointer())
    expect(result.current).toBe(true)
  })

  it('updates when the query changes and unsubscribes on unmount', () => {
    const mm = installMatchMedia(false)
    const { result, unmount } = renderHook(() => useCoarsePointer())
    expect(result.current).toBe(false)
    act(() => mm.fire(true))
    expect(result.current).toBe(true)
    unmount()
    expect(mm.listeners.size).toBe(0)
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run lib/hooks/__tests__/useCoarsePointer.test.tsx`
Expected: FAIL — cannot resolve `../useCoarsePointer`.

- [ ] **Step 3: Implement**

```ts
// lib/hooks/useCoarsePointer.ts
'use client'

import { useEffect, useState } from 'react'

const QUERY = '(pointer: coarse)'

// True on touch screens (phones, tablets). Used by the chat composer to make
// Enter insert a newline instead of sending (#183). SSR-safe and tolerant of
// environments without matchMedia (old WebViews, bare jsdom): both report
// false, i.e. desktop behaviour.
export function useCoarsePointer(): boolean {
  const [coarse, setCoarse] = useState(false)

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return
    const mql = window.matchMedia(QUERY)
    setCoarse(mql.matches)
    const onChange = (e: { matches: boolean }) => setCoarse(e.matches)
    mql.addEventListener('change', onChange)
    return () => mql.removeEventListener('change', onChange)
  }, [])

  return coarse
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run lib/hooks/__tests__/useCoarsePointer.test.tsx`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/hooks/useCoarsePointer.ts lib/hooks/__tests__/useCoarsePointer.test.tsx
git commit -m "feat(hooks): useCoarsePointer — touch-screen detection via matchMedia (#183)"
```

---

### Task 3: Wire the composer in `MakerProjectView`

**Files:**
- Modify: `components/maker/MakerProjectView.tsx` — `handleKeyDown` (~line 430s), the `<textarea>` (~line 523), add an auto-grow effect next to the other hooks (~line 247).
- Test: `components/maker/__tests__/MakerProjectView.test.tsx`

**Interfaces:**
- Consumes: `shouldSendOnEnter`, `composerHeightPx` (Task 1); `useCoarsePointer` (Task 2).

- [ ] **Step 1: Read the existing component test**

Read `components/maker/__tests__/MakerProjectView.test.tsx` in full first. It already mocks the hooks the component needs and renders it with a QueryClient. Reuse its render helper and mock setup verbatim. Find how the test locates the textarea (placeholder `Type a message...`) and how `streamMessage` / `apiFetch` are mocked so you can assert "did not send".

- [ ] **Step 2: Add failing tests**

Add to that file, following its existing patterns (names below are indicative — match the file's helpers):

```tsx
describe('composer on a touch screen (#183)', () => {
  it('Enter inserts a newline instead of sending', async () => {
    // Make (pointer: coarse) match.
    Object.defineProperty(window, 'matchMedia', {
      configurable: true, writable: true,
      value: vi.fn(() => ({ matches: true, media: '(pointer: coarse)', addEventListener: vi.fn(), removeEventListener: vi.fn() })),
    })
    renderView() // the file's existing render helper
    const box = await screen.findByPlaceholderText('Type a message...') as HTMLTextAreaElement
    fireEvent.change(box, { target: { value: 'hello' } })
    fireEvent.keyDown(box, { key: 'Enter' })
    // Nothing was sent: the mocked stream/send function was not called and the text is still there.
    expect(streamMessageMock).not.toHaveBeenCalled()
    expect(box.value).toBe('hello')
  })
})

describe('composer on desktop', () => {
  it('Enter sends and the box height resets after the text clears', async () => {
    Object.defineProperty(window, 'matchMedia', {
      configurable: true, writable: true,
      value: vi.fn(() => ({ matches: false, media: '(pointer: coarse)', addEventListener: vi.fn(), removeEventListener: vi.fn() })),
    })
    renderView()
    const box = await screen.findByPlaceholderText('Type a message...') as HTMLTextAreaElement
    fireEvent.change(box, { target: { value: 'line 1\nline 2\nline 3' } })
    fireEvent.keyDown(box, { key: 'Enter' })
    expect(streamMessageMock).toHaveBeenCalled()
    // After send the input is cleared and the inline height is reset so the box shrinks to one line.
    expect(box.value).toBe('')
    expect(box.style.height).toBe('auto')
  })

  it('has a 16px+ font so iOS does not zoom on focus', async () => {
    renderView()
    const box = await screen.findByPlaceholderText('Type a message...')
    expect(box.className).toMatch(/\btext-base\b/)
  })
})
```

If the existing file's mocks make `streamMessage` unreachable, assert instead on the file's `apiFetch` mock not being called with `/api/chat`. The behavioural claim to pin is: on coarse pointer, Enter sends nothing and the text stays.

- [ ] **Step 3: Run to verify failure**

Run: `npx vitest run components/maker/__tests__/MakerProjectView.test.tsx`
Expected: the new tests FAIL (coarse-pointer Enter currently sends; `text-base` absent; height not reset).

- [ ] **Step 4: Implement**

Imports at the top of `components/maker/MakerProjectView.tsx`:

```ts
import { shouldSendOnEnter, composerHeightPx } from '@/lib/chat/composer'
import { useCoarsePointer } from '@/lib/hooks/useCoarsePointer'
```

Next to the other hooks (after `const textareaRef = useRef<HTMLTextAreaElement>(null)`):

```ts
  const coarsePointer = useCoarsePointer()

  // Auto-grow the composer with its content, up to a cap (#183). Height is
  // derived from `input` so it shrinks back to one line when a send clears
  // the text. 'auto' first so scrollHeight reflects the new content, not the
  // previous height.
  useEffect(() => {
    const el = textareaRef.current
    if (!el) return
    el.style.height = 'auto'
    if (input) el.style.height = `${composerHeightPx(el.scrollHeight)}px`
  }, [input])
```

Replace `handleKeyDown`:

```ts
  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    const send = shouldSendOnEnter({
      key: e.key,
      shiftKey: e.shiftKey,
      isComposing: e.nativeEvent.isComposing,
      coarsePointer,
    })
    if (send) {
      e.preventDefault()
      handleSend()
    }
    // Otherwise let the browser insert the newline.
  }
```

Update the `<textarea>`:

```tsx
          <textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            onPaste={handlePaste}
            placeholder="Type a message..."
            // Two visible lines on touch so the box reads as a place to write,
            // not a search field; one on desktop as before. Auto-grow takes
            // over from there (#183).
            rows={coarsePointer ? 2 : 1}
            disabled={streaming || isLoading || creatingSession || uploading}
            className="flex-1 resize-none text-base leading-6 max-h-[200px] overflow-y-auto px-3 py-2 border border-gray-300 rounded-lg shadow-sm focus:outline-none focus:ring-2 focus:ring-brand-navy focus:border-brand-navy disabled:bg-gray-50 disabled:text-gray-400"
          />
```

Confirm `handleSend` already does `setInput('')` on success (it does today — the effect above then resets height). Do not change `handleSend`.

- [ ] **Step 5: Run tests, then the full gate**

Run: `npx vitest run components/maker/__tests__/MakerProjectView.test.tsx` → PASS.
Run: `npm test && npm run type-check && npm run lint && npm run build` → all green.

- [ ] **Step 6: Commit**

```bash
git add components/maker/MakerProjectView.tsx components/maker/__tests__/MakerProjectView.test.tsx
git commit -m "feat(chat): composer auto-grows; Enter newlines on touch, sends on desktop (#183)"
```

---

### Task 4: Changelog entry

**Files:**
- Modify: `docs/changelog.md` (prepend)

- [ ] **Step 1: Prepend**

```markdown
## 2026-10-07 — Maker composer works on a phone (#183)

The chat box auto-grows with the text (cap 200px, then scrolls) and starts at two lines on touch screens. On a touch screen Enter inserts a newline and the send button is the only submit; desktop keeps Enter-to-send / Shift+Enter newline. IME composition never sends. Font is pinned at 16px so iOS stops zooming on focus. Pure rules in `lib/chat/composer.ts`, touch detection in `lib/hooks/useCoarsePointer.ts`.
```

- [ ] **Step 2: Commit**

```bash
git add docs/changelog.md
git commit -m "docs: changelog — phone-friendly composer (#183)"
```
