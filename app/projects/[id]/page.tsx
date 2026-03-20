'use client'

import { useAuth } from '@/lib/hooks/useAuth'
import { useApproval } from '@/lib/hooks/useApproval'
import { useSessions, useMessages, useClaimProject } from '@/lib/query/hooks'
import { useRouter, useParams } from 'next/navigation'
import { useEffect, useState, useRef, useCallback } from 'react'
import { MessageSquare, Send, ArrowLeft, FileText } from 'lucide-react'
import { BuildTimestamp } from '@/components/build-timestamp'
import { apiFetch } from '@/lib/firebase/api-fetch'
import { useQueryClient } from '@tanstack/react-query'
import { StatusMessage } from '@/components/ui/StatusMessage'
import { Skeleton } from '@/components/ui/Skeleton'
import type { Message } from '@/lib/types'

const BRIEF_UPDATE_INTERVAL = 15_000 // 15 seconds

export default function ProjectPage() {
  const { user, loading: authLoading, isAuthenticated } = useAuth()
  const { approved, loading: approvalLoading } = useApproval()
  const router = useRouter()
  const params = useParams()
  const projectId = params.id as string

  useEffect(() => {
    if (!authLoading && !isAuthenticated) router.push('/auth/login')
  }, [authLoading, isAuthenticated, router])

  useEffect(() => {
    if (!approvalLoading && approved === false && isAuthenticated) router.push('/not-approved')
  }, [approvalLoading, approved, isAuthenticated, router])

  if (authLoading || approvalLoading || !user || !approved) {
    return (
      <div className="min-h-screen bg-brand-cream flex items-center justify-center">
        <div className="animate-pulse text-brand-slate">Loading...</div>
      </div>
    )
  }

  return <ConversationView projectId={projectId} />
}

