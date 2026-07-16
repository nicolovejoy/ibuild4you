// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import React from 'react'
import { useStreamingChat } from '../useStreamingChat'

// =============================================================================
// useStreamingChat — SSE streaming, error surfacing, and loading-state tests.
//
// apiFetch is mocked at the module boundary (house pattern, see
// MakerProjectView.test.tsx) so real fetch Response/ReadableStream objects
// drive the hook's own SSE parsing — the parsing itself is under test, not a
// pre-parsed stand-in for it.
// =============================================================================

const mockApiFetch = vi.fn()
vi.mock('@/lib/firebase/api-fetch', () => ({
  apiFetch: (...args: unknown[]) => mockApiFetch(...args),
}))

// Feeds each string in `chunks` as its own stream read — i.e. as its own
// `reader.read()` resolution — so tests can control exactly how an SSE
// payload is fragmented across the wire.
function sseStream(chunks: string[]) {
  const encoder = new TextEncoder()
  let i = 0
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (i < chunks.length) {
        controller.enqueue(encoder.encode(chunks[i]))
        i++
      } else {
        controller.close()
      }
    },
  })
}

function sseResponse(chunks: string[], status = 200) {
  return new Response(sseStream(chunks), {
    status,
    headers: { 'Content-Type': 'text/event-stream' },
  })
}

let client: QueryClient
function wrapper({ children }: { children: React.ReactNode }) {
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>
}

