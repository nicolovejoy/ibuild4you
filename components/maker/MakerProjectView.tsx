'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft, Send, ChevronDown, ChevronUp, MessageSquare, HelpCircle, Paperclip, Pencil } from 'lucide-react'
import { getTurnIndicator } from '@/lib/turn-indicator'
import { isSupportedUpload, SUPPORTED_TYPES_LABEL } from '@/lib/files/supported-types'
import { BuildTimestamp } from '@/components/build-timestamp'
import { Card, CardBody } from '@/components/ui/Card'
import { MessageContent } from '@/components/ui/MessageContent'
import { UploadedFilePreview, LocalFilePreview } from '@/components/ui/FilePreview'
import { FilesGrid } from '@/components/ui/FilesGrid'
import { WireframePreview } from '@/components/ui/WireframePreview'
import { Skeleton } from '@/components/ui/Skeleton'
import { StatusMessage } from '@/components/ui/StatusMessage'
import {
  useProject,
  useSessions,
  useMessages,
  useCreateSession,
  useProjectFiles,
  useUploadFiles,
  useCurrentUser,
  useUpdateCurrentUser,
} from '@/lib/query/hooks'
import { Modal } from '@/components/ui/Modal'
import { LoadingButton } from '@/components/ui/LoadingButton'
import { apiFetch } from '@/lib/firebase/api-fetch'
import { useStreamingChat } from '@/lib/hooks/useStreamingChat'
import { useRealtimeMessages } from '@/lib/hooks/useRealtimeMessages'
import { useEscapeBack } from '@/lib/hooks/useEscapeBack'
import { copy } from '@/lib/copy'
import { formatCostUsd } from '@/lib/observability/session-cost'
import { shouldKickoff } from '@/lib/agent/kickoff'
import { UserMenu } from '@/components/user-menu'
import { briefRoleLabel, briefRoleShort, viewerBriefRole } from '@/lib/roles/display'
import { BriefSwitcher } from '@/components/brief-switcher'
import { useQueryClient } from '@tanstack/react-query'
import type { Session, WireframeMockup, ProjectFile } from '@/lib/types'

