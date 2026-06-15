'use client'

import { useState, useEffect, useRef } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import {
  ArrowLeft, MessageSquare, Send, FileText, Sparkles, Plus, X,
  Share2, ChevronDown, ChevronUp, Copy, Check, Mail, RotateCw,
  Lock, Trash2, Settings, Upload, ClipboardCopy, Users,
} from 'lucide-react'
import { BuildTimestamp } from '@/components/build-timestamp'
import { Card, CardBody } from '@/components/ui/Card'
import { Skeleton } from '@/components/ui/Skeleton'
import { StatusMessage } from '@/components/ui/StatusMessage'
import { LoadingButton } from '@/components/ui/LoadingButton'
import { EmptyState } from '@/components/ui/EmptyState'
import { MessageContent } from '@/components/ui/MessageContent'
import { MockupEditor } from './MockupEditor'
import { parseNextConvoPayload } from '@/lib/api/import-payload'
import { useEscapeBack } from '@/lib/hooks/useEscapeBack'
import { useNudgeCopy } from '@/lib/hooks/useNudgeCopy'
import { getProjectShareLink } from '@/lib/url'
import { Modal } from '@/components/ui/Modal'
import {
  useProject,
  useBrief,
  useUpdateBrief,
  useSessions,
  useMessages,
  useDeleteMessage,
  useUpdateProject,
  useGenerateWelcome,
  useShareProject,
  useProjectPasscode,
  useResetPasscode,
  useCreateSession,
  useProjectFiles,
  useProjectMembers,
  useSetBriefRole,
  useSendMakerEmail,
} from '@/lib/query/hooks'
import { buildNextConvoPrompt } from '@/lib/agent/next-convo-prompt'
import { copy, getMakerShortName } from '@/lib/copy'
import { briefRoleLabel, briefRoleShort, viewerBriefRole } from '@/lib/roles/display'
import { apiFetch } from '@/lib/firebase/api-fetch'
import { useStreamingChat } from '@/lib/hooks/useStreamingChat'
import { useRealtimeMessages } from '@/lib/hooks/useRealtimeMessages'
import { useQueryClient } from '@tanstack/react-query'
import { BuilderFilesTab } from './BuilderFilesTab'
import { getTurnIndicator } from '@/lib/turn-indicator'
import { TurnBadge } from '@/components/ui/TurnBadge'
import { BriefSwitcher } from '@/components/brief-switcher'
import type { Project, Session, BriefContent, WireframeMockup } from '@/lib/types'

type TabId = 'sessions' | 'brief' | 'files' | 'setup'