beforeEach(() => {
  vi.clearAllMocks()
  client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('useStreamingChat — streamMessage', () => {
  it('accumulates streamed chunks onto the trailing agent message, in order', async () => {
    mockApiFetch.mockResolvedValue(
      sseResponse([
        'data: {"text":"Hel"}\n\n',
        'data: {"text":"lo "}\n\ndata: {"text":"world"}\n\n',
        'data: [DONE]\n\n',
      ]),
    )
    const { result } = renderHook(() => useStreamingChat({ projectId: 'p1' }), { wrapper })

    await act(async () => {
      await result.current.streamMessage('s1', 'hi')
    })

    expect(result.current.messages).toHaveLength(1)
    expect(result.current.messages[0]).toMatchObject({ role: 'agent', content: 'Hello world' })
    expect(result.current.streaming).toBe(false)
    expect(result.current.error).toBeNull()
  })

  it('parses an SSE event whose JSON payload is split mid-token across two wire chunks', async () => {
    // Exercises the buffer/`lines.pop()` carry-forward: the JSON is torn in
    // half ('{"tex' | 't":"..."}') across separate reader.read() resolutions.
    mockApiFetch.mockResolvedValue(
      sseResponse(['data: {"tex', 't":"partial-boundary"}\n\ndata: [DONE]\n\n']),
    )
    const { result } = renderHook(() => useStreamingChat({ projectId: 'p1' }), { wrapper })

    await act(async () => {
      await result.current.streamMessage('s1', 'hi')
    })

    expect(result.current.messages[0].content).toBe('partial-boundary')
  })

  it('decodes a multi-byte UTF-8 character split across a chunk boundary', async () => {
    // '👋' is 4 UTF-8 bytes. Split the encoded frame in the middle of that
    // sequence to prove the shared TextDecoder (`{ stream: true }`) is really
    // carrying partial multi-byte state across reads, not just being lucky
    // with ASCII-only fixtures.
    const encoder = new TextEncoder()
    const prefix = encoder.encode('data: {"text":"Hi ')
    const emoji = encoder.encode('👋')
    const suffix = encoder.encode('"}\n\ndata: [DONE]\n\n')
    const full = new Uint8Array([...prefix, ...emoji, ...suffix])
    const splitPoint = prefix.length + 2 // inside the 4-byte emoji sequence
    const first = full.slice(0, splitPoint)
    const second = full.slice(splitPoint)

    let i = 0
    const raw = [first, second]
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (i < raw.length) {
          controller.enqueue(raw[i])
          i++
        } else {
          controller.close()
        }
      },
    })
    mockApiFetch.mockResolvedValue(new Response(stream, { status: 200, headers: { 'Content-Type': 'text/event-stream' } }))

    const { result } = renderHook(() => useStreamingChat({ projectId: 'p1' }), { wrapper })
    await act(async () => {
      await result.current.streamMessage('s1', 'hi')
    })

    expect(result.current.messages[0].content).toBe('Hi 👋')
  })

  it('sets streaming true immediately on call, false once the stream completes', async () => {
    mockApiFetch.mockResolvedValue(sseResponse(['data: {"text":"hi"}\n\n', 'data: [DONE]\n\n']))
    const { result } = renderHook(() => useStreamingChat({ projectId: 'p1' }), { wrapper })

    let pending!: Promise<void>
    act(() => {
      pending = result.current.streamMessage('s1', 'hello')
    })
    expect(result.current.streaming).toBe(true)

    await act(async () => {
      await pending
    })
    expect(result.current.streaming).toBe(false)
  })

  it('surfaces the JSON error envelope message and drops the empty placeholder', async () => {
    mockApiFetch.mockResolvedValue(new Response(JSON.stringify({ error: 'Session not found' }), { status: 404 }))
    const { result } = renderHook(() => useStreamingChat({ projectId: 'p1' }), { wrapper })

    await act(async () => {
      await result.current.streamMessage('s1', 'hi')
    })

    expect(result.current.error).toBe('Session not found')
    expect(result.current.streaming).toBe(false)
    expect(result.current.messages).toHaveLength(0)
  })

  it('degrades to a status-based message on a non-JSON (HTML) error body — the #11 regression case', async () => {
    // This is exactly the case #11 (PR #59) hardened errorMessageFromResponse
    // for: a framework-level 500 / gateway error hands back HTML, not JSON.
    mockApiFetch.mockResolvedValue(
      new Response('<html><body>Internal Server Error</body></html>', {
        status: 500,
        headers: { 'Content-Type': 'text/html' },
      }),
    )
    const { result } = renderHook(() => useStreamingChat({ projectId: 'p1' }), { wrapper })

    await act(async () => {
      await result.current.streamMessage('s1', 'hi')
    })

    expect(result.current.error).toBe('Chat request failed (500)')
    expect(result.current.streaming).toBe(false)
    expect(result.current.messages).toHaveLength(0)
  })

  it('surfaces an error (not a hang) when the stream dies mid-transfer, and keeps the partial text', async () => {
    let call = 0
    const encoder = new TextEncoder()
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        call++
        if (call === 1) {
          controller.enqueue(encoder.encode('data: {"text":"partial"}\n\n'))
          return
        }
        // Simulate the connection dying mid-stream.
        throw new Error('network dropped')
      },
    })
    mockApiFetch.mockResolvedValue(new Response(stream, { status: 200, headers: { 'Content-Type': 'text/event-stream' } }))

    const { result } = renderHook(() => useStreamingChat({ projectId: 'p1' }), { wrapper })
    await act(async () => {
      await result.current.streamMessage('s1', 'hi')
    })

    // Does not hang: streaming flips back to false via the `finally`.
    expect(result.current.streaming).toBe(false)
    // Surfaces an error rather than swallowing the failure silently.
    expect(result.current.error).toBe('network dropped')
    // The text that arrived before the drop is NOT retracted — only a fully
    // empty placeholder gets popped on error. Whether a maker-facing
    // half-sentence + error banner is the desired UX is a product call, but
    // this pins down that it's the current, deliberate-looking behavior
    // (see the `!updated[...].content` guard in useStreamingChat.ts).
    expect(result.current.messages).toHaveLength(1)
    expect(result.current.messages[0].content).toBe('partial')
  })

  it('invalidates messages + sessions queries after a successful stream, not after a failed one', async () => {
    const invalidateSpy = vi.spyOn(client, 'invalidateQueries')
    mockApiFetch.mockResolvedValue(sseResponse(['data: {"text":"hi"}\n\n', 'data: [DONE]\n\n']))
    const { result } = renderHook(() => useStreamingChat({ projectId: 'p1' }), { wrapper })

    await act(async () => {
      await result.current.streamMessage('s1', 'hello')
    })
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['messages', 's1'] })
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['sessions', 'p1'] })

    invalidateSpy.mockClear()
    mockApiFetch.mockResolvedValue(new Response(JSON.stringify({ error: 'boom' }), { status: 500 }))
    await act(async () => {
      await result.current.streamMessage('s1', 'hello again')
    })
    expect(invalidateSpy).not.toHaveBeenCalled()
  })

  it('includes file_ids in the request body only when files are attached', async () => {
    mockApiFetch.mockResolvedValue(sseResponse(['data: [DONE]\n\n']))
    const { result } = renderHook(() => useStreamingChat({ projectId: 'p1' }), { wrapper })

    await act(async () => {
      await result.current.streamMessage('s1', 'hi', { fileIds: ['f1', 'f2'] })
    })
    const bodyWithFiles = JSON.parse(mockApiFetch.mock.calls[0][1].body as string)
    expect(bodyWithFiles.file_ids).toEqual(['f1', 'f2'])

    mockApiFetch.mockClear()
    mockApiFetch.mockResolvedValue(sseResponse(['data: [DONE]\n\n']))
    await act(async () => {
      await result.current.streamMessage('s1', 'hi again')
    })
    const bodyWithoutFiles = JSON.parse(mockApiFetch.mock.calls[0][1].body as string)
    expect(bodyWithoutFiles.file_ids).toBeUndefined()
  })
})

