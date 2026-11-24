// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook } from '@testing-library/react'
import { QueryClient, QueryClientProvider, useMutation } from '@tanstack/react-query'
import React from 'react'
import { useShareProject, useSendMakerEmail, useCreateProject, useCreateSession } from '../hooks'
import { queryClient as appQueryClient } from '../query-client'

// These hooks must send one request per call even under the app default
// (mutations retry: 1). The invite hook because every refusal is final and the
// retry held the message back about a second (2026-11-24); the other three
// because a repeat emails a maker twice, makes a second brief, or opens a second
// conversation.

vi.mock('@/lib/firebase/api-fetch', () => ({
  apiFetch: (url: string, options?: RequestInit) => globalThis.fetch(url, options),
}))

const fetchMock = vi.fn()
beforeEach(() => {
  fetchMock.mockReset()
  globalThis.fetch = fetchMock as unknown as typeof fetch
})

// A fresh Response per call, so a retry is a clean second call.
const answer = (body: unknown, status: number) =>
  fetchMock.mockImplementation(() =>
    Promise.resolve(new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }))
  )

// The app's real mutation defaults, with a 1 ms retry delay so a retry shows up fast.
function appDefaults() {
  const client = new QueryClient({
    defaultOptions: { mutations: { ...appQueryClient.getDefaultOptions().mutations, retryDelay: 1 } },
  })
  // Named so the react/display-name lint rule is satisfied.
  function Wrapper({ children }: { children: React.ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>
  }
  return Wrapper
}

// Give a retry time to arrive if one is coming.
const settle = () => new Promise((r) => setTimeout(r, 50))

const REMOVED = 'This person was removed from the brief. Restore them under People instead of inviting them again.'

describe('mutation retry under the app defaults', () => {
  it('control: a mutation without retry: false is sent twice', async () => {
    answer({ error: 'nope' }, 409)
    const { result } = renderHook(
      () =>
        useMutation({
          mutationFn: async () => {
            const res = await fetch('/x', { method: 'POST' })
            if (!res.ok) throw new Error('refused')
          },
        }),
      { wrapper: appDefaults() }
    )
    await expect(result.current.mutateAsync()).rejects.toThrow('refused')
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('useShareProject: a 409 is sent once and rejects with the server message', async () => {
    answer({ error: REMOVED }, 409)
    const { result } = renderHook(() => useShareProject(), { wrapper: appDefaults() })
    await expect(result.current.mutateAsync({ project_id: 'p1', email: 'a@b.co' })).rejects.toThrow(REMOVED)
    await settle()
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('useShareProject: a 500 is sent once', async () => {
    answer({ error: 'boom' }, 500)
    const { result } = renderHook(() => useShareProject(), { wrapper: appDefaults() })
    await expect(result.current.mutateAsync({ project_id: 'p1', email: 'a@b.co' })).rejects.toThrow('boom')
    await settle()
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('useSendMakerEmail: a 500 is sent once', async () => {
    answer({ error: 'boom' }, 500)
    const { result } = renderHook(() => useSendMakerEmail(), { wrapper: appDefaults() })
    await expect(result.current.mutateAsync({ project_id: 'p1', kind: 'nudge' })).rejects.toThrow('boom')
    await settle()
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('useCreateProject: a 500 is sent once', async () => {
    answer({ error: 'boom' }, 500)
    const { result } = renderHook(() => useCreateProject(), { wrapper: appDefaults() })
    await expect(result.current.mutateAsync({ title: 't' })).rejects.toThrow('boom')
    await settle()
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('useCreateSession: a 500 is sent once', async () => {
    answer({ error: 'boom' }, 500)
    const { result } = renderHook(() => useCreateSession(), { wrapper: appDefaults() })
    await expect(result.current.mutateAsync({ project_id: 'p1' })).rejects.toThrow('boom')
    await settle()
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})
