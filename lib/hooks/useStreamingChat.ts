'use client'

import { useState, useCallback } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { apiFetch } from '@/lib/firebase/api-fetch'
import { errorMessageFromResponse } from './chat-error'

export type ChatMessage = {
  id?: string
  role: 'user' | 'agent'
  content: string
  created_at?: string
  sender_email?: string
  sender_display_name?: string
  file_ids?: string[]
  rating?: 'up' | 'down' | null // maker's 👍/👎 on an agent message (#130)
}

/**
 * Shared hook for SSE streaming chat with the agent.
 * Manages messages, streaming state, and error state.
 * Components handle their own pre-send logic (session creation, file uploads)
 * and call streamMessage() when ready.
 */
export function useStreamingChat({ projectId }: { projectId: string }) {
  const queryClient = useQueryClient()
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [streaming, setStreaming] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // A kickoff greeting that failed (network error, 5xx, or a stream that
  // broke mid-way). Not the same as a deliberate decline (200 JSON). The
  // maker view uses it to swap the generic empty-state line for a hint that
  // the greeting failed — a blank chat otherwise reads as a broken product.
  const [kickoffFailed, setKickoffFailed] = useState(false)

  // Append streamed text deltas onto the trailing (empty) agent placeholder.
  // Shared by streamMessage and kickoff.
  const consumeStream = useCallback(async (res: Response) => {
    const reader = res.body?.getReader()
    if (!reader) throw new Error('No response stream')

    const decoder = new TextDecoder()
    let buffer = ''
    let receivedText = false

    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() || ''

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue
        const data = line.slice(6)
        // Only breaks this inner line loop, not the outer read loop below —
        // it works because the server enqueues [DONE] and calls
        // controller.close() back-to-back (app/api/chat/route.ts), so the
        // next reader.read() comes back `done`. Fragile if that ordering
        // ever changes.
        if (data === '[DONE]') break

        try {
          const parsed = JSON.parse(data)
          if (parsed.text) {
            receivedText = true
            setMessages((prev) => {
              const updated = [...prev]
              const last = updated[updated.length - 1]
              if (last.role === 'agent') {
                updated[updated.length - 1] = { ...last, content: last.content + parsed.text }
              }
              return updated
            })
          }
        } catch {
          // skip malformed chunks
        }
      }
    }
    return receivedText
  }, [])

  const streamMessage = useCallback(async (
    sessionId: string,
    content: string,
    options?: { fileIds?: string[] },
  ) => {
    const nowIso = new Date().toISOString()
    setMessages((prev) => [...prev, { role: 'agent', content: '', created_at: nowIso }])
    setStreaming(true)
    setKickoffFailed(false)

    try {
      const res = await apiFetch('/api/chat', {
        method: 'POST',
        body: JSON.stringify({
          session_id: sessionId,
          content,
          ...(options?.fileIds?.length && { file_ids: options.fileIds }),
        }),
      })

      if (!res.ok) {
        throw new Error(await errorMessageFromResponse(res))
      }

      await consumeStream(res)

      queryClient.invalidateQueries({ queryKey: ['messages', sessionId] })
      queryClient.invalidateQueries({ queryKey: ['sessions', projectId] })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong')
      // Remove empty agent placeholder on error
      setMessages((prev) => {
        const updated = [...prev]
        if (updated[updated.length - 1]?.role === 'agent' && !updated[updated.length - 1]?.content) {
          updated.pop()
        }
        return updated
      })
    } finally {
      setStreaming(false)
    }
  }, [projectId, queryClient, consumeStream])

  // Agent kickoff (#31): the agent greets the maker on session open without a
  // maker turn. The route either streams a greeting (SSE) or, when a kickoff is
  // correctly declined, returns a JSON no-op — in which case we add no bubble
  // and stay silent. Errors are swallowed: a failed greeting must never block
  // the maker from chatting normally.
  const kickoff = useCallback(async (sessionId: string) => {
    setKickoffFailed(false) // a retry starts clean
    setStreaming(true)
    let placeholderAdded = false
    // Drop the trailing agent placeholder (whole greeting, even if partial).
    const popPlaceholder = () =>
      setMessages((prev) => {
        const updated = [...prev]
        if (updated[updated.length - 1]?.role === 'agent') {
          updated.pop()
        }
        return updated
      })
    try {
      const res = await apiFetch('/api/chat/kickoff', {
        method: 'POST',
        body: JSON.stringify({ session_id: sessionId }),
      })

      if (!res.ok) {
        setKickoffFailed(true)
        return
      }
      const isStream = res.headers.get('Content-Type')?.includes('text/event-stream')
      // A 200 that isn't a stream is the route declining on purpose — silent.
      if (!isStream) return

      setMessages((prev) => [...prev, { role: 'agent', content: '', created_at: new Date().toISOString() }])
      placeholderAdded = true
      const receivedText = await consumeStream(res)
      if (!receivedText) {
        // Clean stream, no text: the server stored nothing (kickoff_empty_response).
        setKickoffFailed(true)
        popPlaceholder()
        return
      }

      queryClient.invalidateQueries({ queryKey: ['messages', sessionId] })
      queryClient.invalidateQueries({ queryKey: ['sessions', projectId] })
    } catch {
      setKickoffFailed(true)
      // Drop the greeting entirely on failure, even if it partially streamed
      // in (#156) — a cut-off fragment reads as broken, while showing
      // nothing reads as a network blip (closer to the truth). `error` stays
      // untouched: the composer must never be blocked by a failed greeting.
      if (placeholderAdded) popPlaceholder()
    } finally {
      setStreaming(false)
    }
  }, [projectId, queryClient, consumeStream])

  return { messages, setMessages, streaming, error, setError, streamMessage, kickoff, kickoffFailed }
}
