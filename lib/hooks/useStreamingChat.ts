'use client'

import { useState, useCallback } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { apiFetch } from '@/lib/firebase/api-fetch'

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
        const data = await res.json()
        throw new Error(data.error || 'Chat request failed')
      }

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
  }, [projectId, queryClient])

  return { messages, setMessages, streaming, error, setError, streamMessage }
}
