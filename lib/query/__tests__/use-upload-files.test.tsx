// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import React from 'react'
import { useUploadFiles } from '../hooks'

// =============================================================================
// USE-UPLOAD-FILES — three-step upload flow that bypasses Vercel's 4.5MB cap:
//   1. POST /api/files/init    → { file_id, upload_url } + pending Firestore doc
//   2. PUT  upload_url         → bytes go straight to S3
//   3. POST /api/files/:id/confirm → flips status to 'ready'
//
// History: this flow has been the source of two production issues already
// (the original 4MB cap, and the cache_control 400 from too many PDFs in
// one chat send). Tests here lock the contract so we catch regressions
// before the next maker hits a 500.
// =============================================================================

vi.mock('@/lib/firebase/api-fetch', () => ({
  apiFetch: (url: string, options?: RequestInit) => globalThis.fetch(url, options),
}))

const fetchMock = vi.fn()
beforeEach(() => {
  fetchMock.mockReset()
  globalThis.fetch = fetchMock as unknown as typeof fetch
})

function makeWrapper() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>
  }
}

function jsonResponse(body: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { 'Content-Type': 'application/json' },
  })
}

function makeFile(name = 'a.pdf', size = 1024, type = 'application/pdf') {
  // Build a Blob and assign a name + size; jsdom's File polyfill is fine but
  // we want full control here.
  const blob = new Blob([new Uint8Array(size)], { type })
  return new File([blob], name, { type })
}

