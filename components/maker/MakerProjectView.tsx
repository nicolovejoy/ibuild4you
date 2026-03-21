'use client'

import { useState, useRef, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowLeft, Send, FileText, ChevronDown, ChevronUp, MessageSquare } from 'lucide-react'
import { BuildTimestamp } from '@/components/build-timestamp'
import { Card, CardBody } from '@/components/ui/Card'
import { Skeleton } from '@/components/ui/Skeleton'
import { StatusMessage } from '@/components/ui/StatusMessage'
import {
  useProject,
  useBrief,
  useSessions,
  useMessages,
  useCreateSession,
} from '@/lib/query/hooks'
import { apiFetch } from '@/lib/firebase/api-fetch'
import { useQueryClient } from '@tanstack/react-query'
import type { BriefContent, Session } from '@/lib/types'

export function MakerProjectView({ projectId, userEmail }: { projectId: string; userEmail: string }) {
  const router = useRouter()
  const { data: project, isLoading: projectLoading } = useProject(projectId)
  const { data: brief } = useBrief(projectId)
  const { data: sessions } = useSessions(projectId)
  const activeSession = sessions?.find((s) => s.status === 'active')
  const completedSessions = sessions?.filter((s) => s.status === 'completed') || []

  const briefContent = brief?.content as BriefContent | undefined
  const hasBriefData = briefContent && hasBriefContent(briefContent)

  return (
    <div className="min-h-screen bg-brand-cream">
      <header className="bg-white border-b border-gray-200 sticky top-0 z-10">
        <div className="px-4 sm:px-6 h-14 flex items-center gap-3">
          <button onClick={() => router.push('/dashboard')} className="p-1 hover:bg-gray-100 rounded">
            <ArrowLeft className="h-5 w-5 text-gray-600" />
          </button>
          <div className="group relative">
            <span className="font-semibold text-brand-charcoal">
              {projectLoading ? '...' : project?.title}
            </span>
            <BuildTimestamp />
          </div>
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-4 py-6 space-y-4">
        {/* Brief card */}
        {hasBriefData && (
          <BriefCard content={briefContent!} version={brief?.version} />
        )}

        {/* Always-open chat */}
        <MakerChat
          projectId={projectId}
          userEmail={userEmail}
          activeSession={activeSession || null}
          sessionsLoaded={!!sessions}
        />

        {/* Previous conversations */}
        {completedSessions.length > 0 && (
          <SessionHistory sessions={completedSessions} />
        )}
      </main>
    </div>
  )
}

