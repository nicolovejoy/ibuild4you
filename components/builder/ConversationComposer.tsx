'use client'

// #245: message box under the open conversation in the builder view. With
// "Sam replies" on, the message streams to Sam like a maker turn; off, it is
// posted as a note Sam reads next turn but does not answer now. A note left as
// the session's last message means the maker gets no automatic greeting on open.

import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { apiFetch } from '@/lib/firebase/api-fetch'
import { errorMessageFromResponse } from '@/lib/hooks/chat-error'
import { useStreamingChat } from '@/lib/hooks/useStreamingChat'
import { StatusMessage } from '@/components/ui/StatusMessage'
import { copy } from '@/lib/copy'

export function ConversationComposer({ projectId, sessionId }: { projectId: string; sessionId: string }) {
  const queryClient = useQueryClient()
  const { streamMessage, streaming, error: streamError, setError: setStreamError } = useStreamingChat({ projectId })
  const [text, setText] = useState('')
  const [samReplies, setSamReplies] = useState(true)
  const [sending, setSending] = useState(false)
  const [noteError, setNoteError] = useState<string | null>(null)

  const busy = sending || streaming
  const canSend = text.trim().length > 0 && !busy

  async function send() {
    const content = text.trim()
    if (!content || busy) return
    setNoteError(null)
    setStreamError(null)
    setSending(true)
    try {
      if (samReplies) {
        // false means the hook caught an error and shows it; keep the text.
        const ok = await streamMessage(sessionId, content)
        if (ok) setText('')
      } else {
        const res = await apiFetch('/api/chat', {
          method: 'POST',
          body: JSON.stringify({ session_id: sessionId, content, reply: false }),
        })
        if (!res.ok) {
          setNoteError(await errorMessageFromResponse(res))
          return
        }
        setText('')
        setSamReplies(true)
        queryClient.invalidateQueries({ queryKey: ['messages', sessionId] })
      }
    } catch (err) {
      setNoteError(err instanceof Error ? err.message : 'Something went wrong')
    } finally {
      setSending(false)
    }
  }

  const error = noteError || streamError

  return (
    <div className="border-t border-gray-200 p-3 space-y-2">
      {error && <StatusMessage type="error" message={error} />}
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={copy.builderChat.placeholder}
        rows={3}
        className="w-full rounded border border-gray-300 p-2 text-sm"
      />
      <div className="flex items-center justify-between gap-3">
        <label className="flex items-center gap-1.5 text-sm text-gray-700" title={copy.builderChat.samRepliesHint}>
          <input type="checkbox" checked={samReplies} onChange={(e) => setSamReplies(e.target.checked)} />
          {copy.builderChat.samReplies}
        </label>
        <div className="flex items-center gap-3">
          {streaming && <span className="text-xs text-gray-500">{copy.builderChat.samReplying}</span>}
          <button
            onClick={send}
            disabled={!canSend}
            className="rounded bg-brand-navy px-3 py-1 text-sm text-white disabled:opacity-50"
          >
            {copy.builderChat.send}
          </button>
        </div>
      </div>
    </div>
  )
}
