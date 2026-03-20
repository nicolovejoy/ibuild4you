'use client'

import { useAuth } from '@/lib/hooks/useAuth'
import { useApproval } from '@/lib/hooks/useApproval'
import {
  useProject,
  useBrief,
  useSessions,
  useMessages,
  useClaimProject,
} from '@/lib/query/hooks'
import { useRouter, useParams } from 'next/navigation'
import { useEffect, useState, useRef, useCallback } from 'react'
import { MessageSquare, Send, ArrowLeft, FileText, Calendar } from 'lucide-react'
import { BuildTimestamp } from '@/components/build-timestamp'
import { apiFetch } from '@/lib/firebase/api-fetch'
import { useQueryClient } from '@tanstack/react-query'
import { StatusMessage } from '@/components/ui/StatusMessage'
import { Card, CardBody } from '@/components/ui/Card'
import { Skeleton } from '@/components/ui/Skeleton'
import type { Message, BriefContent } from '@/lib/types'

const BRIEF_UPDATE_INTERVAL = 15_000

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

  return <ProjectHub projectId={projectId} />
}

function ProjectHub({ projectId }: { projectId: string }) {
  const router = useRouter()
  const claimProject = useClaimProject()
  const { data: project, isLoading: projectLoading } = useProject(projectId)
  const { data: brief } = useBrief(projectId)

  // Auto-claim on mount
  useEffect(() => {
    claimProject.mutate(projectId)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId])

  const briefContent = brief?.content as BriefContent | undefined

  return (
    <div className="min-h-screen bg-brand-cream">
      {/* Header */}
      <header className="bg-white border-b border-gray-200 sticky top-0 z-10">
        <div className="px-4 sm:px-6 h-14 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button
              onClick={() => router.push('/dashboard')}
              className="p-1 hover:bg-gray-100 rounded"
            >
              <ArrowLeft className="h-5 w-5 text-gray-600" />
            </button>
            <div className="group relative">
              <span className="font-semibold text-brand-charcoal">
                {projectLoading ? '...' : project?.title}
              </span>
              <BuildTimestamp />
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-4 py-6 space-y-6">
        {/* Project info */}
        {projectLoading ? (
          <Skeleton className="h-16 w-full rounded-lg" />
        ) : project ? (
          <div className="flex items-center gap-4 text-sm text-brand-slate">
            <span className="flex items-center gap-1.5">
              <Calendar className="h-4 w-4" />
              Started {new Date(project.created_at).toLocaleDateString()}
            </span>
            {project.updated_at !== project.created_at && (
              <span>
                Last updated {new Date(project.updated_at).toLocaleDateString()}
              </span>
            )}
          </div>
        ) : null}

        {/* Brief summary */}
        {briefContent && hasBriefContent(briefContent) && (
          <Card hover={false}>
            <CardBody>
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-sm font-semibold text-brand-slate uppercase tracking-wide flex items-center gap-1.5">
                  <FileText className="h-4 w-4" />
                  Brief
                </h2>
                <button
                  onClick={() => router.push(`/projects/${projectId}/brief`)}
                  className="text-xs text-brand-slate hover:text-brand-navy"
                >
                  View full brief →
                </button>
              </div>
              <BriefSummary content={briefContent} />
            </CardBody>
          </Card>
        )}

        {/* Chat */}
        <div>
          <h2 className="text-sm font-semibold text-brand-slate uppercase tracking-wide flex items-center gap-1.5 mb-3">
            <MessageSquare className="h-4 w-4" />
            Chat
          </h2>
          <ChatSection projectId={projectId} />
        </div>
      </main>
    </div>
  )
}

function BriefSummary({ content }: { content: BriefContent }) {
  const parts: string[] = []
  if (content.problem) parts.push(content.problem)
  if (content.target_users) parts.push(`For: ${content.target_users}`)
  if (content.features?.length > 0) {
    parts.push(`${content.features.length} feature${content.features.length === 1 ? '' : 's'} identified`)
  }

  return (
    <p className="text-sm text-gray-700 leading-relaxed">
      {parts.join(' · ') || 'Brief is being generated...'}
    </p>
  )
}

function hasBriefContent(brief: BriefContent): boolean {
  return !!(
    brief.problem ||
    brief.target_users ||
    (brief.features && brief.features.length > 0) ||
    brief.constraints ||
    brief.additional_context
  )
}

function ChatSection({ projectId }: { projectId: string }) {
  const queryClient = useQueryClient()
  const { data: sessions, isLoading: sessionsLoading } = useSessions(projectId)
  const activeSession = sessions?.find((s) => s.status === 'active') || sessions?.[0]
  const sessionId = activeSession?.id

  const { data: savedMessages, isLoading: messagesLoading } = useMessages(sessionId)

  const [messages, setMessages] = useState<Pick<Message, 'role' | 'content'>[]>([])
  const [input, setInput] = useState('')
  const [streaming, setStreaming] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const lastBriefUpdate = useRef<number>(0)
  const briefTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Sync saved messages into local state
  useEffect(() => {
    if (savedMessages) {
      setMessages(savedMessages.map((m) => ({ role: m.role, content: m.content })))
    }
  }, [savedMessages])

  // Trigger brief update with debounce
  const triggerBriefUpdate = useCallback(() => {
    if (!sessionId) return

    const now = Date.now()
    const elapsed = now - lastBriefUpdate.current

    if (briefTimerRef.current) {
      clearTimeout(briefTimerRef.current)
      briefTimerRef.current = null
    }

    if (elapsed >= BRIEF_UPDATE_INTERVAL) {
      lastBriefUpdate.current = now
      apiFetch('/api/briefs/generate', {
        method: 'POST',
        body: JSON.stringify({ project_id: projectId }),
      })
        .then(() => queryClient.invalidateQueries({ queryKey: ['brief', projectId] }))
        .catch((err) => console.error('Brief update failed:', err))
    } else {
      const remaining = BRIEF_UPDATE_INTERVAL - elapsed
      briefTimerRef.current = setTimeout(() => {
        lastBriefUpdate.current = Date.now()
        apiFetch('/api/briefs/generate', {
          method: 'POST',
          body: JSON.stringify({ project_id: projectId }),
        })
          .then(() => queryClient.invalidateQueries({ queryKey: ['brief', projectId] }))
          .catch((err) => console.error('Brief update failed:', err))
      }, remaining)
    }
  }, [projectId, sessionId, queryClient])

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

    setMessages((prev) => [...prev, { role: 'user', content: userMessage }])
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

      queryClient.invalidateQueries({ queryKey: ['messages', sessionId] })
      triggerBriefUpdate()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong')
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

  // Show messages newest first
  const displayMessages = [...messages].reverse()

  return (
    <div className="space-y-3">
      {/* Input at top */}
      <div className="flex gap-2">
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

      {error && (
        <StatusMessage type="error" message={error} onDismiss={() => setError(null)} />
      )}

      {/* Messages — newest first */}
      {isLoading ? (
        <div className="space-y-3">
          <Skeleton className="h-16 w-3/4 rounded-lg" />
          <Skeleton className="h-16 w-2/3 rounded-lg ml-auto" />
        </div>
      ) : displayMessages.length === 0 ? (
        <div className="text-center text-brand-slate py-8">
          <MessageSquare className="h-10 w-10 mx-auto mb-3 text-gray-300" />
          <p>Send a message to start the conversation.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {displayMessages.map((msg, i) => (
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
          ))}
        </div>
      )}
    </div>
  )
}