export function MakerProjectView({ projectId, userEmail }: { projectId: string; userEmail: string }) {
  const router = useRouter()
  const { data: project, isLoading: projectLoading } = useProject(projectId)
  const { data: sessions } = useSessions(projectId)
  const { data: projectFiles } = useProjectFiles(projectId)
  const { data: currentUser, isLoading: userLoading } = useCurrentUser()
  const updateUser = useUpdateCurrentUser()
  const [editingName, setEditingName] = useState(false)
  const [editFirst, setEditFirst] = useState('')
  const [editLast, setEditLast] = useState('')
  useEscapeBack('/dashboard')
  const activeSession = sessions?.find((s) => s.status === 'active')
  const completedSessions = sessions?.filter((s) => s.status === 'completed') || []

  // Show name prompt for nameless makers (Feature 4)
  const needsName = !userLoading && currentUser && !currentUser.first_name

  if (needsName) {
    return <NamePromptModal onSave={updateUser.mutateAsync} saving={updateUser.isPending} />
  }

  const displayName = currentUser?.first_name
    ? `${currentUser.first_name}${currentUser.last_name ? ` ${currentUser.last_name.charAt(0)}` : ''}`
    : null

  // Maker view: phone-first chat surface. Two-row header keeps the brief title
  // on its own line and uses a subline for role + context + status — so the
  // maker always has a sense of "what you're doing here" even before they look
  // at the chat. Turn indicator only appears for meaningful states (no
  // "Needs setup" — that's filtered out in getTurnIndicator for makers).
  const turn = getTurnIndicator(project, project?.viewer_role ?? null)

  return (
    <div className="min-h-screen bg-brand-cream">
      <header className="bg-white border-b-2 border-amber-300/50 sticky top-0 z-10">
        <div className="px-4 sm:px-6 pt-2 sm:pt-3 pb-2">
          {/* Row 1: nav + title + identity */}
          <div className="flex items-center gap-2 sm:gap-3">
            <button onClick={() => router.push('/dashboard')} className="p-1 hover:bg-gray-100 rounded shrink-0">
              <ArrowLeft className="h-5 w-5 text-gray-600" />
            </button>
            <div className="group relative flex-1 min-w-0 flex items-center gap-2">
              <BriefSwitcher currentId={project?.id} currentTitle={project?.title} loading={projectLoading} />
              <BuildTimestamp />
            </div>
            {displayName && !editingName && (
              <button
                onClick={() => { setEditFirst(currentUser?.first_name || ''); setEditLast(currentUser?.last_name || ''); setEditingName(true) }}
                className="flex items-center gap-1 text-sm text-gray-500 hover:text-brand-navy shrink-0"
                title="Edit your name"
              >
                <span className="hidden sm:inline">{displayName}</span>
                <Pencil className="h-3 w-3" />
              </button>
            )}
          {editingName && (
            <div className="flex items-center gap-1.5">
              <input
                type="text"
                value={editFirst}
                onChange={(e) => setEditFirst(e.target.value)}
                placeholder="First"
                className="w-20 px-1.5 py-1 border border-gray-300 rounded text-sm focus:outline-none focus:ring-1 focus:ring-brand-navy"
                autoFocus
              />
              <input
                type="text"
                value={editLast}
                onChange={(e) => setEditLast(e.target.value)}
                placeholder="Last"
                className="w-20 px-1.5 py-1 border border-gray-300 rounded text-sm focus:outline-none focus:ring-1 focus:ring-brand-navy"
              />
              <LoadingButton
                variant="ghost"
                size="sm"
                loading={updateUser.isPending}
                onClick={async () => {
                  if (editFirst.trim()) {
                    await updateUser.mutateAsync({ first_name: editFirst.trim(), last_name: editLast.trim() })
                    setEditingName(false)
                  }
                }}
              >
                Save
              </LoadingButton>
              <button onClick={() => setEditingName(false)} className="text-xs text-gray-500 hover:text-gray-700">Cancel</button>
            </div>
          )}
            <Link
              href="/about"
              className="p-1.5 hover:bg-gray-100 rounded text-gray-400 hover:text-gray-600 shrink-0"
              title="What is iBuild4you?"
            >
              <HelpCircle className="h-4 w-4" />
            </Link>
            {/* Identity + sign out — the maker lives on this page, so they need a
                way to see who they're signed in as and switch accounts here. */}
            <UserMenu />
          </div>

          {/* Row 2: role + context + status. "What you're doing here." */}
          <div className="flex items-center gap-2 mt-1.5 text-xs text-brand-slate">
            <span
              className="text-[10px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded bg-amber-500 text-white shrink-0"
              title={briefRoleShort(viewerBriefRole(project?.viewer_role, project?.viewer_brief_role))}
            >
              {briefRoleLabel(viewerBriefRole(project?.viewer_role, project?.viewer_brief_role))}
            </span>
            <span className="truncate">Chatting with {copy.chat.agentLabel}</span>
            {turn && (
              <span className={`text-[11px] px-2 py-0.5 rounded-full font-medium shrink-0 ${turn.className}`}>
                {turn.label}
              </span>
            )}
          </div>
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-4 py-6 space-y-4">
        {/* Always-open chat */}
        <MakerChat
          projectId={projectId}
          userEmail={userEmail}
          activeSession={activeSession || null}
          sessionsLoaded={!!sessions}
          projectFiles={projectFiles || []}
          projectLastMakerMessageAt={project?.last_maker_message_at ?? null}
        />

        {/* Layout mockups from the active session */}
        {activeSession?.layout_mockups && activeSession.layout_mockups.length > 0 && (
          <MockupsPanel mockups={activeSession.layout_mockups} />
        )}

        {/* Project files */}
        {projectFiles && projectFiles.length > 0 && (
          <FilesPanel files={projectFiles} />
        )}

        {/* Previous conversations */}
        {completedSessions.length > 0 && (
          <SessionHistory sessions={completedSessions} />
        )}
      </main>
    </div>
  )
}

