// @vitest-environment jsdom
// The realtime listener writes server snapshots into the messages query, and
// never a snapshot answered from the browser's local cache: that one can hold
// documents as they were before a change made by an API route (an import that
// deletes the canned greeting and posts a welcome).
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import React from 'react'

type Snap = { metadata: { fromCache: boolean }; docs: { id: string; data: () => Record<string, unknown> }[] }
let emit: (snap: Snap) => void = () => {}
const unsubscribe = vi.fn()
const onSnapshot = vi.fn((_q: unknown, ...rest: unknown[]) => {
  emit = rest[rest.length - 1] as (snap: Snap) => void
  return unsubscribe
})
vi.mock('firebase/firestore', () => ({
  collection: vi.fn(),
  query: vi.fn(),
  where: vi.fn(),
  orderBy: vi.fn(),
  onSnapshot: (...a: [unknown]) => onSnapshot(...a),
}))
vi.mock('@/lib/firebase/client', () => ({ db: {} }))

import { useRealtimeMessages } from '../useRealtimeMessages'

const snap = (fromCache: boolean, ...ids: string[]): Snap => ({
  metadata: { fromCache },
  docs: ids.map((id) => ({ id, data: () => ({ role: 'agent', content: id }) })),
})

function setup() {
  const client = new QueryClient()
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  )
  renderHook(() => useRealtimeMessages('s1'), { wrapper })
  return client
}

describe('useRealtimeMessages', () => {
  beforeEach(() => {
    onSnapshot.mockClear()
    unsubscribe.mockClear()
  })

  it('writes a server snapshot into the messages query', () => {
    const client = setup()
    act(() => emit(snap(false, 'a', 'b')))
    expect((client.getQueryData(['messages', 's1']) as { id: string }[]).map((m) => m.id)).toEqual(['a', 'b'])
  })

  it('ignores a snapshot answered from the local cache', () => {
    const client = setup()
    client.setQueryData(['messages', 's1'], [{ id: 'fresh' }])
    act(() => emit(snap(true, 'old1', 'old2')))
    expect(client.getQueryData(['messages', 's1'])).toEqual([{ id: 'fresh' }])
  })

  it('still delivers the server snapshot that follows a cached one, and later ones', () => {
    const client = setup()
    act(() => emit(snap(true, 'old')))
    expect(client.getQueryData(['messages', 's1'])).toBeUndefined()
    act(() => emit(snap(false, 'new')))
    expect((client.getQueryData(['messages', 's1']) as { id: string }[]).map((m) => m.id)).toEqual(['new'])
    act(() => emit(snap(false, 'new', 'reply')))
    expect((client.getQueryData(['messages', 's1']) as { id: string }[]).map((m) => m.id)).toEqual(['new', 'reply'])
  })

  it('asks for metadata changes, so the cache-to-server switch raises a snapshot even when no document differs', () => {
    setup()
    const opts = onSnapshot.mock.calls[0][1] as { includeMetadataChanges?: boolean }
    expect(opts.includeMetadataChanges).toBe(true)
  })
})