function BriefCard({ content, version }: { content: BriefContent; version?: number }) {
  const [expanded, setExpanded] = useState(false)

  const featureCount = content.features?.length || 0
  const decisionCount = content.decisions?.length || 0

  const summaryParts: string[] = []
  if (content.problem) summaryParts.push(content.problem)
  if (featureCount > 0) summaryParts.push(`${featureCount} feature${featureCount === 1 ? '' : 's'}`)
  if (decisionCount > 0) summaryParts.push(`${decisionCount} decision${decisionCount === 1 ? '' : 's'}`)

  return (
    <Card hover={false}>
      <CardBody>
        <button
          onClick={() => setExpanded(!expanded)}
          className="w-full flex items-center justify-between"
        >
          <div className="flex items-center gap-2 text-sm">
            <FileText className="h-4 w-4 text-brand-navy" />
            <span className="font-medium text-gray-900">What we know so far</span>
            {version && <span className="text-xs text-gray-400">v{version}</span>}
          </div>
          {expanded
            ? <ChevronUp className="h-4 w-4 text-gray-400" />
            : <ChevronDown className="h-4 w-4 text-gray-400" />
          }
        </button>
        <p className="text-sm text-gray-500 mt-1">
          {summaryParts.join(' \u00b7 ')}
        </p>
        {expanded && (
          <div className="mt-3 space-y-3 text-sm text-gray-700">
            {content.problem && (
              <div>
                <p className="text-xs font-medium text-gray-500 uppercase mb-1">Problem</p>
                <p>{content.problem}</p>
              </div>
            )}
            {content.target_users && (
              <div>
                <p className="text-xs font-medium text-gray-500 uppercase mb-1">Target users</p>
                <p>{content.target_users}</p>
              </div>
            )}
            {featureCount > 0 && (
              <div>
                <p className="text-xs font-medium text-gray-500 uppercase mb-1">Features</p>
                <ul className="list-disc list-inside space-y-0.5">
                  {content.features.map((f, i) => <li key={i}>{f}</li>)}
                </ul>
              </div>
            )}
            {content.constraints && (
              <div>
                <p className="text-xs font-medium text-gray-500 uppercase mb-1">Constraints</p>
                <p>{content.constraints}</p>
              </div>
            )}
            {decisionCount > 0 && (
              <div>
                <p className="text-xs font-medium text-gray-500 uppercase mb-1">Decisions</p>
                <ul className="space-y-1">
                  {content.decisions!.map((d, i) => (
                    <li key={i}>
                      <span className="font-medium">{d.topic}:</span> {d.decision}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </CardBody>
    </Card>
  )
}

function MakerChat({
  projectId,
  userEmail,
  activeSession,
  sessionsLoaded,
}: {
  projectId: string
  userEmail: string
  activeSession: Session | null
  sessionsLoaded: boolean
}) {
  const queryClient = useQueryClient()
  const createSession = useCreateSession()
  const sessionId = activeSession?.id

  const { data: savedMessages, isLoading: messagesLoading } = useMessages(sessionId)

  type ChatMessage = { id?: string; role: 'user' | 'agent'; content: string; created_at?: string; sender_email?: string }
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState('')
  const [streaming, setStreaming] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [creatingSession, setCreatingSession] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    if (savedMessages) {
      setMessages(savedMessages.map((m) => ({
        id: m.id, role: m.role, content: m.content,
        created_at: m.created_at, sender_email: m.sender_email,
      })))
    }
  }, [savedMessages])

  const handleSend = async () => {
    if (!input.trim() || streaming || creatingSession) return

    const userMessage = input.trim()
    setInput('')
    setError(null)

    // Auto-create session if none active
    let targetSessionId = sessionId
    if (!targetSessionId) {
      setCreatingSession(true)
      try {
        const newSession = await createSession.mutateAsync({ project_id: projectId })
        targetSessionId = newSession.id
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to start session')
        setCreatingSession(false)
        return
      }
      setCreatingSession(false)
    }

    const nowIso = new Date().toISOString()
    setMessages((prev) => [...prev, { role: 'user', content: userMessage, created_at: nowIso, sender_email: userEmail }])
    setMessages((prev) => [...prev, { role: 'agent', content: '', created_at: nowIso }])
    setStreaming(true)

    try {
      const res = await apiFetch('/api/chat', {
        method: 'POST',
        body: JSON.stringify({ session_id: targetSessionId, content: userMessage }),
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

      queryClient.invalidateQueries({ queryKey: ['messages', targetSessionId] })
      queryClient.invalidateQueries({ queryKey: ['sessions', projectId] })
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

  const isLoading = !sessionsLoaded || messagesLoading
  const displayMessages = [...messages].reverse()

  return (
    <div className="space-y-3">
      {/* Input always visible */}
      <div className="flex gap-2">
        <textarea
          ref={textareaRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Type a message..."
          rows={1}
          disabled={streaming || isLoading || creatingSession}
          className="flex-1 resize-none px-3 py-2 border border-gray-300 rounded-lg shadow-sm focus:outline-none focus:ring-2 focus:ring-brand-navy focus:border-brand-navy disabled:bg-gray-50 disabled:text-gray-400"
        />
        <button
          onClick={handleSend}
          disabled={!input.trim() || streaming || isLoading || creatingSession}
          className="p-2.5 bg-brand-navy text-white rounded-lg hover:bg-brand-navy-light disabled:bg-brand-slate disabled:cursor-not-allowed transition-colors"
        >
          <Send className="h-5 w-5" />
        </button>
      </div>

      {error && <StatusMessage type="error" message={error} onDismiss={() => setError(null)} />}

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
            <div key={msg.id || i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
              <div className={`max-w-[80%] rounded-lg px-4 py-2.5 ${
                msg.role === 'user'
                  ? 'bg-brand-navy text-white'
                  : 'bg-white border border-gray-200 text-gray-800'
              }`}>
                <p className={`text-[10px] mb-1 ${msg.role === 'user' ? 'text-blue-200' : 'text-gray-400'}`}>
                  {msg.role === 'user' ? (msg.sender_email || userEmail) : 'iBuild4you assistant'}
                  {msg.created_at ? ` \u00b7 ${formatTimestamp(msg.created_at)}` : ''}
                </p>
                <p className="whitespace-pre-wrap text-sm leading-relaxed">{msg.content}</p>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function SessionHistory({ sessions }: { sessions: Session[] }) {
  const [expandedId, setExpandedId] = useState<string | null>(null)

  return (
    <Card hover={false}>
      <CardBody>
        <h3 className="text-sm font-semibold text-brand-slate uppercase tracking-wide mb-2">
          Previous conversations
        </h3>
        <div className="space-y-1">
          {sessions.map((session, i) => (
            <SessionAccordion
              key={session.id}
              session={session}
              sessionNumber={i + 1}
              expanded={expandedId === session.id}
              onToggle={() => setExpandedId(expandedId === session.id ? null : session.id)}
            />
          ))}
        </div>
      </CardBody>
    </Card>
  )
}

function SessionAccordion({
  session,
  sessionNumber,
  expanded,
  onToggle,
}: {
  session: Session
  sessionNumber: number
  expanded: boolean
  onToggle: () => void
}) {
  const { data: messages, isLoading } = useMessages(expanded ? session.id : undefined)

  const date = new Date(session.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })

  return (
    <div>
      <button
        onClick={onToggle}
        className="w-full flex items-center justify-between py-2 px-2 rounded hover:bg-gray-50 text-sm text-gray-700"
      >
        <span>Session {sessionNumber} &middot; {date}</span>
        <div className="flex items-center gap-2 text-gray-400">
          {session.token_usage_input != null && (
            <span className="text-[10px]">
              {((session.token_usage_input + (session.token_usage_output || 0)) / 1000).toFixed(1)}k tokens
            </span>
          )}
          {expanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
        </div>
      </button>
      {expanded && (
        <div className="px-2 pb-3 space-y-2">
          {isLoading ? (
            <Skeleton className="h-12 w-full rounded" />
          ) : messages?.length === 0 ? (
            <p className="text-xs text-gray-400 py-2">No messages in this session.</p>
          ) : (
            messages?.map((msg, i) => (
              <div key={msg.id || i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                <div className={`max-w-[85%] rounded-lg px-3 py-2 ${
                  msg.role === 'user'
                    ? 'bg-brand-navy/10 text-gray-800'
                    : 'bg-gray-50 border border-gray-100 text-gray-700'
                }`}>
                  <p className="text-[10px] text-gray-400 mb-0.5">
                    {msg.role === 'user' ? (msg.sender_email || 'You') : 'Assistant'}
                    {msg.created_at ? ` \u00b7 ${formatTimestamp(msg.created_at)}` : ''}
                  </p>
                  <p className="whitespace-pre-wrap text-sm leading-relaxed">{msg.content}</p>
                </div>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  )
}

function hasBriefContent(brief: BriefContent): boolean {
  return !!(
    brief.problem ||
    brief.target_users ||
    (brief.features && brief.features.length > 0) ||
    brief.constraints ||
    brief.additional_context ||
    (brief.decisions && brief.decisions.length > 0)
  )
}

function formatTimestamp(iso: string): string {
  const date = new Date(iso)
  const now = new Date()
  const isToday = date.toDateString() === now.toDateString()
  const time = date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })
  if (isToday) return time
  return `${date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} ${time}`
}