describe('useUploadFiles', () => {
  it('completes the three-step flow for a single file', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ file_id: 'f1', upload_url: 'https://s3.example/upload-1' }, { status: 201 }))
      .mockResolvedValueOnce(new Response(null, { status: 200 })) // S3 PUT
      .mockResolvedValueOnce(jsonResponse({ id: 'f1', filename: 'a.pdf', status: 'ready' }, { status: 200 }))

    const { result } = renderHook(() => useUploadFiles(), { wrapper: makeWrapper() })
    const out = await result.current.mutateAsync({ projectId: 'p1', files: [makeFile()] })

    expect(out.uploaded).toHaveLength(1)
    expect(out.failed).toHaveLength(0)
    expect(fetchMock).toHaveBeenCalledTimes(3)
    expect(fetchMock.mock.calls[0][0]).toBe('/api/files/init')
    expect(fetchMock.mock.calls[1][0]).toBe('https://s3.example/upload-1')
    const initBody = JSON.parse(fetchMock.mock.calls[0][1].body as string)
    expect(initBody).toMatchObject({ project_id: 'p1', filename: 'a.pdf', content_type: 'application/pdf' })
    expect(fetchMock.mock.calls[2][0]).toBe('/api/files/f1/confirm')
  })

  it('captures the server error message in failed[].error when init fails', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ error: 'File too big' }, { status: 413 }))

    const { result } = renderHook(() => useUploadFiles(), { wrapper: makeWrapper() })
    const file = makeFile('big.pdf', 999999)
    const out = await result.current.mutateAsync({ projectId: 'p1', files: [file] })

    expect(out.uploaded).toHaveLength(0)
    expect(out.failed).toEqual([{ file, error: 'File too big' }])
    // S3 PUT and confirm never fire when init rejects.
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('falls back to a generic message when init returns non-JSON', async () => {
    fetchMock.mockResolvedValueOnce(new Response('Bad gateway', { status: 502 }))

    const { result } = renderHook(() => useUploadFiles(), { wrapper: makeWrapper() })
    const out = await result.current.mutateAsync({ projectId: 'p1', files: [makeFile()] })

    expect(out.uploaded).toHaveLength(0)
    expect(out.failed[0].error).toMatch(/Upload init failed.*502/)
  })

  it('reports a failed entry when the S3 PUT fails', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ file_id: 'f1', upload_url: 'https://s3.example/u' }, { status: 201 }))
      .mockResolvedValueOnce(new Response(null, { status: 403 }))

    const { result } = renderHook(() => useUploadFiles(), { wrapper: makeWrapper() })
    const out = await result.current.mutateAsync({ projectId: 'p1', files: [makeFile()] })

    expect(out.uploaded).toHaveLength(0)
    expect(out.failed[0].error).toMatch(/Direct S3 upload failed.*403/)
    // Confirm doesn't run when S3 fails.
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('reports a failed entry when confirm fails', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ file_id: 'f1', upload_url: 'https://s3.example/u' }, { status: 201 }))
      .mockResolvedValueOnce(new Response(null, { status: 200 }))
      .mockResolvedValueOnce(jsonResponse({ error: 'doc not found' }, { status: 404 }))

    const { result } = renderHook(() => useUploadFiles(), { wrapper: makeWrapper() })
    const out = await result.current.mutateAsync({ projectId: 'p1', files: [makeFile()] })

    expect(out.uploaded).toHaveLength(0)
    expect(out.failed[0].error).toMatch(/doc not found/)
  })

  it('uploads multiple files in parallel and returns all of them', async () => {
    // 2 files × 3 steps each = 6 fetch calls in interleaved order. We don't
    // care about exact interleaving — only that every call gets a response.
    fetchMock.mockImplementation((url: string) => {
      if (url === '/api/files/init') {
        const id = `f-${fetchMock.mock.calls.filter((c) => c[0] === '/api/files/init').length}`
        return Promise.resolve(jsonResponse({ file_id: id, upload_url: `https://s3.example/${id}` }, { status: 201 }))
      }
      if (url.startsWith('https://s3.example/')) {
        return Promise.resolve(new Response(null, { status: 200 }))
      }
      if (url.includes('/confirm')) {
        const id = url.split('/')[3]
        return Promise.resolve(jsonResponse({ id, filename: `${id}.pdf`, status: 'ready' }))
      }
      return Promise.reject(new Error(`unexpected url: ${url}`))
    })

    const { result } = renderHook(() => useUploadFiles(), { wrapper: makeWrapper() })
    const out = await result.current.mutateAsync({
      projectId: 'p1',
      files: [makeFile('a.pdf'), makeFile('b.pdf')],
    })

    expect(out.uploaded).toHaveLength(2)
    expect(out.failed).toHaveLength(0)
    expect(out.uploaded.map((f) => f.id).sort()).toEqual(['f-1', 'f-2'])
  })

  it('returns partial results when one upload fails (does not throw)', async () => {
    // A3 contract: a single bad file does not abort the whole batch. The
    // mutation resolves with whatever uploads succeeded plus a `failed`
    // entry per failure. The caller decides how to surface that.
    let initCalls = 0
    fetchMock.mockImplementation((url: string) => {
      if (url === '/api/files/init') {
        initCalls++
        if (initCalls === 2) {
          return Promise.resolve(jsonResponse({ error: 'simulated init failure' }, { status: 502 }))
        }
        return Promise.resolve(jsonResponse({ file_id: `f${initCalls}`, upload_url: `https://s3.example/u${initCalls}` }, { status: 201 }))
      }
      if (url.startsWith('https://s3.example/')) {
        return Promise.resolve(new Response(null, { status: 200 }))
      }
      if (url.includes('/confirm')) {
        return Promise.resolve(jsonResponse({ id: 'f1', filename: 'a.pdf', status: 'ready' }))
      }
      return Promise.reject(new Error(`unexpected url: ${url}`))
    })

    const fileA = makeFile('a.pdf')
    const fileB = makeFile('b.pdf')
    const { result } = renderHook(() => useUploadFiles(), { wrapper: makeWrapper() })
    const out = await result.current.mutateAsync({
      projectId: 'p1',
      files: [fileA, fileB],
    })

    expect(out.uploaded).toHaveLength(1)
    expect(out.uploaded[0].id).toBe('f1')
    expect(out.failed).toHaveLength(1)
    expect(out.failed[0]).toMatchObject({ file: fileB, error: expect.stringMatching(/simulated init failure/) })

    await waitFor(() => {
      const confirmCalls = fetchMock.mock.calls.filter((c) => String(c[0]).includes('/confirm'))
      expect(confirmCalls.length).toBe(1)
    })
  })

  it('passes session_id when provided', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ file_id: 'f1', upload_url: 'https://s3.example/u' }, { status: 201 }))
      .mockResolvedValueOnce(new Response(null, { status: 200 }))
      .mockResolvedValueOnce(jsonResponse({ id: 'f1', filename: 'a.pdf', status: 'ready' }))

    const { result } = renderHook(() => useUploadFiles(), { wrapper: makeWrapper() })
    await result.current.mutateAsync({ projectId: 'p1', sessionId: 's1', files: [makeFile()] })

    const initBody = JSON.parse(fetchMock.mock.calls[0][1].body as string)
    expect(initBody.session_id).toBe('s1')
  })

  it('defaults content_type to application/octet-stream when the file has no type', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ file_id: 'f1', upload_url: 'https://s3.example/u' }, { status: 201 }))
      .mockResolvedValueOnce(new Response(null, { status: 200 }))
      .mockResolvedValueOnce(jsonResponse({ id: 'f1', filename: 'a', status: 'ready' }))

    // Build a File without setting type → File.type === ''
    const file = new File([new Blob([new Uint8Array(10)])], 'a')

    const { result } = renderHook(() => useUploadFiles(), { wrapper: makeWrapper() })
    await result.current.mutateAsync({ projectId: 'p1', files: [file] })

    const initBody = JSON.parse(fetchMock.mock.calls[0][1].body as string)
    expect(initBody.content_type).toBe('application/octet-stream')
  })
})
