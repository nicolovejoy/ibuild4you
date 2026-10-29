// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, waitFor, act } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import React from 'react'
import { useUpdateBrief, StalePrepError } from '../hooks'

// #229: the paste guard's client side. The hook forwards the prep stamp and
// force flag, and turns a stale-prep 409 into a typed error carrying its body.

vi.mock('@/lib/firebase/api-fetch', () => ({
  apiFetch: (url: string, options?: RequestInit) => globalThis.fetch(url, options),
}))

const fetchMock = vi.fn()
beforeEach(() => {
  fetchMock.mockReset()
  globalThis.fetch = fetchMock as unknown as typeof fetch
})

function wrapper({ children }: { children: React.ReactNode }) {
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } })
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

describe('useUpdateBrief (#229)', () => {
  it('sends prep_stamp and force when given', async () => {
    fetchMock.mockResolvedValue(json({ id: 'b1', version: 4, folded: ['aaa'] }))
    const { result } = renderHook(() => useUpdateBrief(), { wrapper })
    const stamp = { brief_version: 3, note_ids: ['aaa'] }
    await act(() => result.current.mutateAsync({ project_id: 'p1', content: { problem: 'x' }, prep_stamp: stamp, force: true }))
    const body = JSON.parse(fetchMock.mock.calls[0][1].body)
    expect(body).toEqual({ project_id: 'p1', content: { problem: 'x' }, prep_stamp: stamp, force: true })
  })

  it('omits prep_stamp and force when absent', async () => {
    fetchMock.mockResolvedValue(json({ id: 'b1', version: 4 }))
    const { result } = renderHook(() => useUpdateBrief(), { wrapper })
    await act(() => result.current.mutateAsync({ project_id: 'p1', content: { problem: 'x' }, prep_stamp: null }))
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ project_id: 'p1', content: { problem: 'x' } })
  })

  it('throws StalePrepError with the 409 body', async () => {
    const info = { error: 'stale_prep', unlisted_notes: [{ id: 'bbb', created_at: '2026-10-28T18:00:00.000Z' }], live_version: 4, prep_version: 3 }
    fetchMock.mockResolvedValue(json(info, 409))
    const { result } = renderHook(() => useUpdateBrief(), { wrapper })
    let caught: unknown
    await act(async () => {
      try {
        await result.current.mutateAsync({ project_id: 'p1', content: {}, prep_stamp: { brief_version: 3, note_ids: [] } })
      } catch (err) {
        caught = err
      }
    })
    expect(caught).toBeInstanceOf(StalePrepError)
    expect((caught as StalePrepError).info).toEqual(info)
    await waitFor(() => expect(result.current.isError).toBe(true))
  })

  it('a plain error stays a plain Error', async () => {
    fetchMock.mockResolvedValue(json({ error: 'Brief content is empty' }, 400))
    const { result } = renderHook(() => useUpdateBrief(), { wrapper })
    await expect(result.current.mutateAsync({ project_id: 'p1', content: {} })).rejects.not.toBeInstanceOf(StalePrepError)
  })
})