export function BuilderProjectView({ projectId, userEmail }: { projectId: string; userEmail: string }) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const { data: project, isLoading: projectLoading } = useProject(projectId)
  const { data: sessions } = useSessions(projectId)
  const { data: brief } = useBrief(projectId)
  const { data: projectFiles } = useProjectFiles(projectId)

  useEscapeBack('/dashboard')
  const updateProject = useUpdateProject()
  const activeSession = sessions?.find((s) => s.status === 'active')
  const [showShareModal, setShowShareModal] = useState(false)
  const [editingTitle, setEditingTitle] = useState(false)
  const [titleDraft, setTitleDraft] = useState('')
  // After a next-convo JSON import, hand the builder straight to the next step
  // (Setup tab, prep section expanded) instead of leaving them on the Brief tab
  // with no cue (#25). Consumed one-shot by NextConversationTab on mount.
  const [justImported, setJustImported] = useState(false)
  const tabParam = searchParams.get('tab') as TabId | null
  const defaultTab: TabId = (!project || !project.requester_email) ? 'setup' : 'sessions'
  const activeTab: TabId = tabParam && ['sessions', 'brief', 'files', 'setup'].includes(tabParam) ? tabParam : defaultTab

  const setTab = (tab: TabId) => {
    const params = new URLSearchParams(searchParams.toString())
    if (tab === 'sessions') {
      params.delete('tab')
    } else {
      params.set('tab', tab)
    }
    params.delete('session') // clear session selection when changing tabs
    const qs = params.toString()
    router.replace(`/projects/${project?.slug || projectId}${qs ? `?${qs}` : ''}`, { scroll: false })
  }

  // Turn indicator — builder view always sees builder perspective
  const turn = getTurnIndicator(project, 'builder')

  // Tab definitions used by both the desktop sidebar and mobile bottom tab bar.
  const tabs: { id: TabId; label: string; shortLabel: string; Icon: typeof MessageSquare; tooltip: string }[] = [
    { id: 'sessions', label: 'Sessions', shortLabel: 'Sessions', Icon: MessageSquare, tooltip: copy.glossary.session.short },
    { id: 'brief', label: 'Brief', shortLabel: 'Brief', Icon: FileText, tooltip: copy.glossary.brief.short },
    { id: 'files', label: `Files${projectFiles?.length ? ` (${projectFiles.length})` : ''}`, shortLabel: 'Files', Icon: Upload, tooltip: copy.glossary.files.short },
    { id: 'setup', label: 'Setup', shortLabel: 'Setup', Icon: Settings, tooltip: copy.glossary.setup.short },
  ]

  return (
    // Builder view: operator-console layout. Dark slate side rail on desktop,
    // bottom tab bar on phone. The chrome itself is the loudest signal that
    // this is a different surface from the maker chat view.
    <div className="min-h-screen bg-stone-50 md:flex">
      {/* Desktop side rail */}
      <aside className="hidden md:flex md:flex-col w-[200px] bg-slate-900 text-slate-100 sticky top-0 h-screen shrink-0 z-10">
        <div className="p-4 space-y-3 border-b border-slate-800">
          <button
            onClick={() => router.push('/dashboard')}
            className="flex items-center gap-2 text-slate-300 hover:text-white transition-colors text-sm"
            title="Back to dashboard"
          >
            <ArrowLeft className="h-4 w-4" />
            <span>Dashboard</span>
          </button>
          <span
            className="inline-block text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded bg-brand-navy text-white"
            title={briefRoleShort(viewerBriefRole(project?.viewer_role, project?.viewer_brief_role))}
          >
            {briefRoleLabel(viewerBriefRole(project?.viewer_role, project?.viewer_brief_role))}
          </span>
        </div>
        <nav className="flex-1 p-2 space-y-1">
          {tabs.map(({ id, label, Icon, tooltip }) => (
            <button
              key={id}
              onClick={() => setTab(id)}
              title={tooltip}
              className={`w-full flex items-center gap-3 px-3 py-2 rounded text-sm transition-colors ${
                activeTab === id
                  ? 'bg-slate-700 text-white'
                  : 'text-slate-300 hover:bg-slate-800 hover:text-white'
              }`}
            >
              <Icon className="h-4 w-4 shrink-0" />
              <span className="truncate">{label}</span>
            </button>
          ))}
        </nav>
      </aside>

      {/* Main column */}
      <div className="flex-1 min-w-0 pb-20 md:pb-0">
        {/* Top sub-header (per-brief context: title, share, status) */}
        <header className="bg-white border-b border-gray-200 sticky top-0 z-10">
          <div className="px-4 sm:px-6 py-3 space-y-2">
            {/* Mobile-only: back + Builder chip on its own row */}
            <div className="md:hidden flex items-center gap-2">
              <button onClick={() => router.push('/dashboard')} className="p-1 hover:bg-gray-100 rounded">
                <ArrowLeft className="h-5 w-5 text-gray-600" />
              </button>
              <span
                className="text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded bg-brand-navy text-white"
                title={briefRoleShort(viewerBriefRole(project?.viewer_role, project?.viewer_brief_role))}
              >
                {briefRoleLabel(viewerBriefRole(project?.viewer_role, project?.viewer_brief_role))}
              </span>
            </div>

            {/* Title + turn indicator */}
            <div className="flex items-center justify-between gap-3">
              <div className="group relative min-w-0 flex items-center gap-2">
                <BriefSwitcher currentId={project?.id} currentTitle={project?.title} loading={projectLoading} compact />
                {editingTitle ? (
                  <input
                    type="text"
                    value={titleDraft}
                    onChange={(e) => setTitleDraft(e.target.value)}
                    onBlur={() => {
                      if (titleDraft.trim() && titleDraft.trim() !== project?.title) {
                        updateProject.mutate({ project_id: projectId, title: titleDraft.trim() })
                      }
                      setEditingTitle(false)
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
                      if (e.key === 'Escape') setEditingTitle(false)
                    }}
                    className="font-semibold text-brand-charcoal bg-transparent border-b-2 border-brand-navy outline-none px-0 py-0 min-w-0 flex-1"
                    autoFocus
                  />
                ) : (
                  <button
                    onClick={() => { setTitleDraft(project?.title || ''); setEditingTitle(true) }}
                    className="font-semibold text-brand-charcoal hover:text-brand-navy cursor-text truncate"
                    title="Click to rename"
                  >
                    {projectLoading ? '...' : project?.title}
                  </button>
                )}
                <BuildTimestamp />
              </div>
              {turn && (
                <TurnBadge turn={turn} className={`text-xs px-2.5 py-1 rounded-full font-medium shrink-0 ${turn.className}`} />
              )}
            </div>

            {/* Meta line: share + count */}
            {project && (
              <div className="flex items-center gap-3 text-sm text-gray-500">
                {project.requester_email ? (
                  <button
                    onClick={() => setShowShareModal(true)}
                    className="flex items-center gap-1.5 hover:text-brand-navy transition-colors"
                  >
                    <Share2 className="h-3.5 w-3.5" />
                    <span>{project.requester_first_name ? `${project.requester_first_name}${project.requester_last_name ? ` ${project.requester_last_name.charAt(0)}` : ''}` : project.requester_email?.split('@')[0]}</span>
                  </button>
                ) : (
                  <button
                    onClick={() => setShowShareModal(true)}
                    className="flex items-center gap-1.5 text-brand-navy hover:text-brand-navy-light transition-colors font-medium"
                  >
                    <Share2 className="h-3.5 w-3.5" />
                    Share
                  </button>
                )}
                {sessions && <span>{sessions.length} session{sessions.length === 1 ? '' : 's'}</span>}
              </div>
            )}
          </div>
        </header>

        <main className="max-w-4xl mx-auto px-4 py-6">
          {activeTab === 'sessions' && (
            <SessionsTab
              projectId={projectId}
              slug={project?.slug}
              userEmail={userEmail}
              sessions={sessions || []}
              sessionsLoaded={!!sessions}
            />
          )}
          {activeTab === 'brief' && (
            <BriefTab
              projectId={projectId}
              brief={brief}
              project={project}
              onImported={() => { setJustImported(true); setTab('setup') }}
            />
          )}
          {activeTab === 'files' && (
            <BuilderFilesTab projectId={projectId} files={projectFiles || []} />
          )}
          {activeTab === 'setup' && project && (
            <NextConversationTab
              project={project}
              projectId={projectId}
              sessions={sessions || []}
              activeSession={activeSession || null}
              onShare={() => setShowShareModal(true)}
              justImported={justImported}
              onImportedConsumed={() => setJustImported(false)}
            />
          )}
        </main>
      </div>

      {/* Mobile bottom tab bar */}
      <nav className="md:hidden fixed bottom-0 left-0 right-0 bg-slate-900 text-slate-100 border-t border-slate-800 grid grid-cols-4 z-20">
        {tabs.map(({ id, shortLabel, Icon }) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className={`flex flex-col items-center justify-center py-2 text-[11px] gap-0.5 transition-colors ${
              activeTab === id ? 'text-white' : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <Icon className={`h-5 w-5 ${activeTab === id ? 'text-white' : ''}`} />
            <span>{shortLabel}</span>
          </button>
        ))}
      </nav>

      {/* Share modal */}
      {project && showShareModal && (
        <ShareModal project={project} onClose={() => setShowShareModal(false)} />
      )}
    </div>
  )
}

// --- Sessions Tab ---

function SessionsTab({
  projectId,
  slug,
  userEmail,
  sessions,
  sessionsLoaded,
}: {
  projectId: string
  slug?: string
  userEmail: string
  sessions: Session[]
  sessionsLoaded: boolean
}) {
  const searchParams = useSearchParams()
  const router = useRouter()
  const activeSession = sessions.find((s) => s.status === 'active')
  const sessionParam = searchParams.get('session')
  const [selectedId, setSelectedId] = useState<string | null>(null)

  // Determine selected session
  useEffect(() => {
    if (sessionParam && sessions.some((s) => s.id === sessionParam)) {
      setSelectedId(sessionParam)
    } else if (activeSession) {
      setSelectedId(activeSession.id)
    } else if (sessions.length > 0) {
      setSelectedId(sessions[sessions.length - 1].id)
    }
  }, [sessionParam, sessions, activeSession])

  const handleSelectSession = (sessionId: string) => {
    setSelectedId(sessionId)
    const params = new URLSearchParams(searchParams.toString())
    params.set('session', sessionId)
    params.delete('tab')
    router.replace(`/projects/${slug || projectId}?${params.toString()}`, { scroll: false })
  }

  const selectedSession = sessions.find((s) => s.id === selectedId)

  if (!sessionsLoaded) {
    return <Skeleton className="h-64 w-full rounded-lg" />
  }

  if (sessions.length === 0) {
    return (
      <EmptyState
        icon={MessageSquare}
        title="No sessions yet"
        description="Create a session in the Setup tab to get started."
      />
    )
  }

  return (
    <div className="flex gap-6">
      {/* Session sidebar */}
      <div className="w-56 shrink-0 space-y-1">
        {sessions.map((session, i) => {
          const isActive = session.status === 'active'
          const isSelected = session.id === selectedId
          const mode = session.session_mode || 'discover'
          return (
            <button
              key={session.id}
              onClick={() => handleSelectSession(session.id)}
              className={`w-full text-left px-3 py-2 rounded-lg text-sm transition-colors ${
                isSelected
                  ? 'bg-white shadow-sm border border-gray-200'
                  : 'hover:bg-white/50'
              }`}
            >
              <div className="flex items-center gap-2">
                <span className={`w-2 h-2 rounded-full shrink-0 ${isActive ? 'bg-green-500' : 'bg-gray-300'}`} />
                <span className="font-medium text-gray-900">Session {sessions.length - i}</span>
                <span className="text-[10px] text-gray-400 bg-gray-100 px-1.5 py-0.5 rounded">{mode}</span>
              </div>
              <div className="text-xs text-gray-400 mt-0.5 ml-4">
                {new Date(session.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                {session.token_usage_input != null && (
                  <> &middot; {((session.token_usage_input + (session.token_usage_output || 0)) / 1000).toFixed(1)}k tokens</>
                )}
              </div>
            </button>
          )
        })}
      </div>

      {/* Selected session content */}
      <div className="flex-1 min-w-0">
        {selectedSession ? (
          <SessionChat
            key={selectedSession.id}
            session={selectedSession}
            projectId={projectId}
            userEmail={userEmail}
            isActive={selectedSession.status === 'active'}
          />
        ) : (
          <p className="text-sm text-gray-400">Select a conversation</p>
        )}
      </div>
    </div>
  )
}

function SessionChat({
  session,
  projectId,
  userEmail,
  isActive,
}: {
  session: Session
  projectId: string
  userEmail: string
  isActive: boolean
}) {
  const sessionId = session.id
  const { messages, setMessages, streaming, error, setError, streamMessage } = useStreamingChat({ projectId })

  const { data: savedMessages, isLoading } = useMessages(sessionId)
  useRealtimeMessages(sessionId)
  const deleteMessage = useDeleteMessage()

  const [input, setInput] = useState('')
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    if (savedMessages && !streaming) {
      setMessages(savedMessages.map((m) => ({
        id: m.id, role: m.role, content: m.content,
        created_at: m.created_at, sender_email: m.sender_email, sender_display_name: m.sender_display_name,
      })))
    }
  }, [savedMessages, streaming, setMessages])

  const handleSend = async () => {
    if (!input.trim() || streaming) return

    const userMessage = input.trim()
    setInput('')
    setError(null)

    const nowIso = new Date().toISOString()
    setMessages((prev) => [...prev, { role: 'user', content: userMessage, created_at: nowIso, sender_email: userEmail }])

    await streamMessage(sessionId, userMessage)
    textareaRef.current?.focus()
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  const displayMessages = [...messages].reverse()

  return (
    <div className="space-y-3">
      {/* Chat input — only for active sessions */}
      {isActive && (
        <div className="flex gap-2">
          <textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Type a message..."
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
      )}

      {!isActive && (
        <div className="text-xs text-gray-400 bg-gray-50 rounded-lg px-3 py-2 flex items-center gap-1.5">
          <Lock className="h-3.5 w-3.5" />
          Completed conversation — read only
        </div>
      )}

      {error && <StatusMessage type="error" message={error} onDismiss={() => setError(null)} />}

      {isLoading ? (
        <div className="space-y-3">
          <Skeleton className="h-16 w-3/4 rounded-lg" />
          <Skeleton className="h-16 w-2/3 rounded-lg ml-auto" />
        </div>
      ) : displayMessages.length === 0 ? (
        <div className="text-center text-brand-slate py-8">
          <MessageSquare className="h-10 w-10 mx-auto mb-3 text-gray-300" />
          <p className="text-sm">No messages yet.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {displayMessages.map((msg, i) => (
            <div
              key={msg.id || i}
              className={`group flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
            >
              <div className={`relative max-w-[80%] rounded-lg px-4 py-2.5 ${
                msg.role === 'user'
                  ? 'bg-brand-navy text-white'
                  : 'bg-white border border-gray-200 text-gray-800'
              }`}>
                <p className={`text-[10px] mb-1 ${msg.role === 'user' ? 'text-blue-200' : 'text-gray-400'}`}>
                  {msg.role === 'user' ? (msg.sender_display_name || msg.sender_email?.split('@')[0] || 'You') : copy.chat.agentLabel}
                  {msg.created_at ? ` \u00b7 ${formatTimestamp(msg.created_at)}` : ''}
                </p>
                <MessageContent content={msg.content} />
                {msg.id && (
                  <button
                    onClick={() => deleteMessage.mutate({ messageId: msg.id!, sessionId })}
                    className="absolute -top-2 -right-2 p-1 bg-white border border-gray-200 rounded-full text-gray-400 hover:text-red-600 hover:border-red-200 opacity-0 group-hover:opacity-100 transition-opacity shadow-sm"
                    title="Delete message"
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Inline config used for this conversation */}
      <ConfigUsed session={session} />
    </div>
  )
}

function ConfigUsed({ session }: { session: Session }) {
  const [expanded, setExpanded] = useState(false)
  const mode = session.session_mode || 'discover'
  const questions = session.seed_questions || []
  const dirs = session.builder_directives || []
  const hasConfig = questions.length > 0 || dirs.length > 0 || !!session.welcome_message

  if (!hasConfig) return null

  return (
    <div className="border-t border-gray-100 pt-3 mt-3">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-1.5 text-xs text-gray-400 hover:text-gray-600"
      >
        <Settings className="h-3.5 w-3.5" />
        Config used
        <span className="bg-gray-100 px-1.5 py-0.5 rounded text-[10px]">{mode}</span>
        {expanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
      </button>
      {expanded && (
        <div className="mt-2 space-y-2 text-sm text-gray-600">
          {session.welcome_message && (
            <div>
              <p className="text-xs font-medium text-gray-500 uppercase mb-1">Opening message</p>
              <p className="text-sm text-gray-700 bg-gray-50 rounded px-2.5 py-1.5 whitespace-pre-wrap">{session.welcome_message}</p>
            </div>
          )}
          {questions.length > 0 && (
            <div>
              <p className="text-xs font-medium text-gray-500 uppercase mb-1">Seed questions</p>
              <ul className="space-y-1">
                {questions.map((q, i) => <li key={i} className="bg-gray-50 rounded px-2.5 py-1.5 text-sm">{i + 1}. {q}</li>)}
              </ul>
            </div>
          )}
          {dirs.length > 0 && (
            <div>
              <p className="text-xs font-medium text-gray-500 uppercase mb-1">Builder directives</p>
              <ul className="space-y-1">
                {dirs.map((d, i) => <li key={i} className="bg-gray-50 rounded px-2.5 py-1.5 text-sm">{i + 1}. {d}</li>)}
              </ul>
            </div>
          )}
          {session.model && <p className="text-xs text-gray-400">Model: {session.model}</p>}
        </div>
      )}
    </div>
  )
}

// --- Brief Tab ---

function BriefTab({
  projectId,
  brief,
  project,
  onImported,
}: {
  projectId: string
  brief: { version: number; content: BriefContent } | null | undefined
  project: Project | undefined
  onImported?: () => void
}) {
  const [payloadCopied, setPayloadCopied] = useState(false)
  const [briefCopied, setBriefCopied] = useState(false)
  const [pasteJson, setPasteJson] = useState('')
  const [pasteError, setPasteError] = useState<string | null>(null)
  const queryClient = useQueryClient()
  const [generating, setGenerating] = useState(false)
  const [loadingPayload, setLoadingPayload] = useState(false)
  const updateBrief = useUpdateBrief()
  const updateProject = useUpdateProject()

  const briefContent = brief?.content as BriefContent | undefined
  const hasBrief = briefContent && hasBriefContent(briefContent)

  const handleGenerate = async () => {
    setGenerating(true)
    try {
      await apiFetch('/api/briefs/generate', {
        method: 'POST',
        body: JSON.stringify({ project_id: projectId }),
      })
      queryClient.invalidateQueries({ queryKey: ['brief', projectId] })
    } catch (err) {
      console.error('Brief generation failed:', err)
    } finally {
      setGenerating(false)
    }
  }

  const handleCopyPayload = async () => {
    setLoadingPayload(true)
    try {
      // Fetch all sessions for the project
      const sessionsRes = await apiFetch(`/api/sessions?project_id=${projectId}`)
      if (!sessionsRes.ok) throw new Error('Failed to load sessions')
      const sessions = await sessionsRes.json()

      // Sort by created_at ascending
      sessions.sort((a: { created_at: string }, b: { created_at: string }) =>
        a.created_at.localeCompare(b.created_at)
      )

      // Fetch messages for each session
      const allMessages: { role: string; content: string }[] = []
      for (const session of sessions) {
        const msgRes = await apiFetch(`/api/messages?session_id=${session.id}`)
        if (!msgRes.ok) continue
        const messages = await msgRes.json()
        for (const msg of messages) {
          allMessages.push({ role: msg.role, content: msg.content })
        }
      }

      // Build current brief if it exists
      let currentBrief: BriefContent | null = null
      if (briefContent && hasBrief) {
        currentBrief = briefContent
      }

      // Build the prompt
      const prompt = buildNextConvoPrompt({
        currentBrief,
        conversationHistory: allMessages,
        projectTitle: project?.title || 'Untitled',
        sessionCount: sessions?.length || 0,
      })

      await navigator.clipboard.writeText(prompt)
      setPayloadCopied(true)
      setTimeout(() => setPayloadCopied(false), 2000)
    } catch (err) {
      console.error('Failed to copy payload:', err)
    } finally {
      setLoadingPayload(false)
    }
  }

  const handleImportJson = async () => {
    setPasteError(null)
    const result = parseNextConvoPayload(pasteJson)
    if (!result.ok) {
      setPasteError(result.error)
      return
    }

    try {
      if (result.value.mode === 'multi') {
        await updateBrief.mutateAsync({ project_id: projectId, content: result.value.brief })
        if (Object.keys(result.value.projectUpdate).length > 0) {
          await updateProject.mutateAsync({
            project_id: projectId,
            ...result.value.projectUpdate,
          } as Parameters<typeof updateProject.mutateAsync>[0])
        }
      } else {
        await updateBrief.mutateAsync({ project_id: projectId, content: result.value.brief as BriefContent })
      }
      setPasteJson('')
      // Import succeeded — hand the builder to the next step instead of leaving
      // them staring at the updated brief with no cue (#25).
      onImported?.()
    } catch (err) {
      setPasteError(err instanceof Error ? err.message : 'Failed to save')
    }
  }

  const formatBrief = () => {
    if (!briefContent) return ''
    const sections: string[] = [`# Brief`, '']
    if (briefContent.problem) sections.push(`## Problem`, briefContent.problem, '')
    if (briefContent.target_users) sections.push(`## Target users`, briefContent.target_users, '')
    if (briefContent.features?.length) {
      sections.push(`## Features`, ...briefContent.features.map((f) => `- ${f}`), '')
    }
    if (briefContent.constraints) sections.push(`## Constraints`, briefContent.constraints, '')
    if (briefContent.additional_context) sections.push(`## Additional context`, briefContent.additional_context, '')
    if (briefContent.decisions?.length) {
      sections.push(`## Decisions`, ...briefContent.decisions.map((d) => `- **${d.topic}:** ${d.decision}`), '')
    }
    return sections.join('\n')
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-semibold text-brand-slate uppercase tracking-wide">Brief</h2>
          {brief && <span className="text-xs text-gray-400">v{brief.version}</span>}
        </div>
        {hasBrief && (
          <button
            onClick={async () => {
              await navigator.clipboard.writeText(formatBrief())
              setBriefCopied(true)
              setTimeout(() => setBriefCopied(false), 2000)
            }}
            className="flex items-center gap-1.5 text-xs text-gray-500 hover:text-brand-navy"
          >
            {briefCopied ? <Check className="h-3.5 w-3.5 text-green-500" /> : <Copy className="h-3.5 w-3.5" />}
            {briefCopied ? 'Copied!' : 'Copy markdown'}
          </button>
        )}
      </div>

      {/* Generate / Import controls */}
      <Card hover={false}>
        <CardBody>
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <LoadingButton
                variant="primary"
                size="sm"
                loading={loadingPayload}
                loadingText="Loading..."
                onClick={handleCopyPayload}
                icon={ClipboardCopy}
              >
                {payloadCopied ? 'Copied!' : 'Copy next-convo prep'}
              </LoadingButton>
              <LoadingButton
                variant="ghost"
                size="sm"
                loading={generating}
                loadingText="Generating..."
                onClick={handleGenerate}
                icon={Sparkles}
              >
                {hasBrief ? 'Regenerate via API' : 'Generate via API'}
              </LoadingButton>
            </div>
            <p className="text-xs text-gray-500">
              Copy the next-convo prep, paste into Claude to discuss strategy, then ask for output and paste the JSON below.
            </p>
            <div className="space-y-2">
              <textarea
                value={pasteJson}
                onChange={(e) => { setPasteJson(e.target.value); setPasteError(null) }}
                placeholder='Paste the "next-convo" JSON here (full payload with brief + agent config, or brief-only)...'
                rows={10}
                className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm font-mono focus:outline-none focus:ring-2 focus:ring-brand-navy focus:border-brand-navy"
              />
              {pasteError && <StatusMessage type="error" message={pasteError} />}
              <LoadingButton
                variant="primary"
                size="sm"
                loading={updateBrief.isPending}
                loadingText="Importing..."
                disabled={!pasteJson.trim()}
                onClick={handleImportJson}
                icon={Upload}
              >
                Import JSON
              </LoadingButton>
            </div>
          </div>
        </CardBody>
      </Card>

      {!hasBrief ? (
        <EmptyState
          icon={FileText}
          title="No brief yet"
          description="Copy the prompt for Claude and paste the response above, or use Generate via API."
        />
      ) : (
        <BriefView content={briefContent!} />
      )}
    </div>
  )
}

function BriefView({ content }: { content: BriefContent }) {
  const sections = [
    { label: 'Problem', value: content.problem },
    { label: 'Target users', value: content.target_users },
    { label: 'Features', value: content.features?.length > 0 ? content.features : null },
    { label: 'Constraints', value: content.constraints },
    { label: 'Additional context', value: content.additional_context },
  ]

  const decisions = content.decisions || []
  const openRisks = content.open_risks || []

  return (
    <div className="space-y-4">
      {sections.map((section) => {
        if (!section.value || (Array.isArray(section.value) && section.value.length === 0)) return null
        return (
          <Card key={section.label} hover={false}>
            <CardBody>
              <h3 className="text-sm font-semibold text-brand-slate uppercase tracking-wide mb-2">
                {section.label}
              </h3>
              {Array.isArray(section.value) ? (
                <ul className="list-disc list-inside space-y-1">
                  {section.value.map((item, i) => (
                    <li key={i} className="text-gray-800 text-sm">{item}</li>
                  ))}
                </ul>
              ) : (
                <p className="text-gray-800 text-sm leading-relaxed">{section.value}</p>
              )}
            </CardBody>
          </Card>
        )
      })}

      {decisions.length > 0 && (
        <Card hover={false}>
          <CardBody>
            <h3 className="text-sm font-semibold text-brand-slate uppercase tracking-wide mb-2">
              Decisions
            </h3>
            <ul className="space-y-2">
              {decisions.map((d, i) => (
                <li key={i} className="text-sm">
                  <span className="font-medium text-gray-900">{d.topic}:</span>{' '}
                  <span className="text-gray-700">{d.decision}</span>
                </li>
              ))}
            </ul>
          </CardBody>
        </Card>
      )}

      {openRisks.length > 0 && (
        <Card hover={false}>
          <CardBody>
            <h3 className="text-sm font-semibold text-brand-slate uppercase tracking-wide mb-2">
              Open risks
            </h3>
            <ul className="list-disc list-inside space-y-1">
              {openRisks.map((risk, i) => (
                <li key={i} className="text-gray-800 text-sm">{risk}</li>
              ))}
            </ul>
          </CardBody>
        </Card>
      )}
    </div>
  )
}

// --- Next Conversation Tab ---

function NextConversationTab({
  project,
  projectId,
  sessions,
  activeSession,
  onShare,
  justImported = false,
  onImportedConsumed,
}: {
  project: Project
  projectId: string
  sessions: Session[]
  activeSession: Session | null
  onShare: () => void
  justImported?: boolean
  onImportedConsumed?: () => void
}) {
  const { data: activeMessages } = useMessages(activeSession?.id)
  const hasUserMessages = activeMessages?.some((m) => m.role === 'user') ?? false

  // Capture the import signal at mount so it survives the parent resetting the
  // one-shot flag, then clear it. Drives the confirmation banner + auto-expanded
  // prep section so a JSON import lands the builder on the next step (#25).
  const [arrivedFromImport] = useState(justImported)
  useEffect(() => {
    if (justImported) onImportedConsumed?.()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // First-conversation banner — project is configured but maker hasn't chatted yet
  const isFirstSetup = !!project.requester_email && !!activeSession && !hasUserMessages

  const setupSummary = (() => {
    if (!isFirstSetup) return null
    const chips: string[] = []
    if (project.brief_version) chips.push('brief seeded')
    const qCount = project.seed_questions?.length ?? 0
    if (qCount > 0) chips.push(`${qCount} seed question${qCount > 1 ? 's' : ''}`)
    const dCount = project.builder_directives?.length ?? 0
    if (dCount > 0) chips.push(`${dCount} directive${dCount > 1 ? 's' : ''}`)
    if (project.welcome_message) chips.push('welcome message')
    return chips
  })()

  return (
    <div className="space-y-6">
      {/* Post-import confirmation — the brief was just updated from a paste (#25) */}
      {arrivedFromImport && (
        <Card hover={false}>
          <CardBody>
            <p className="text-sm text-green-700 flex items-center gap-1.5">
              <Check className="h-4 w-4 shrink-0" />
              Brief updated. Review the setup, then prep and send the next conversation below.
            </p>
          </CardBody>
        </Card>
      )}

      {/* First-conversation banner */}
      {isFirstSetup && (
        <Card hover={false}>
          <CardBody>
            <h2 className="text-sm font-semibold text-green-700 uppercase tracking-wide flex items-center gap-1.5 mb-2">
              <Check className="h-4 w-4" />
              Project ready
            </h2>
            {setupSummary && setupSummary.length > 0 && (
              <p className="text-xs text-gray-500 mb-3">{setupSummary.join(' · ')}</p>
            )}
            <p className="text-sm text-gray-600 mb-4">
              Review the setup below, then share with the maker to start the conversation.
            </p>
            <LoadingButton variant="primary" icon={Share2} onClick={onShare}>
              Share with maker
            </LoadingButton>
          </CardBody>
        </Card>
      )}

      {/* People on this brief — roster + per-person brief_role (3c) */}
      {project.requester_email && <PeoplePanel project={project} onInvite={onShare} />}

      {/* Editable setup — shown when active conversation has no maker messages yet */}
      {!(activeSession && hasUserMessages) && (
        <EditableSetup project={project} />
      )}

      {/* Prep next conversation, re-nudge, or prompt to share */}
      {!project.requester_email ? (
        <Card hover={false}>
          <CardBody>
            <h2 className="text-sm font-semibold text-brand-slate uppercase tracking-wide flex items-center gap-1.5 mb-3">
              <Share2 className="h-4 w-4" />
              Invite a maker
            </h2>
            <p className="text-sm text-gray-600 mb-4">
              Share this project with a maker to start the first conversation. You&apos;ll get a link and passcode to send them.
            </p>
            <LoadingButton variant="primary" icon={Share2} onClick={onShare}>
              Share project
            </LoadingButton>
          </CardBody>
        </Card>
      ) : activeSession && !hasUserMessages ? (
        <RenudgeCard project={project} projectId={projectId} />
      ) : (
        <PrepNextSession
          project={project}
          projectId={projectId}
          sessionNumber={sessions.length + 1}
          autoExpand={arrivedFromImport}
        />
      )}
    </div>
  )
}

function ShareModal({ project, onClose }: { project: Project; onClose: () => void }) {
  const [email, setEmail] = useState(project.requester_email || '')
  const [firstName, setFirstName] = useState(project.requester_first_name || '')
  const [lastName, setLastName] = useState(project.requester_last_name || '')
  // Who this person is on the brief. Originator = the primary requester (default,
  // preserves existing behavior); Contributor = a second human who also chats
  // with Sam in the same brief. Both keep `maker` access so they can chat.
  const [briefRole, setBriefRole] = useState<'originator' | 'contributor'>('originator')
  const [linkCopied, setLinkCopied] = useState(false)
  const [passcodeCopied, setPasscodeCopied] = useState(false)
  const [emailCopied, setEmailCopied] = useState(false)
  const [editingName, setEditingName] = useState(false)
  const [editFirstName, setEditFirstName] = useState(project.requester_first_name || '')
  const [editLastName, setEditLastName] = useState(project.requester_last_name || '')
  const shareProject = useShareProject()
  const updateProject = useUpdateProject()
  const alreadyShared = !!project.requester_email
  const { data: fetchedPasscode } = useProjectPasscode(alreadyShared ? project.id : undefined)
  const resetPasscode = useResetPasscode()

  const passcode = shareProject.data?.passcode || fetchedPasscode || null

  const shareLink = getProjectShareLink(project.slug, project.id)

  const handleShare = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!email.trim()) return
    await shareProject.mutateAsync({
      project_id: project.id,
      email: email.trim(),
      first_name: firstName.trim() || undefined,
      last_name: lastName.trim() || undefined,
      brief_role: briefRole,
    })
  }

  const handleResetPasscode = async () => {
    const result = await resetPasscode.mutateAsync(project.id)
    void result
  }

  const sharedEmail = alreadyShared ? project.requester_email! : email

  const inviteEmailBody = copy.invite.body({ projectTitle: project.title, shareLink, email: sharedEmail, passcode })

  return (
    <Modal isOpen onClose={onClose} title="Share with maker">
      {alreadyShared || shareProject.isSuccess ? (
        <div className="space-y-3">
          <div className="p-3 bg-green-50 border border-green-200 rounded-lg">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-green-800">Shared with {sharedEmail}</p>
                {!editingName && (editFirstName || editLastName) && (
                  <p className="text-xs text-green-700 mt-0.5">{[editFirstName, editLastName].filter(Boolean).join(' ')}</p>
                )}
              </div>
              {!editingName && (
                <button onClick={() => setEditingName(true)} className="text-xs text-green-700 hover:text-green-900 underline">
                  Edit name
                </button>
              )}
            </div>
            {editingName && (
              <div className="mt-2 flex items-center gap-2">
                <input
                  type="text"
                  value={editFirstName}
                  onChange={(e) => setEditFirstName(e.target.value)}
                  placeholder="First name"
                  className="flex-1 px-2 py-1 border border-green-300 rounded text-sm focus:outline-none focus:ring-1 focus:ring-brand-navy"
                  autoFocus
                />
                <input
                  type="text"
                  value={editLastName}
                  onChange={(e) => setEditLastName(e.target.value)}
                  placeholder="Last name"
                  className="flex-1 px-2 py-1 border border-green-300 rounded text-sm focus:outline-none focus:ring-1 focus:ring-brand-navy"
                />
                <LoadingButton
                  variant="ghost"
                  size="sm"
                  loading={updateProject.isPending}
                  onClick={async () => {
                    await updateProject.mutateAsync({
                      project_id: project.id,
                      requester_first_name: editFirstName.trim() || '',
                      requester_last_name: editLastName.trim() || '',
                    })
                    setEditingName(false)
                  }}
                >
                  Save
                </LoadingButton>
                <button onClick={() => setEditingName(false)} className="text-xs text-gray-500 hover:text-gray-700">
                  Cancel
                </button>
              </div>
            )}
          </div>
          <div>
            <p className="text-xs text-gray-600 mb-1">Brief link</p>
            <div className="flex items-center gap-2">
              <input type="text" readOnly value={shareLink} className="flex-1 px-2.5 py-1.5 bg-gray-50 border border-gray-300 rounded-md text-sm text-gray-700" />
              <button onClick={async () => { await navigator.clipboard.writeText(shareLink); setLinkCopied(true); setTimeout(() => setLinkCopied(false), 2000) }} className="p-1.5 text-gray-500 hover:text-brand-navy hover:bg-gray-100 rounded">
                {linkCopied ? <Check className="h-4 w-4 text-green-500" /> : <Copy className="h-4 w-4" />}
              </button>
            </div>
          </div>
          {passcode && (
            <div>
              <p className="text-xs text-gray-600 mb-1 flex items-center gap-1"><Lock className="h-3.5 w-3.5" /> Maker passcode</p>
              <div className="flex items-center gap-2">
                <code className="flex-1 px-2.5 py-1.5 bg-gray-50 border border-gray-300 rounded-md text-lg tracking-widest font-mono text-brand-charcoal">{passcode}</code>
                <button onClick={async () => { await navigator.clipboard.writeText(passcode); setPasscodeCopied(true); setTimeout(() => setPasscodeCopied(false), 2000) }} className="p-1.5 text-gray-500 hover:text-brand-navy hover:bg-gray-100 rounded">
                  {passcodeCopied ? <Check className="h-4 w-4 text-green-500" /> : <Copy className="h-4 w-4" />}
                </button>
                <button onClick={handleResetPasscode} disabled={resetPasscode.isPending} className="p-1.5 text-gray-500 hover:text-brand-navy hover:bg-gray-100 rounded" title="Reset passcode">
                  <RotateCw className={`h-4 w-4 ${resetPasscode.isPending ? 'animate-spin' : ''}`} />
                </button>
              </div>
              <p className="text-xs text-gray-500 mt-1">Share this passcode with the maker so they can sign in</p>
            </div>
          )}
          <div>
            <p className="text-xs text-gray-600 mb-1 flex items-center gap-1"><Mail className="h-3.5 w-3.5" /> Invite message</p>
            <textarea readOnly value={inviteEmailBody} rows={8} className="w-full px-2.5 py-1.5 bg-gray-50 border border-gray-300 rounded-md text-sm text-gray-700 resize-none" />
            <div className="mt-1 flex items-center gap-4">
              <SendToMakerButton projectId={project.id} kind="invite" makerEmail={sharedEmail} idleLabel={`Send to ${sharedEmail}`} />
              <button onClick={async () => { await navigator.clipboard.writeText(inviteEmailBody); setEmailCopied(true); setTimeout(() => setEmailCopied(false), 2000) }} className="flex items-center gap-1.5 text-xs text-gray-500 hover:text-brand-navy">
                {emailCopied ? <Check className="h-3.5 w-3.5 text-green-500" /> : <Copy className="h-3.5 w-3.5" />}
                {emailCopied ? 'Copied!' : 'Copy message'}
              </button>
            </div>
          </div>
          <div className="flex justify-end">
            <button onClick={onClose} className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800">Done</button>
          </div>
        </div>
      ) : (
        <form onSubmit={handleShare} className="space-y-3">
          <div className="flex gap-2">
            <input
              type="text"
              value={firstName}
              onChange={(e) => setFirstName(e.target.value)}
              placeholder="First name"
              className="flex-1 px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-brand-navy focus:border-brand-navy"
              autoFocus
            />
            <input
              type="text"
              value={lastName}
              onChange={(e) => setLastName(e.target.value)}
              placeholder="Last name"
              className="flex-1 px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-brand-navy focus:border-brand-navy"
            />
          </div>
          <div>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="maker@email.com"
              className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-brand-navy focus:border-brand-navy"
            />
          </div>
          <div>
            <label className="block text-xs text-gray-600 mb-1">Role on this brief</label>
            <select
              value={briefRole}
              onChange={(e) => setBriefRole(e.target.value as 'originator' | 'contributor')}
              className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-brand-navy focus:border-brand-navy"
            >
              <option value="originator">{briefRoleLabel('originator')} — the person whose idea this is</option>
              <option value="contributor">{briefRoleLabel('contributor')} — a second person who also chats with {copy.chat.agentLabel}</option>
            </select>
          </div>
          {shareProject.error && <StatusMessage type="error" message={shareProject.error.message} />}
          <div className="flex justify-end gap-2">
            <button type="button" onClick={onClose} className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800">Cancel</button>
            <LoadingButton type="submit" variant="primary" loading={shareProject.isPending} loadingText="Sharing..." disabled={!email.trim()} icon={Share2}>
              Share
            </LoadingButton>
          </div>
        </form>
      )}
      {resetPasscode.error && <StatusMessage type="error" message={resetPasscode.error.message} />}
    </Modal>
  )
}

// People on this brief: lists members with their access tier + an editable
// brief_role for chat participants (Originator/Contributor/Reviewer). Console
// operators (owner/builder) operate in a reviewing capacity — shown read-only.
function PeoplePanel({ project, onInvite }: { project: Project; onInvite: () => void }) {
  const { data: members, isLoading, error } = useProjectMembers(project.id)
  const setBriefRole = useSetBriefRole(project.id)
  const [pendingEmail, setPendingEmail] = useState<string | null>(null)

  return (
    <Card hover={false}>
      <CardBody>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold text-brand-slate uppercase tracking-wide flex items-center gap-1.5">
            <Users className="h-4 w-4" /> People on this brief
          </h2>
          <button onClick={onInvite} className="text-xs text-brand-navy hover:underline flex items-center gap-1">
            <Plus className="h-3.5 w-3.5" /> Invite
          </button>
        </div>

        {isLoading && <Skeleton className="h-12 w-full" />}
        {error && <StatusMessage type="error" message={(error as Error).message} />}
        {members && members.length === 0 && (
          <p className="text-sm text-gray-500">No one yet. Invite someone to start the brief.</p>
        )}

        <ul className="divide-y divide-gray-100">
          {members?.map((m) => {
            const isConsole = m.role === 'owner' || m.role === 'builder'
            return (
              <li key={m.id} className="flex items-center justify-between gap-3 py-2">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-brand-charcoal truncate">{m.display_name}</p>
                  <p className="text-xs text-gray-500 truncate">{m.email}</p>
                </div>
                {isConsole ? (
                  <span className="text-xs text-gray-400 shrink-0" title={briefRoleShort('reviewer')}>
                    {briefRoleLabel('reviewer')}
                  </span>
                ) : (
                  <select
                    value={m.brief_role ?? 'originator'}
                    disabled={setBriefRole.isPending && pendingEmail === m.email}
                    onChange={async (e) => {
                      const value = e.target.value
                      setPendingEmail(m.email)
                      try {
                        await setBriefRole.mutateAsync({ email: m.email, brief_role: value })
                      } finally {
                        setPendingEmail(null)
                      }
                    }}
                    className="shrink-0 px-2 py-1 border border-gray-300 rounded-md text-xs focus:outline-none focus:ring-1 focus:ring-brand-navy"
                  >
                    <option value="originator">{briefRoleLabel('originator')}</option>
                    <option value="contributor">{briefRoleLabel('contributor')}</option>
                    <option value="reviewer">{briefRoleLabel('reviewer')}</option>
                  </select>
                )}
              </li>
            )
          })}
        </ul>
        {setBriefRole.error && <StatusMessage type="error" message={(setBriefRole.error as Error).message} />}
      </CardBody>
    </Card>
  )
}

function EditableSetup({ project }: { project: Project }) {
  const [welcomeMessage, setWelcomeMessage] = useState(project.welcome_message || '')
  const [seedQuestions, setSeedQuestions] = useState<string[]>(project.seed_questions || [])
  const [newQuestion, setNewQuestion] = useState('')
  const [sessionMode, setSessionMode] = useState<'discover' | 'converge'>(project.session_mode || 'discover')
  const [directives, setDirectives] = useState<string[]>(project.builder_directives || [])
  const [newDirective, setNewDirective] = useState('')
  const [mockups, setMockups] = useState<WireframeMockup[]>(project.layout_mockups || [])
  const [identity, setIdentity] = useState(project.identity || '')
  const [nudgeMessageOverride, setNudgeMessageOverride] = useState(project.nudge_message || '')
  const [autoReminders, setAutoReminders] = useState(project.auto_reminders_enabled === true)
  const [githubRepo, setGithubRepo] = useState(project.github_repo || '')
  const [saved, setSaved] = useState(false)

  const updateProject = useUpdateProject()
  const generateWelcome = useGenerateWelcome()

  useEffect(() => {
    setWelcomeMessage(project.welcome_message || '')
    setSeedQuestions(project.seed_questions || [])
    setSessionMode(project.session_mode || 'discover')
    setDirectives(project.builder_directives || [])
    setMockups(project.layout_mockups || [])
    setIdentity(project.identity || '')
    setNudgeMessageOverride(project.nudge_message || '')
    setAutoReminders(project.auto_reminders_enabled === true)
    setGithubRepo(project.github_repo || '')
  }, [project.welcome_message, project.seed_questions, project.session_mode, project.builder_directives, project.layout_mockups, project.identity, project.nudge_message, project.auto_reminders_enabled, project.github_repo])

  const handleSave = async () => {
    await updateProject.mutateAsync({
      project_id: project.id,
      welcome_message: welcomeMessage,
      seed_questions: seedQuestions,
      session_mode: sessionMode,
      builder_directives: directives,
      layout_mockups: mockups,
      identity: identity || undefined,
      nudge_message: nudgeMessageOverride || undefined,
      auto_reminders_enabled: autoReminders,
      github_repo: githubRepo.trim() || undefined,
      last_builder_activity_at: new Date().toISOString(),
    })
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  return (
    <Card hover={false}>
      <CardBody>
        <h2 className="text-sm font-semibold text-brand-slate uppercase tracking-wide flex items-center gap-1.5 mb-4">
          <Settings className="h-4 w-4" />
          Agent setup
        </h2>
        <div className="space-y-5">
          {/* Opening message */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-sm font-medium text-gray-700">Opening message</label>
              <LoadingButton variant="ghost" size="sm" loading={generateWelcome.isPending} loadingText="Generating..." onClick={async () => { const r = await generateWelcome.mutateAsync(project.id); setWelcomeMessage(r.welcome_message) }} icon={Sparkles}>
                {welcomeMessage ? 'Regenerate' : 'Generate'}
              </LoadingButton>
            </div>
            <textarea value={welcomeMessage} onChange={(e) => setWelcomeMessage(e.target.value)} placeholder="The message the agent sends when the maker opens this conversation." rows={4} className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-brand-navy focus:border-brand-navy" />
          </div>

          {/* Mode */}
          <SessionModeToggle mode={sessionMode} onChange={setSessionMode} />

          {/* Seed questions / directives */}
          {sessionMode === 'discover' ? (
            <ListEditor label="Seed questions" description="Questions the agent should weave into the conversation early on." items={seedQuestions} newItem={newQuestion} onNewItemChange={setNewQuestion} onAdd={() => { if (!newQuestion.trim()) return; setSeedQuestions(p => [...p, newQuestion.trim()]); setNewQuestion('') }} onBulkAdd={(bulk) => setSeedQuestions(p => [...p, ...bulk])} onRemove={(i) => setSeedQuestions(p => p.filter((_, idx) => idx !== i))} placeholder="What does a typical day look like for you?" />
          ) : (
            <ListEditor label="Builder directives" description="Things the agent should actively drive toward." items={directives} newItem={newDirective} onNewItemChange={setNewDirective} onAdd={() => { if (!newDirective.trim()) return; setDirectives(p => [...p, newDirective.trim()]); setNewDirective('') }} onBulkAdd={(bulk) => setDirectives(p => [...p, ...bulk])} onRemove={(i) => setDirectives(p => p.filter((_, idx) => idx !== i))} placeholder="Get them to pick 1-2 tickers to start with" />
          )}

          {/* Layout mockups */}
          <MockupEditor mockups={mockups} onUpdate={setMockups} />

          {/* Agent identity */}
          <div>
            <label className="text-sm font-medium text-gray-700 block mb-1.5">Agent identity (optional)</label>
            <textarea value={identity} onChange={(e) => setIdentity(e.target.value)} placeholder="Override the default agent persona. Leave blank for standard intake assistant." rows={2} className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-brand-navy focus:border-brand-navy" />
            <p className="text-xs text-gray-400 mt-1">Changes how the agent introduces itself and frames its role.</p>
          </div>

          {/* Nudge override */}
          <div>
            <label className="text-sm font-medium text-gray-700 block mb-1.5">Nudge override (optional)</label>
            <textarea value={nudgeMessageOverride} onChange={(e) => setNudgeMessageOverride(e.target.value)} placeholder="Leave blank to use the default boilerplate nudge. Fill this in to send a specific message verbatim." rows={3} className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-brand-navy focus:border-brand-navy" />
            <p className="text-xs text-gray-400 mt-1">When set, the next nudge uses this text verbatim instead of the default template.</p>
          </div>

          {/* Auto-reminders */}
          <label className="flex items-start gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={autoReminders}
              onChange={(e) => setAutoReminders(e.target.checked)}
              className="mt-0.5 h-4 w-4 rounded border-gray-300 text-brand-navy focus:ring-brand-navy"
            />
            <div>
              <div className="text-sm font-medium text-gray-700">Auto-remind the maker if they don&apos;t respond</div>
              <p className="text-xs text-gray-400">Sends up to 3 reminder emails on a 2 / 5 / 10 day cadence after a new conversation is ready. Stops the moment the maker replies.</p>
            </div>
          </label>

          {/* GitHub repo — destination for "Convert to GitHub issue" in the feedback inbox */}
          <div>
            <label className="text-sm font-medium text-gray-700 block mb-1.5">GitHub repo (optional)</label>
            <input
              type="text"
              value={githubRepo}
              onChange={(e) => setGithubRepo(e.target.value)}
              placeholder="owner/name — e.g. nicolovejoy/prntd"
              className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-brand-navy focus:border-brand-navy"
            />
            <p className="text-xs text-gray-400 mt-1">Where feedback gets sent when you click &quot;Convert to GitHub issue&quot;. The server&apos;s GITHUB_TOKEN must have access to this repo.</p>
          </div>

          <div className="flex items-center gap-2 pt-2 border-t border-gray-100">
            <LoadingButton variant="secondary" size="sm" loading={updateProject.isPending} loadingText="Saving..." onClick={handleSave}>
              {saved ? 'Saved!' : 'Save setup'}
            </LoadingButton>
            {updateProject.error && <span className="text-xs text-red-500">{updateProject.error.message}</span>}
          </div>
        </div>
      </CardBody>
    </Card>
  )
}

// Builder-clicks-Send button: emails the maker directly via Resend. Opens a
// confirmation Modal (recipient shown, a real Send button with a spinner) so a
// real email never fires on one stray click and the pending/done state is
// obvious. Reused for invite / nudge / reminder.
function SendToMakerButton({
  projectId,
  kind,
  makerEmail,
  note,
  idleLabel,
}: {
  projectId: string
  kind: 'invite' | 'nudge' | 'reminder'
  makerEmail: string
  note?: string
  idleLabel: string
}) {
  const sendEmail = useSendMakerEmail()
  const [open, setOpen] = useState(false)
  const [sentTo, setSentTo] = useState<string | null>(null)

  if (sentTo) {
    return (
      <span className="flex items-center gap-1.5 text-xs text-green-600 font-medium">
        <Check className="h-3.5 w-3.5" /> Sent to {sentTo}
      </span>
    )
  }

  const kindLabel =
    kind === 'invite' ? 'invitation' : kind === 'reminder' ? 'reminder' : 'new-conversation message'

  return (
    <>
      <button
        onClick={() => {
          sendEmail.reset()
          setOpen(true)
        }}
        disabled={!makerEmail}
        title={makerEmail ? undefined : 'No maker email on this brief'}
        className="flex items-center gap-1.5 text-xs font-medium text-brand-navy hover:underline disabled:opacity-40 disabled:no-underline"
      >
        <Send className="h-3.5 w-3.5" />
        {idleLabel}
      </button>

      <Modal
        isOpen={open}
        onClose={() => {
          if (!sendEmail.isPending) setOpen(false)
        }}
        title="Send this email now?"
        size="sm"
      >
        <div className="space-y-4">
          <p className="text-sm text-gray-600">
            This sends the {kindLabel} email to{' '}
            <span className="font-medium text-gray-900">{makerEmail}</span> right now. Their replies
            come back to you.
          </p>
          {sendEmail.isError && <StatusMessage type="error" message={sendEmail.error.message} />}
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setOpen(false)}
              disabled={sendEmail.isPending}
              className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800 disabled:opacity-50"
            >
              Cancel
            </button>
            <LoadingButton
              variant="primary"
              loading={sendEmail.isPending}
              loadingText="Sending…"
              icon={Send}
              onClick={async () => {
                try {
                  const r = await sendEmail.mutateAsync({ project_id: projectId, kind, note })
                  setSentTo(r.to)
                  setOpen(false)
                } catch {
                  // Error surfaced in the modal via sendEmail.isError; keep it open.
                }
              }}
            >
              Send to {makerEmail}
            </LoadingButton>
          </div>
        </div>
      </Modal>
    </>
  )
}

function RenudgeCard({ project, projectId }: { project: Project; projectId: string }) {
  const { copied, copyNudge } = useNudgeCopy(projectId)

  const shareLink = getProjectShareLink(project.slug, projectId)
  const reminderMessage = copy.nudge.reminder({ projectTitle: project.title, shareLink })
  const makerName = getMakerShortName(project.requester_first_name, project.requester_email)

  return (
    <Card hover={false}>
      <CardBody>
        <h2 className="text-sm font-semibold text-brand-slate uppercase tracking-wide flex items-center gap-1.5 mb-3">
          <Mail className="h-4 w-4" />
          Waiting on {makerName}
        </h2>
        <p className="text-sm text-gray-600 mb-3">
          {makerName} hasn&apos;t responded yet. Send a reminder:
        </p>
        <textarea readOnly value={reminderMessage} rows={3} className="w-full px-2.5 py-1.5 bg-gray-50 border border-gray-300 rounded-md text-sm text-gray-700 resize-none mb-2" />
        <div className="flex items-center gap-4">
          <SendToMakerButton projectId={projectId} kind="reminder" makerEmail={project.requester_email || ''} idleLabel="Send reminder" />
          <button
            onClick={() => copyNudge(reminderMessage)}
            className="flex items-center gap-1.5 text-xs text-gray-500 hover:text-brand-navy"
          >
            {copied ? <Check className="h-3.5 w-3.5 text-green-500" /> : <Copy className="h-3.5 w-3.5" />}
            {copied ? 'Copied!' : 'Copy reminder'}
          </button>
        </div>
      </CardBody>
    </Card>
  )
}

function PrepNextSession({ project, projectId, sessionNumber, autoExpand = false }: {
  project: Project
  projectId: string
  sessionNumber: number
  autoExpand?: boolean
}) {
  const [expanded, setExpanded] = useState(autoExpand)
  const [sessionMode, setSessionMode] = useState<'discover' | 'converge'>(project.session_mode || 'discover')
  const [welcomeMessage, setWelcomeMessage] = useState(project.welcome_message || '')
  const [seedQuestions, setSeedQuestions] = useState<string[]>(project.seed_questions || [])
  const [newQuestion, setNewQuestion] = useState('')
  const [directives, setDirectives] = useState<string[]>(project.builder_directives || [])
  const [newDirective, setNewDirective] = useState('')
  const [mockups, setMockups] = useState<WireframeMockup[]>(project.layout_mockups || [])
  const [identity, setIdentity] = useState(project.identity || '')
  const [nudgeMessageOverride, setNudgeMessageOverride] = useState(project.nudge_message || '')
  const [nudgeNote, setNudgeNote] = useState('')
  const [created, setCreated] = useState(false)

  const updateProject = useUpdateProject()
  const generateWelcome = useGenerateWelcome()
  const createSession = useCreateSession()
  const { copied: nudgeCopied, copyNudge } = useNudgeCopy(projectId)

  const shareLink = getProjectShareLink(project.slug, projectId)
  const makerEmail = project.requester_email || ''

  useEffect(() => {
    setWelcomeMessage(project.welcome_message || '')
    setSeedQuestions(project.seed_questions || [])
    setSessionMode(project.session_mode || 'discover')
    setDirectives(project.builder_directives || [])
    setMockups(project.layout_mockups || [])
    setIdentity(project.identity || '')
    setNudgeMessageOverride(project.nudge_message || '')
  }, [project.welcome_message, project.seed_questions, project.session_mode, project.builder_directives, project.layout_mockups, project.identity, project.nudge_message])

  const handleCreate = async () => {
    await updateProject.mutateAsync({
      project_id: project.id,
      welcome_message: welcomeMessage,
      seed_questions: seedQuestions,
      session_mode: sessionMode,
      builder_directives: directives,
      layout_mockups: mockups,
      identity: identity || undefined,
      nudge_message: nudgeMessageOverride || undefined,
      last_builder_activity_at: new Date().toISOString(),
    })
    await createSession.mutateAsync({ project_id: projectId })
    setCreated(true)
  }

  const override = nudgeMessageOverride.trim()
  const nudgeMessage = override
    ? [override, '', shareLink].join('\n')
    : copy.nudge.body({
        projectTitle: project.title,
        shareLink,
        note: nudgeNote || undefined,
        sessionMode,
      })

  if (created) {
    return (
      <Card hover={false}>
        <CardBody>
          <h2 className="text-sm font-semibold text-brand-slate uppercase tracking-wide flex items-center gap-1.5 mb-3">
            <Check className="h-4 w-4 text-green-600" />
            Session {sessionNumber} ready
          </h2>
          <div className="space-y-3 p-3 bg-green-50 border border-green-200 rounded-lg">
            <p className="text-sm font-medium text-green-800">New session created. Send {makerEmail} this message:</p>
            <textarea readOnly value={nudgeMessage} rows={6} className="w-full px-2.5 py-1.5 bg-white border border-gray-300 rounded-md text-sm text-gray-700 resize-none" />
            <div className="flex items-center gap-4">
              <SendToMakerButton projectId={projectId} kind="nudge" makerEmail={makerEmail} note={nudgeNote || undefined} idleLabel={makerEmail ? `Send to ${makerEmail}` : 'Send to maker'} />
              <button
                onClick={() => copyNudge(nudgeMessage)}
                className="flex items-center gap-1.5 text-xs text-gray-500 hover:text-brand-navy"
              >
                {nudgeCopied ? <Check className="h-3.5 w-3.5 text-green-500" /> : <Copy className="h-3.5 w-3.5" />}
                {nudgeCopied ? 'Copied!' : 'Copy message'}
              </button>
            </div>
          </div>
        </CardBody>
      </Card>
    )
  }

  return (
    <Card hover={false}>
      <CardBody>
        <button onClick={() => setExpanded(!expanded)} className="w-full flex items-center justify-between">
          <h2 className="text-sm font-semibold text-brand-slate uppercase tracking-wide flex items-center gap-1.5">
            <RotateCw className="h-4 w-4" />
            Prep conversation {sessionNumber}
          </h2>
          {expanded ? <ChevronUp className="h-4 w-4 text-gray-400" /> : <ChevronDown className="h-4 w-4 text-gray-400" />}
        </button>

        {expanded && (
          <div className="mt-4 space-y-5">
            <SessionModeToggle mode={sessionMode} onChange={setSessionMode} />

            {sessionMode === 'discover' ? (
              <ListEditor label="Seed questions" description="Questions the agent should weave into the conversation early on." items={seedQuestions} newItem={newQuestion} onNewItemChange={setNewQuestion} onAdd={() => { if (!newQuestion.trim()) return; setSeedQuestions(p => [...p, newQuestion.trim()]); setNewQuestion('') }} onBulkAdd={(bulk) => setSeedQuestions(p => [...p, ...bulk])} onRemove={(i) => setSeedQuestions(p => p.filter((_, idx) => idx !== i))} placeholder="What does a typical day look like for you?" />
            ) : (
              <ListEditor label="Builder directives" description="Things the agent should actively drive toward." items={directives} newItem={newDirective} onNewItemChange={setNewDirective} onAdd={() => { if (!newDirective.trim()) return; setDirectives(p => [...p, newDirective.trim()]); setNewDirective('') }} onBulkAdd={(bulk) => setDirectives(p => [...p, ...bulk])} onRemove={(i) => setDirectives(p => p.filter((_, idx) => idx !== i))} placeholder="Get them to pick 1-2 tickers to start with" />
            )}

            {/* Layout mockups */}
            <MockupEditor mockups={mockups} onUpdate={setMockups} />

            {/* Agent identity */}
            <div>
              <label className="text-sm font-medium text-gray-700 block mb-1.5">Agent identity (optional)</label>
              <textarea value={identity} onChange={(e) => setIdentity(e.target.value)} placeholder="Override the default agent persona. Leave blank for standard intake assistant." rows={2} className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-brand-navy focus:border-brand-navy" />
              <p className="text-xs text-gray-400 mt-1">Changes how the agent introduces itself and frames its role.</p>
            </div>

            {/* Opening message */}
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="text-sm font-medium text-gray-700">Opening message</label>
                <LoadingButton variant="ghost" size="sm" loading={generateWelcome.isPending} loadingText="Generating..." onClick={async () => { const r = await generateWelcome.mutateAsync(project.id); setWelcomeMessage(r.welcome_message) }} icon={Sparkles}>
                  {welcomeMessage ? 'Regenerate' : 'Generate'}
                </LoadingButton>
              </div>
              <textarea value={welcomeMessage} onChange={(e) => setWelcomeMessage(e.target.value)} placeholder="The message the agent sends when the maker opens this conversation." rows={3} className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-brand-navy focus:border-brand-navy" />
            </div>

            {/* Nudge + create */}
            <div className="pt-3 border-t border-gray-100 space-y-3">
              <div>
                <label className="text-sm font-medium text-gray-700 block mb-1.5">Note for {makerEmail} (optional)</label>
                <textarea value={nudgeNote} onChange={(e) => setNudgeNote(e.target.value)} placeholder="This time we'll narrow down which data sources to use." rows={2} className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-brand-navy focus:border-brand-navy" />
                <p className="text-xs text-gray-400 mt-1">A short hook woven into the boilerplate nudge. Ignored if you fill in the override below.</p>
              </div>
              <div>
                <label className="text-sm font-medium text-gray-700 block mb-1.5">Nudge override (optional)</label>
                <textarea value={nudgeMessageOverride} onChange={(e) => setNudgeMessageOverride(e.target.value)} placeholder="Leave blank to use the boilerplate nudge. Fill this in to send a specific message verbatim." rows={3} className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-brand-navy focus:border-brand-navy" />
              </div>
              <LoadingButton variant="primary" size="sm" loading={updateProject.isPending || createSession.isPending} loadingText="Creating..." onClick={handleCreate} icon={RotateCw}>
                Create conversation {sessionNumber} & copy nudge
              </LoadingButton>
              {(updateProject.error || createSession.error) && (
                <StatusMessage type="error" message={(updateProject.error || createSession.error)?.message || 'Failed'} />
              )}
            </div>
          </div>
        )}
      </CardBody>
    </Card>
  )
}

// --- Shared Components ---

function SessionModeToggle({ mode, onChange }: { mode: 'discover' | 'converge'; onChange: (m: 'discover' | 'converge') => void }) {
  return (
    <div>
      <label className="text-sm font-medium text-gray-700 block mb-1.5">Mode</label>
      <div className="flex gap-2">
        <button
          onClick={() => onChange('discover')}
          className={`flex-1 px-3 py-2 rounded-md text-sm font-medium transition-colors ${
            mode === 'discover' ? 'bg-brand-navy text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
          }`}
        >
          Discover
        </button>
        <button
          onClick={() => onChange('converge')}
          className={`flex-1 px-3 py-2 rounded-md text-sm font-medium transition-colors ${
            mode === 'converge' ? 'bg-brand-navy text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
          }`}
        >
          Converge
        </button>
      </div>
      <p className="text-xs text-gray-500 mt-1">
        {mode === 'discover'
          ? 'Broad exploration \u2014 the agent asks open-ended questions'
          : 'Push for decisions \u2014 the agent narrows scope and presents options'}
      </p>
    </div>
  )
}

function ListEditor({
  label,
  description,
  items,
  newItem,
  onNewItemChange,
  onAdd,
  onBulkAdd,
  onRemove,
  placeholder,
}: {
  label: string
  description: string
  items: string[]
  newItem: string
  onNewItemChange: (v: string) => void
  onAdd: () => void
  onBulkAdd: (items: string[]) => void
  onRemove: (i: number) => void
  placeholder: string
}) {
  const handlePaste = (e: React.ClipboardEvent<HTMLInputElement>) => {
    const text = e.clipboardData.getData('text')
    if (!text.includes('\n')) return // single line — let default paste handle it

    e.preventDefault()
    // Strip common header lines and split by newline
    const lines = text
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line && !/^(builder directives|seed questions):?\s*$/i.test(line))
    if (lines.length > 0) onBulkAdd(lines)
  }

  return (
    <div>
      <label className="text-sm font-medium text-gray-700 block mb-1.5">{label}</label>
      <p className="text-xs text-gray-500 mb-2">{description}</p>
      {items.length > 0 && (
        <ul className="space-y-1.5 mb-2">
          {items.map((item, i) => (
            <li key={i} className="flex items-start gap-2 text-sm text-gray-700 bg-gray-50 rounded px-2.5 py-1.5">
              <span className="text-gray-400 text-xs mt-0.5">{i + 1}.</span>
              <span className="flex-1">{item}</span>
              <button onClick={() => onRemove(i)} className="p-0.5 text-gray-400 hover:text-red-500 shrink-0">
                <X className="h-3.5 w-3.5" />
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="flex gap-2">
        <input
          type="text"
          value={newItem}
          onChange={(e) => onNewItemChange(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); onAdd() } }}
          onPaste={handlePaste}
          placeholder={placeholder}
          className="flex-1 px-3 py-1.5 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-brand-navy focus:border-brand-navy"
        />
        <button onClick={onAdd} disabled={!newItem.trim()} className="p-1.5 text-gray-400 hover:text-brand-navy hover:bg-gray-100 rounded disabled:opacity-40">
          <Plus className="h-4 w-4" />
        </button>
      </div>
    </div>
  )
}

// --- Helpers ---


function hasBriefContent(brief: BriefContent): boolean {
  return !!(
    brief.problem ||
    brief.target_users ||
    (brief.features && brief.features.length > 0) ||
    brief.constraints ||
    brief.additional_context ||
    (brief.decisions && brief.decisions.length > 0) ||
    (brief.open_risks && brief.open_risks.length > 0)
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