describe('useStreamingChat — kickoff', () => {
  it('is a silent no-op when the route declines with a plain JSON response', async () => {
    mockApiFetch.mockResolvedValue(
      new Response(JSON.stringify({ skipped: true }), { status: 200, headers: { 'Content-Type': 'application/json' } }),
    )
    const { result } = renderHook(() => useStreamingChat({ projectId: 'p1' }), { wrapper })

    await act(async () => {
      await result.current.kickoff('s1')
    })

    expect(result.current.messages).toHaveLength(0)
    expect(result.current.streaming).toBe(false)
    expect(result.current.error).toBeNull()
  })

  it('streams a greeting the same way streamMessage does when the route accepts', async () => {
    mockApiFetch.mockResolvedValue(
      sseResponse(['data: {"text":"Hey Sam, welcome back"}\n\n', 'data: [DONE]\n\n']),
    )
    const { result } = renderHook(() => useStreamingChat({ projectId: 'p1' }), { wrapper })

    await act(async () => {
      await result.current.kickoff('s1')
    })

    expect(result.current.messages).toHaveLength(1)
    expect(result.current.messages[0]).toMatchObject({ role: 'agent', content: 'Hey Sam, welcome back' })
    expect(result.current.streaming).toBe(false)
  })

  it('swallows a total failure — never sets `error`, never blocks the maker from chatting', async () => {
    mockApiFetch.mockRejectedValue(new Error('kickoff network failure'))
    const { result } = renderHook(() => useStreamingChat({ projectId: 'p1' }), { wrapper })

    await act(async () => {
      await result.current.kickoff('s1')
    })

    expect(result.current.error).toBeNull()
    expect(result.current.streaming).toBe(false)
    expect(result.current.messages).toHaveLength(0)
  })

  // #156: a mid-stream drop during kickoff used to leave a truncated agent
  // bubble in place with no error surfaced at all — a half sentence reading
  // as broken rather than as a network blip. Decision: drop the partial
  // entirely rather than show a fragment. `error` still stays null (kickoff
  // failures must never block the maker from chatting), so the only visible
  // effect of a mid-stream drop is that no greeting appears.
  it('drops the partial greeting entirely on a mid-stream drop, with no error indicator', async () => {
    let call = 0
    const encoder = new TextEncoder()
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        call++
        if (call === 1) {
          controller.enqueue(encoder.encode('data: {"text":"Hey the"}\n\n'))
          return
        }
        throw new Error('dropped')
      },
    })
    mockApiFetch.mockResolvedValue(new Response(stream, { status: 200, headers: { 'Content-Type': 'text/event-stream' } }))

    const { result } = renderHook(() => useStreamingChat({ projectId: 'p1' }), { wrapper })
    await act(async () => {
      await result.current.kickoff('s1')
    })

    expect(result.current.streaming).toBe(false)
    expect(result.current.error).toBeNull()
    // The partial "Hey the" bubble is removed, not left truncated.
    expect(result.current.messages).toHaveLength(0)
  })

  it('still adds no message when the drop happens before any text streamed in', async () => {
    const stream = new ReadableStream<Uint8Array>({
      pull() {
        throw new Error('dropped before anything arrived')
      },
    })
    mockApiFetch.mockResolvedValue(new Response(stream, { status: 200, headers: { 'Content-Type': 'text/event-stream' } }))

    const { result } = renderHook(() => useStreamingChat({ projectId: 'p1' }), { wrapper })
    await act(async () => {
      await result.current.kickoff('s1')
    })

    expect(result.current.streaming).toBe(false)
    expect(result.current.error).toBeNull()
    expect(result.current.messages).toHaveLength(0)
  })
})
