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

  // Append streamed text deltas onto the trailing (empty) agent placeholder.
  // Shared by streamMessage and kickoff.
  const consumeStream = useCallback(async (res: Response) => {
    const reader = res.body?.getReader()
    if (!reader) throw new Error('No response stream')

    const decoder = new TextDecoder()
    let buffer = ''

    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() || ''

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue
        const data = line.slice(6)
        if (data === '[DONE]') break

        try {
          const parsed = JSON.parse(data)
          if (parsed.text) {
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
  }, [])

  const streamMessage = useCallback(async (
    sessionId: string,
    content: string,
    options?: { fileIds?: string[] },
  ) => {
    const nowIso = new Date().toISOString()
    setMessages((prev) => [...prev, { role: 'agent', content: '', created_at: nowIso }])
    setStreaming(true)

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
    setStreaming(true)
    let placeholderAdded = false
    try {
      const res = await apiFetch('/api/chat/kickoff', {
        method: 'POST',
        body: JSON.stringify({ session_id: sessionId }),
      })

      // No-op (declined) responses come back as JSON, not an event stream.
      if (!res.ok || !res.headers.get('Content-Type')?.includes('text/event-stream')) return

      setMessages((prev) => [...prev, { role: 'agent', content: '', created_at: new Date().toISOString() }])
      placeholderAdded = true
      await consumeStream(res)

      queryClient.invalidateQueries({ queryKey: ['messages', sessionId] })
      queryClient.invalidateQueries({ queryKey: ['sessions', projectId] })
    } catch {
      if (placeholderAdded) {
        setMessages((prev) => {
          const updated = [...prev]
          if (updated[updated.length - 1]?.role === 'agent' && !updated[updated.length - 1]?.content) {
            updated.pop()
          }
          return updated
        })
      }
    } finally {
      setStreaming(false)
    }
  }, [projectId, queryClient, consumeStream])

  return { messages, setMessages, streaming, error, setError, streamMessage, kickoff }
}
