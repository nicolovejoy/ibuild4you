// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, waitFor, act } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import React from 'react'
import { useUpdateBrief, StalePrepError, PatchDropUnmatchedError } from '../hooks'
import { queryClient as appQueryClient } from '../query-client'

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

  // A refusal is final and a brief save is not safe to repeat, so the app's
  // global mutation retry (retry: 1) must not apply to this hook.
  it('is not retried under the app default retry', async () => {
    const unmatched = { decisions: [], features: [], open_risks: ['x'], queued: [] }
    fetchMock.mockResolvedValue(json({ error: 'patch_drop_unmatched', unmatched }, 400))
    // The app's real mutation defaults, with a 1 ms retry delay so a retry would show up fast.
    const client = new QueryClient({
      defaultOptions: { mutations: { ...appQueryClient.getDefaultOptions().mutations, retryDelay: 1 } },
    })
    expect(client.getDefaultOptions().mutations?.retry).toBe(1)
    const retryWrapper = ({ children }: { children: React.ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    )
    const { result } = renderHook(() => useUpdateBrief(), { wrapper: retryWrapper })
    await expect(result.current.mutateAsync({ project_id: 'p1', patch: { problem: 'x' } })).rejects.toBeInstanceOf(
      PatchDropUnmatchedError
    )
    // Give a retry time to arrive if one is coming.
    await new Promise((r) => setTimeout(r, 50))
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})