function MakerChat({
  projectId,
  userEmail,
  activeSession,
  sessionsLoaded,
  projectFiles,
  projectLastMakerMessageAt,
}: {
  projectId: string
  userEmail: string
  activeSession: Session | null
  sessionsLoaded: boolean
  projectFiles: ProjectFile[]
  projectLastMakerMessageAt: string | null
}) {
  const queryClient = useQueryClient()
  const createSession = useCreateSession()
  const uploadFiles = useUploadFiles()
  const sessionId = activeSession?.id

  const { messages, setMessages, streaming, error, setError, streamMessage, kickoff } = useStreamingChat({ projectId })

  const { data: savedMessages, isLoading: messagesLoading } = useMessages(sessionId)
  useRealtimeMessages(sessionId)
  const kickoffAttempted = useRef(false)

  const [input, setInput] = useState('')
  const [pendingFiles, setPendingFiles] = useState<File[]>([])
  const [uploading, setUploading] = useState(false)
  const [creatingSession, setCreatingSession] = useState(false)
  const [dragOver, setDragOver] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (savedMessages && !streaming) {
      setMessages(savedMessages.map((m) => ({
        id: m.id, role: m.role, content: m.content,
        created_at: m.created_at, sender_email: m.sender_email, sender_display_name: m.sender_display_name,
        file_ids: m.file_ids,
      })))
    }
  }, [savedMessages, streaming, setMessages])

  // Agent kickoff (#31): when the maker opens a stale session, have the agent
  // greet them first (typing indicator + name-aware recap) instead of waiting
  // for them to type. Predicate decides whether to fire; the server re-validates
  // and is the authority on the reload/multi-tab guard. We attempt at most once
  // per mount, plus a per-session sessionStorage lock to avoid redundant calls
  // on remount within the same tab.
  useEffect(() => {
    if (!sessionId || !savedMessages || messagesLoading || streaming || kickoffAttempted.current) return
    if (!shouldKickoff(savedMessages, Date.now(), { projectLastMakerMessageAt })) return
    const lockKey = `kickoff:${sessionId}`
    try {
      if (sessionStorage.getItem(lockKey)) return
      sessionStorage.setItem(lockKey, '1')
    } catch {
      // sessionStorage unavailable (private mode) — server guard still protects us
    }
    kickoffAttempted.current = true
    kickoff(sessionId)
  }, [sessionId, savedMessages, messagesLoading, streaming, kickoff, projectLastMakerMessageAt])

  const addFiles = useCallback((files: FileList | File[]) => {
    const newFiles = Array.from(files)
    const oversized = newFiles.filter((f) => f.size > 25 * 1024 * 1024)
    if (oversized.length > 0) {
      console.warn('upload_rejected_too_large', oversized.map((f) => ({
        filename: f.name, size: f.size, content_type: f.type,
      })))
      setError(`File "${oversized[0].name}" exceeds 25MB limit`)
      return
    }
    // Reject types the agent can't read up front, so the maker gets an instant,
    // clear reason instead of a file that uploads but the agent never sees.
    // The /api/files/init route enforces the same rule server-side.
    const unsupported = newFiles.filter(
      (f) => !isSupportedUpload({ filename: f.name, contentType: f.type }),
    )
    if (unsupported.length > 0) {
      console.warn('upload_rejected_unsupported_type', unsupported.map((f) => ({
        filename: f.name, content_type: f.type,
      })))
      setError(
        `Sorry, I can't open "${unsupported[0].name}". I can read ${SUPPORTED_TYPES_LABEL} — could you export it as a PDF and try again?`,
      )
      return
    }
    setPendingFiles((prev) => [...prev, ...newFiles])
  }, [setError])

  const handleDragOver = useCallback((e: React.DragEvent) => {
    if (e.dataTransfer.types.includes('Files')) {
      e.preventDefault()
      setDragOver(true)
    }
  }, [])

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    // Only clear when leaving the container, not when moving between children
    if (e.currentTarget === e.target) setDragOver(false)
  }, [])

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setDragOver(false)
    if (e.dataTransfer.files.length > 0) addFiles(e.dataTransfer.files)
  }, [addFiles])

  // Handle paste for clipboard images
  const handlePaste = useCallback((e: React.ClipboardEvent) => {
    const items = e.clipboardData?.items
    if (!items) return
    const imageFiles: File[] = []
    for (const item of items) {
      if (item.type.startsWith('image/')) {
        const file = item.getAsFile()
        if (file) imageFiles.push(file)
      }
    }
    if (imageFiles.length > 0) {
      e.preventDefault()
      addFiles(imageFiles)
    }
  }, [addFiles])

  const handleSend = async () => {
    const hasText = !!input.trim()
    const hasFiles = pendingFiles.length > 0
    if ((!hasText && !hasFiles) || streaming || creatingSession || uploading) return

    const userMessage = input.trim()
    setInput('')
    const filesToUpload = [...pendingFiles]
    setPendingFiles([])
    setError(null)

    // Auto-create session if none active
    let targetSessionId = sessionId
    if (!targetSessionId) {
      setCreatingSession(true)
      try {
        const newSession = await createSession.mutateAsync({ project_id: projectId })
        targetSessionId = newSession.id
        // The maker just engaged by typing — don't let the kickoff effect also
        // auto-greet this brand-new (now empty, since #70) session.
        kickoffAttempted.current = true
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to start session')
        setCreatingSession(false)
        setPendingFiles(filesToUpload) // restore files
        return
      }
      setCreatingSession(false)
    }

    // Upload files first if any. Atomic semantics: every file runs to
    // completion. If some succeed and some fail, send the message with the
    // successful subset, surface a warning, and restore the failed files to
    // the picker so the maker can retry. If everything fails, abort the send
    // and put the typed text + files back so nothing is lost.
    let fileIds: string[] = []
    if (filesToUpload.length > 0) {
      setUploading(true)
      try {
        const { uploaded, failed } = await uploadFiles.mutateAsync({
          projectId,
          sessionId: targetSessionId,
          files: filesToUpload,
        })
        fileIds = uploaded.map((f) => f.id)
        if (failed.length > 0) {
          setPendingFiles(failed.map((f) => f.file))
          setError(
            uploaded.length === 0
              ? `Failed to upload ${filesToUpload.length === 1 ? 'file' : 'files'}: ${failed[0].error}`
              : `${failed.length} of ${filesToUpload.length} files failed to upload — try those again.`,
          )
        }
        if (uploaded.length === 0) {
          setInput(userMessage) // restore typed text alongside the failed files
          setUploading(false)
          return
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to upload files')
        setPendingFiles(filesToUpload) // restore files
        setUploading(false)
        return
      }
      setUploading(false)
    }

    const nowIso = new Date().toISOString()
    setMessages((prev) => [...prev, {
      role: 'user', content: userMessage, created_at: nowIso,
      sender_email: userEmail, file_ids: fileIds.length > 0 ? fileIds : undefined,
    }])

    // Only stream agent response if there's text content
    if (hasText) {
      await streamMessage(targetSessionId, userMessage, {
        fileIds: fileIds.length > 0 ? fileIds : undefined,
      })
      textareaRef.current?.focus()
    } else {
      // Files only, no agent response — just save the message
      try {
        await apiFetch('/api/chat', {
          method: 'POST',
          body: JSON.stringify({
            session_id: targetSessionId,
            content: '',
            file_ids: fileIds,
          }),
        })
        queryClient.invalidateQueries({ queryKey: ['messages', targetSessionId] })
      } catch {
        // Message was already optimistically added, ignore save error
      }
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  const isLoading = !sessionsLoaded || messagesLoading
  const canSend = (!!input.trim() || pendingFiles.length > 0) && !streaming && !isLoading && !creatingSession && !uploading
  const displayMessages = [...messages].reverse()

  // Build a lookup of file_id → ProjectFile for inline display
  const fileMap = new Map(projectFiles.map((f) => [f.id, f]))

  // Multi-human briefs: give each participant a distinct bubble color so two
  // people aren't an indistinguishable wall of navy. Assigned in first-speaking
  // order (from chronological `messages`), so colors are stable across renders.
  // Solo briefs are unchanged — the lone speaker gets brand-navy (palette[0]).
  const HUMAN_BUBBLE_COLORS = [
    'bg-brand-navy',
    'bg-emerald-700',
    'bg-purple-700',
    'bg-rose-700',
    'bg-cyan-700',
    'bg-orange-700',
  ]
  const colorByEmail = new Map<string, string>()
  for (const m of messages) {
    if (m.role !== 'user') continue
    const key = m.sender_email || ''
    if (!colorByEmail.has(key)) {
      colorByEmail.set(key, HUMAN_BUBBLE_COLORS[colorByEmail.size % HUMAN_BUBBLE_COLORS.length])
    }
  }

  return (
    <div className="space-y-3">
      {/* Input area */}
      <div
        className={`space-y-2 rounded-lg transition-colors ${dragOver ? 'ring-2 ring-brand-navy ring-offset-2 bg-brand-navy/5' : ''}`}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        <div className="flex gap-2">
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={streaming || isLoading || uploading}
            className="p-2.5 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg disabled:opacity-50 transition-colors"
            title="Attach files"
          >
            <Paperclip className="h-5 w-5" />
          </button>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            className="hidden"
            onChange={(e) => {
              if (e.target.files) addFiles(e.target.files)
              e.target.value = '' // reset so same file can be re-selected
            }}
          />
          <textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            onPaste={handlePaste}
            placeholder="Type a message..."
            rows={1}
            disabled={streaming || isLoading || creatingSession || uploading}
            className="flex-1 resize-none px-3 py-2 border border-gray-300 rounded-lg shadow-sm focus:outline-none focus:ring-2 focus:ring-brand-navy focus:border-brand-navy disabled:bg-gray-50 disabled:text-gray-400"
          />
          <button
            onClick={handleSend}
            disabled={!canSend}
            className="p-2.5 bg-brand-navy text-white rounded-lg hover:bg-brand-navy-light disabled:bg-brand-slate disabled:cursor-not-allowed transition-colors"
          >
            <Send className="h-5 w-5" />
          </button>
        </div>

        {/* Pending files preview */}
        {pendingFiles.length > 0 && (
          <div className="flex gap-2 flex-wrap pl-12">
            {pendingFiles.map((file, i) => (
              <LocalFilePreview
                key={`${file.name}-${i}`}
                file={file}
                onRemove={() => setPendingFiles((prev) => prev.filter((_, j) => j !== i))}
              />
            ))}
          </div>
        )}

        {uploading && (
          <p className="text-xs text-gray-400 pl-12">Uploading files...</p>
        )}
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
                  ? `${colorByEmail.get(msg.sender_email || '') || 'bg-brand-navy'} text-white`
                  : 'bg-white border border-gray-200 text-gray-800'
              }`}>
                <p className={`text-[10px] mb-1 ${msg.role === 'user' ? 'text-white/70' : 'text-gray-400'}`}>
                  {msg.role === 'user' ? (msg.sender_display_name || msg.sender_email?.split('@')[0] || 'You') : copy.chat.agentLabel}
                  {msg.created_at ? ` \u00b7 ${formatTimestamp(msg.created_at)}` : ''}
                </p>
                {/* Inline file attachments */}
                {msg.file_ids && msg.file_ids.length > 0 && (
                  <div className="flex flex-wrap gap-2 mb-2">
                    {msg.file_ids.map((fid) => {
                      const pf = fileMap.get(fid)
                      return pf ? (
                        <UploadedFilePreview key={fid} file={pf} compact />
                      ) : null
                    })}
                  </div>
                )}
                {msg.content && <MessageContent content={msg.content} />}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export function MockupsPanel({ mockups }: { mockups: WireframeMockup[] }) {
  const [expanded, setExpanded] = useState(false)

  return (
    <Card hover={false}>
      <CardBody>
        <button
          onClick={() => setExpanded(!expanded)}
          className="w-full flex items-center justify-between text-left"
        >
          <h3 className="text-sm font-semibold text-brand-slate uppercase tracking-wide">
            Layout ideas ({mockups.length})
          </h3>
          {expanded ? (
            <ChevronUp className="h-4 w-4 text-gray-400" />
          ) : (
            <ChevronDown className="h-4 w-4 text-gray-400" />
          )}
        </button>
        {expanded && (
          <div className="mt-3 space-y-3">
            {mockups.map((m, i) => (
              <WireframePreview key={i} mockup={m} />
            ))}
          </div>
        )}
      </CardBody>
    </Card>
  )
}

function FilesPanel({ files }: { files: ProjectFile[] }) {
  const [expanded, setExpanded] = useState(false)

  return (
    <Card hover={false}>
      <CardBody>
        <button
          onClick={() => setExpanded(!expanded)}
          className="w-full flex items-center justify-between text-left"
        >
          <h3 className="text-sm font-semibold text-brand-slate uppercase tracking-wide">
            Files ({files.length})
          </h3>
          {expanded ? (
            <ChevronUp className="h-4 w-4 text-gray-400" />
          ) : (
            <ChevronDown className="h-4 w-4 text-gray-400" />
          )}
        </button>
        {expanded && (
          <div className="mt-3">
            <FilesGrid files={files} />
          </div>
        )}
      </CardBody>
    </Card>
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
        <span>Conversation {sessionNumber} &middot; {date}</span>
        <div className="flex items-center gap-2 text-gray-400">
          {session.token_usage_input != null && (
            <span className="text-[10px]">
              {((session.token_usage_input + (session.token_usage_output || 0)) / 1000).toFixed(1)}k tokens
              {session.token_cost_usd != null && ` · ~${formatCostUsd(session.token_cost_usd)}`}
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
                    {msg.role === 'user' ? (msg.sender_display_name || msg.sender_email?.split('@')[0] || 'You') : 'Assistant'}
                    {msg.created_at ? ` \u00b7 ${formatTimestamp(msg.created_at)}` : ''}
                  </p>
                  <MessageContent content={msg.content} />
                </div>
              </div>
            ))
          )}
        </div>
      )}
    </div>
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

// --- Name prompt for first-time makers ---

function NamePromptModal({
  onSave,
  saving,
}: {
  onSave: (data: { first_name: string; last_name?: string }) => Promise<unknown>
  saving: boolean
}) {
  const [first, setFirst] = useState('')
  const [last, setLast] = useState('')

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!first.trim()) return
    await onSave({ first_name: first.trim(), last_name: last.trim() || undefined })
  }

  return (
    <div className="min-h-screen bg-brand-cream flex items-center justify-center">
      <Card hover={false}>
        <CardBody>
          <form onSubmit={handleSubmit} className="space-y-4 w-72">
            <h2 className="text-lg font-semibold text-brand-charcoal">What should we call you?</h2>
            <p className="text-sm text-gray-600">Just so your builder knows who they&apos;re working with.</p>
            <input
              type="text"
              value={first}
              onChange={(e) => setFirst(e.target.value)}
              placeholder="First name"
              className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-brand-navy focus:border-brand-navy"
              autoFocus
              required
            />
            <input
              type="text"
              value={last}
              onChange={(e) => setLast(e.target.value)}
              placeholder="Last name (optional)"
              className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-brand-navy focus:border-brand-navy"
            />
            <LoadingButton type="submit" variant="primary" loading={saving} disabled={!first.trim()}>
              Continue
            </LoadingButton>
          </form>
        </CardBody>
      </Card>
    </div>
  )
}
