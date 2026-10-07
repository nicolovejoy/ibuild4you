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