function ConversationView({ projectId }: { projectId: string }) {
  const router = useRouter()
  const queryClient = useQueryClient()
  const claimProject = useClaimProject()

  // Auto-claim the project if the user was invited (claim is idempotent — fails silently if already owned)
  useEffect(() => {
    claimProject.mutate(projectId)
    // Only run once on mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId])
  const { data: sessions, isLoading: sessionsLoading } = useSessions(projectId)
  const activeSession = sessions?.find((s) => s.status === 'active') || sessions?.[0]
  const sessionId = activeSession?.id

  const {
    data: savedMessages,
    isLoading: messagesLoading,
  } = useMessages(sessionId)

  const [messages, setMessages] = useState<Pick<Message, 'role' | 'content'>[]>([])
  const [input, setInput] = useState('')
  const [streaming, setStreaming] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const lastBriefUpdate = useRef<number>(0)
  const briefTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Sync saved messages into local state
  useEffect(() => {
    if (savedMessages) {
      setMessages(savedMessages.map((m) => ({ role: m.role, content: m.content })))
    }
  }, [savedMessages])

  // Auto-scroll to bottom when messages change
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  // Trigger brief update with debounce
  const triggerBriefUpdate = useCallback(() => {
    if (!sessionId) return

    const now = Date.now()
    const elapsed = now - lastBriefUpdate.current

    // Clear any pending timer
    if (briefTimerRef.current) {
      clearTimeout(briefTimerRef.current)
      briefTimerRef.current = null
    }

    if (elapsed >= BRIEF_UPDATE_INTERVAL) {
      // Fire immediately
      lastBriefUpdate.current = now
      apiFetch('/api/briefs/generate', {
        method: 'POST',
        body: JSON.stringify({ project_id: projectId }),
      }).catch((err) => console.error('Brief update failed:', err))
    } else {
      // Schedule for when interval has elapsed
      const remaining = BRIEF_UPDATE_INTERVAL - elapsed
      briefTimerRef.current = setTimeout(() => {
        lastBriefUpdate.current = Date.now()
        apiFetch('/api/briefs/generate', {
          method: 'POST',
          body: JSON.stringify({ project_id: projectId }),
        }).catch((err) => console.error('Brief update failed:', err))
      }, remaining)
    }
  }, [projectId, sessionId])

  // Clean up brief timer on unmount
  useEffect(() => {
    return () => {
      if (briefTimerRef.current) clearTimeout(briefTimerRef.current)
    }
  }, [])

  const handleSend = async () => {
    if (!input.trim() || streaming || !sessionId) return

    const userMessage = input.trim()
    setInput('')
    setError(null)

    // Optimistically add user message
    setMessages((prev) => [...prev, { role: 'user', content: userMessage }])
    // Add empty agent message for streaming
    setMessages((prev) => [...prev, { role: 'agent', content: '' }])
    setStreaming(true)

    try {
      const res = await apiFetch('/api/chat', {
        method: 'POST',
        body: JSON.stringify({ session_id: sessionId, content: userMessage }),
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
                  updated[updated.length - 1] = {
                    ...last,
                    content: last.content + parsed.text,
                  }
                }
                return updated
              })
            }
          } catch {
            // skip malformed chunks
          }
        }
      }

      // Invalidate messages cache so next load is fresh
      queryClient.invalidateQueries({ queryKey: ['messages', sessionId] })

      // Trigger brief update after agent response
      triggerBriefUpdate()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong')
      // Remove the empty agent message on error
      setMessages((prev) => {
        const updated = [...prev]
        if (updated[updated.length - 1]?.role === 'agent' && !updated[updated.length - 1]?.content) {
          updated.pop()
        }
        return updated
      })
    } finally {
      setStreaming(false)
      textareaRef.current?.focus()
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  const isLoading = sessionsLoading || messagesLoading

  return (
    <div className="h-screen flex flex-col bg-brand-cream">
      {/* Header */}
      <header className="bg-white border-b border-gray-200 flex-shrink-0">
        <div className="px-4 sm:px-6 h-14 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button
              onClick={() => router.push('/dashboard')}
              className="p-1 hover:bg-gray-100 rounded"
            >
              <ArrowLeft className="h-5 w-5 text-gray-600" />
            </button>
            <div className="group relative">
              <span className="font-semibold text-brand-charcoal">Chat</span>
              <BuildTimestamp />
            </div>
          </div>
          <button
            onClick={() => router.push(`/projects/${projectId}/brief`)}
            className="flex items-center gap-1.5 text-sm text-brand-slate hover:text-brand-navy"
          >
            <FileText className="h-4 w-4" />
            View brief
          </button>
        </div>
      </header>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-6">
        <div className="max-w-2xl mx-auto space-y-4">
          {isLoading ? (
            <>
              <Skeleton className="h-16 w-3/4 rounded-lg" />
              <Skeleton className="h-16 w-2/3 rounded-lg ml-auto" />
            </>
          ) : messages.length === 0 ? (
            <div className="text-center text-brand-slate py-12">
              <MessageSquare className="h-10 w-10 mx-auto mb-3 text-gray-300" />
              <p>Send a message to start the conversation.</p>
            </div>
          ) : (
            messages.map((msg, i) => (
              <div
                key={i}
                className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
              >
                <div
                  className={`max-w-[80%] rounded-lg px-4 py-2.5 ${
                    msg.role === 'user'
                      ? 'bg-brand-navy text-white'
                      : 'bg-white border border-gray-200 text-gray-800'
                  }`}
                >
                  <p className="whitespace-pre-wrap text-sm leading-relaxed">{msg.content}</p>
                </div>
              </div>
            ))
          )}
          {error && (
            <StatusMessage type="error" message={error} onDismiss={() => setError(null)} />
          )}
          <div ref={messagesEndRef} />
        </div>
      </div>

      {/* Input */}
      <div className="bg-white border-t border-gray-200 px-4 py-3 flex-shrink-0">
        <div className="max-w-2xl mx-auto flex gap-2">
          <textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Describe your idea..."
            rows={1}
            disabled={streaming || isLoading}
            className="flex-1 resize-none px-3 py-2 border border-gray-300 rounded-lg shadow-sm focus:outline-none focus:ring-2 focus:ring-brand-navy focus:border-brand-navy disabled:bg-gray-50 disabled:text-gray-400"
          />
          <button
            onClick={handleSend}
            disabled={!input.trim() || streaming || isLoading}
            className="p-2.5 bg-brand-navy text-white rounded-lg hover:bg-brand-navy-light disabled:bg-brand-slate disabled:cursor-not-allowed transition-colors"
          >
            <Send className="h-5 w-5" />
          </button>
        </div>
      </div>
    </div>
  )
}
