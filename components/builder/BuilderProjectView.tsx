'use client'

import { useState, useEffect, useRef } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import {
  ArrowLeft, MessageSquare, Send, FileText, Sparkles, Plus, X,
  Share2, ChevronDown, ChevronUp, Copy, Check, Mail, RotateCw,
  Lock, Trash2, Settings, Upload, ClipboardCopy, Users, KeyRound, UserPlus,
} from 'lucide-react'
import { BuildTimestamp } from '@/components/build-timestamp'
import { Card, CardBody } from '@/components/ui/Card'
import { Skeleton } from '@/components/ui/Skeleton'
import { StatusMessage } from '@/components/ui/StatusMessage'
import { LoadingButton } from '@/components/ui/LoadingButton'
import { EmptyState } from '@/components/ui/EmptyState'
import { MessageContent } from '@/components/ui/MessageContent'
import { parseNextConvoPayload } from '@/lib/api/import-payload'
import { nextReminderAt } from '@/lib/api/reminder-cadence'
import { useEscapeBack } from '@/lib/hooks/useEscapeBack'
import { useNudgeCopy } from '@/lib/hooks/useNudgeCopy'
import { getProjectShareLink } from '@/lib/url'
import { lockedFirst } from '@/lib/api/brief-merge'
import { sessionNumberById, decisionProvenanceMarkdown } from '@/lib/builder/decision-provenance'
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
  useChangeRequesterEmail,
  useCreateSession,
  useProjectFiles,
  useProjectMembers,
  useSetBriefRole,
  useSetMemberRole,
  useRemoveMember,
  useRestoreMember,
  useRevealMemberPasscode,
  useSendMakerEmail,
  useGeneratePrep,
  useDeleteProject,
  useCurrentUser,
} from '@/lib/query/hooks'
import { buildNextConvoPrompt } from '@/lib/agent/next-convo-prompt'
import { copy } from '@/lib/copy'
import { formatCostUsd } from '@/lib/observability/session-cost'
import { briefRoleLabel, briefRoleShort, viewerBriefRole } from '@/lib/roles/display'
import { MEMBER_ROLES, memberRoleLabel } from '@/lib/roles/member-role'
import { apiFetch } from '@/lib/firebase/api-fetch'
import { useRealtimeMessages } from '@/lib/hooks/useRealtimeMessages'
import {
  makerRoster,
  getDispatchState,
  conversationLabel,
  remindersStripLine,
} from '@/lib/builder/conversations-view'
import { useQueryClient } from '@tanstack/react-query'
import { BuilderFilesTab } from './BuilderFilesTab'
import { BriefEditor } from './BriefEditor'
import { serializeBriefContent } from '@/lib/api/brief-json'
import { getTurnIndicator } from '@/lib/turn-indicator'
import { TurnBadge } from '@/components/ui/TurnBadge'
import { BriefSwitcher } from '@/components/brief-switcher'
import type { Project, Session, BriefContent, ProjectFile } from '@/lib/types'

// Builder nav is Brief · Conversations · People · Agent setup. #120 made
// Conversations reader-first (the transcript is the page), which pushed agent
// config back out to its own Setup tab.
type TabId = 'brief' | 'conversations' | 'people' | 'setup'

// Map legacy ?tab= values (sessions/files) so old links/bookmarks land on
// the right new tab instead of falling through to the default.
const LEGACY_TAB: Record<string, TabId> = {
  sessions: 'conversations',
  files: 'brief',
}

export function BuilderProjectView({ projectId }: { projectId: string }) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const { data: project, isLoading: projectLoading } = useProject(projectId)
  const { data: sessions } = useSessions(projectId)
  const { data: brief, isLoading: briefLoading } = useBrief(projectId)
  const { data: projectFiles } = useProjectFiles(projectId)

  useEscapeBack('/dashboard')
  const updateProject = useUpdateProject()
  const activeSession = sessions?.find((s) => s.status === 'active')
  const [showShareModal, setShowShareModal] = useState(false)
  // 'maker' = first share / re-share the originator (link + passcode view).
  // 'add'  = invite an additional person — always opens the entry form so a
  // shared brief can still grow its roster (PeoplePanel "+ Invite").
  const [shareMode, setShareMode] = useState<'maker' | 'add'>('maker')
  const openShare = (mode: 'maker' | 'add' = 'maker') => {
    setShareMode(mode)
    setShowShareModal(true)
  }
  const [editingTitle, setEditingTitle] = useState(false)
  const [titleDraft, setTitleDraft] = useState('')
  // Reverse direction (#115): the dispatch modal links straight to the Brief
  // tab's payload-import fold, which is otherwise hard to find. One-shot,
  // consumed by BriefTab after it expands + scrolls to the fold.
  const [openImport, setOpenImport] = useState(false)
  // Forward leg of the payload ferry: a successful paste hands the builder to
  // the Conversations tab with the Start modal auto-opened (or a dismissible
  // loaded-confirmation when it isn't start's turn). One-shot, consumed when
  // the modal closes / the line is dismissed.
  const [importedPayload, setImportedPayload] = useState<{ configUpdated: boolean } | null>(null)
  const rawTab = searchParams.get('tab') || ''
  const tabParam: TabId | null = (['brief', 'conversations', 'people', 'setup'].includes(rawTab)
    ? (rawTab as TabId)
    : LEGACY_TAB[rawTab]) || null
  const activeTab: TabId = tabParam ?? 'conversations'

  const setTab = (tab: TabId) => {
    const params = new URLSearchParams(searchParams.toString())
    if (tab === 'conversations') {
      params.delete('tab')
    } else {
      params.set('tab', tab)
    }
    params.delete('session') // clear session selection when changing tabs
    const qs = params.toString()
    router.replace(`/projects/${project?.slug || projectId}${qs ? `?${qs}` : ''}`, { scroll: false })
  }

  // Turn indicator — builder view always sees builder perspective.
  // The badge keys off session_count, but the raw project doc can carry a
  // stale/undefined value (seed scripts + pre-denormalization briefs), which
  // wrongly reads as "Needs setup" even when conversations exist. Feed it the
  // sessions we've already loaded (same source as the "N sessions" header) so
  // the brief-page badge agrees with the dashboard, which recomputes
  // session_count in enrich-projects. (#103)
  const turn = getTurnIndicator(
    project && sessions ? { ...project, session_count: sessions.length } : project,
    'builder'
  )

  // Tab definitions used by both the desktop sidebar and mobile bottom tab bar.
  const tabs: { id: TabId; label: string; shortLabel: string; Icon: typeof MessageSquare; tooltip: string }[] = [
    { id: 'brief', label: 'Brief', shortLabel: 'Brief', Icon: FileText, tooltip: copy.glossary.brief.short },
    { id: 'conversations', label: 'Conversations', shortLabel: 'Convos', Icon: MessageSquare, tooltip: copy.glossary.conversations.short },
    { id: 'people', label: 'People', shortLabel: 'People', Icon: Users, tooltip: copy.glossary.people.short },
    { id: 'setup', label: 'Agent setup', shortLabel: 'Setup', Icon: Settings, tooltip: copy.glossary.setup.short },
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
                    onClick={() => openShare('maker')}
                    className="flex items-center gap-1.5 hover:text-brand-navy transition-colors"
                  >
                    <Share2 className="h-3.5 w-3.5" />
                    <span>{project.requester_first_name ? `${project.requester_first_name}${project.requester_last_name ? ` ${project.requester_last_name.charAt(0)}` : ''}` : project.requester_email?.split('@')[0]}</span>
                  </button>
                ) : (
                  <button
                    onClick={() => openShare('maker')}
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
          {activeTab === 'brief' && (
            <BriefTab
              projectId={projectId}
              brief={brief}
              briefLoading={briefLoading}
              project={project}
              files={projectFiles || []}
              onImported={(r) => { setImportedPayload(r); setTab('conversations') }}
              autoOpenImport={openImport}
              onAutoOpenConsumed={() => setOpenImport(false)}
            />
          )}
          {activeTab === 'conversations' && (
            <ConversationsTab
              project={project}
              projectId={projectId}
              slug={project?.slug}
              sessions={sessions || []}
              sessionsLoaded={!!sessions}
              activeSession={activeSession || null}
              turn={turn}
              onShare={openShare}
              onOpenImport={() => { setOpenImport(true); setTab('brief') }}
              justImported={importedPayload}
              onImportedConsumed={() => setImportedPayload(null)}
            />
          )}
          {activeTab === 'people' && (
            <PeopleTab project={project} onShare={openShare} />
          )}
          {activeTab === 'setup' && (
            project ? <AgentConfigCard project={project} defaultExpanded /> : <Skeleton className="h-64 w-full rounded-lg" />
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
        <ShareModal project={project} mode={shareMode} onClose={() => setShowShareModal(false)} />
      )}
    </div>
  )
}

// --- Transcript (#120 reader-first) ---

// Read-only transcript: chronological oldest → newest exactly as the API
// returns messages, auto-scrolled to the latest. No composer — the builder
// view is for catching up; the maker chat is the only writing surface.
function TranscriptPane({ session }: { session: Session }) {
  const sessionId = session.id
  const { data: savedMessages, isLoading } = useMessages(sessionId)
  useRealtimeMessages(sessionId)
  const deleteMessage = useDeleteMessage()
  const paneRef = useRef<HTMLDivElement>(null)

  // Land the reader on the latest message whenever the transcript grows.
  useEffect(() => {
    const el = paneRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [savedMessages?.length])

  const messages = savedMessages || []

  return (
    <div className="space-y-3">
      {isLoading ? (
        <div className="space-y-3">
          <Skeleton className="h-16 w-3/4 rounded-lg" />
          <Skeleton className="h-16 w-2/3 rounded-lg ml-auto" />
        </div>
      ) : messages.length === 0 ? (
        <div className="text-center text-brand-slate py-8">
          <MessageSquare className="h-10 w-10 mx-auto mb-3 text-gray-300" />
          <p className="text-sm">No messages yet.</p>
        </div>
      ) : (
        // #146 — visible box + always-visible scrollbar so it's obvious the
        // transcript scrolls and where you are in it (auto-scroll lands at the
        // bottom; macOS overlay scrollbars gave no hint of the overflow).
        <div
          ref={paneRef}
          className="scrollbar-visible max-h-[65vh] overflow-y-auto space-y-3 rounded-lg border border-gray-200 bg-gray-50/60 p-3"
        >
          {messages.map((msg) => (
            <div
              key={msg.id}
              className={`group flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
            >
              <div className={`relative max-w-[80%] rounded-lg px-4 py-2.5 ${
                msg.role === 'user'
                  ? 'bg-brand-navy text-white'
                  : 'bg-white border border-gray-200 text-gray-800'
              }`}>
                <p className={`text-[10px] mb-1 ${msg.role === 'user' ? 'text-blue-200' : 'text-gray-400'}`}>
                  {msg.role === 'user' ? (msg.sender_display_name || msg.sender_email?.split('@')[0] || 'Maker') : copy.chat.agentLabel}
                  {msg.created_at ? ` · ${formatTimestamp(msg.created_at)}` : ''}
                  {/* Maker's rating (#130) — quiet signal for the builder */}
                  {msg.role === 'agent' && msg.rating ? (msg.rating === 'up' ? ' · 👍' : ' · 👎') : ''}
                </p>
                <MessageContent content={msg.content} />
                <button
                  onClick={() => deleteMessage.mutate({ messageId: msg.id, sessionId })}
                  className="absolute -top-2 -right-2 p-1 bg-white border border-gray-200 rounded-full text-gray-400 hover:text-red-600 hover:border-red-200 opacity-0 group-hover:opacity-100 transition-opacity shadow-sm"
                  title="Delete message"
                >
                  <Trash2 className="h-3 w-3" />
                </button>
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
  briefLoading = false,
  project,
  files = [],
  onImported,
  autoOpenImport = false,
  onAutoOpenConsumed,
}: {
  projectId: string
  brief: { version: number; content: BriefContent } | null | undefined
  briefLoading?: boolean
  project: Project | undefined
  files?: ProjectFile[]
  onImported?: (r: { configUpdated: boolean }) => void
  autoOpenImport?: boolean
  onAutoOpenConsumed?: () => void
}) {
  const [payloadCopied, setPayloadCopied] = useState(false)
  const [briefCopied, setBriefCopied] = useState(false)
  const [jsonCopied, setJsonCopied] = useState(false)
  const [pasteJson, setPasteJson] = useState('')
  const [pasteError, setPasteError] = useState<string | null>(null)
  const [showGenConfirm, setShowGenConfirm] = useState(false)
  const queryClient = useQueryClient()
  const [generating, setGenerating] = useState(false)
  const [loadingPayload, setLoadingPayload] = useState(false)
  const updateBrief = useUpdateBrief()
  const updateProject = useUpdateProject()
  // #121: session id → conversation number, for decision-provenance suffixes in
  // the read view and the markdown copy. Query is shared with the other tabs.
  const { data: briefTabSessions } = useSessions(projectId)

  const briefContent = brief?.content as BriefContent | undefined
  const hasBrief = briefContent && hasBriefContent(briefContent)

  // Arriving via the dispatch modal's "load a payload" link (#115): scroll to
  // the import card + focus its textarea, then consume the one-shot flag.
  const importCardRef = useRef<HTMLDivElement>(null)
  const importTextareaRef = useRef<HTMLTextAreaElement>(null)
  useEffect(() => {
    if (autoOpenImport && importCardRef.current) {
      importCardRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' })
      importTextareaRef.current?.focus()
      onAutoOpenConsumed?.()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoOpenImport])

  const handleGenerate = async () => {
    setGenerating(true)
    try {
      await apiFetch('/api/briefs/generate', {
        method: 'POST',
        body: JSON.stringify({ project_id: projectId }),
      })
      queryClient.invalidateQueries({ queryKey: ['brief', projectId] })
      setShowGenConfirm(false)
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
      let configUpdated = false
      if (result.value.mode === 'multi') {
        await updateBrief.mutateAsync({ project_id: projectId, content: result.value.brief })
        if (Object.keys(result.value.projectUpdate).length > 0) {
          await updateProject.mutateAsync({
            project_id: projectId,
            ...result.value.projectUpdate,
          } as Parameters<typeof updateProject.mutateAsync>[0])
          configUpdated = true
        }
      } else {
        await updateBrief.mutateAsync({ project_id: projectId, content: result.value.brief as BriefContent })
      }
      setPasteJson('')
      // Import succeeded — hand the builder to the next step instead of leaving
      // them staring at the updated brief with no cue (#25).
      onImported?.({ configUpdated })
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
      // Locked-first, and mark locked ones — the markdown export is the
      // build↔brief ferry, so the lock must survive the round-trip to an outside
      // agent (#71), not just show in-app. Provenance rides along too (#121).
      const numbers = sessionNumberById(briefTabSessions || [])
      sections.push(
        `## Decisions`,
        ...lockedFirst(briefContent.decisions).map(
          (d) =>
            `- ${d.locked ? '🔒 ' : ''}**${d.topic}:** ${d.decision}${decisionProvenanceMarkdown(d, numbers)}`,
        ),
        '',
      )
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

      {/* Ferry controls. The copy-paste round-trip routes builder reasoning onto
          the Max sub (cost model); the in-app "Update from conversation" is the
          optional metered-API convenience, never the default. */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <LoadingButton
          variant="ghost"
          size="sm"
          loading={loadingPayload}
          loadingText="Loading..."
          onClick={handleCopyPayload}
          icon={ClipboardCopy}
        >
          {payloadCopied ? 'Copied!' : 'Copy next-convo prep'}
        </LoadingButton>
        <button
          onClick={() => setShowGenConfirm(true)}
          className="flex items-center gap-1.5 text-xs text-gray-500 hover:text-brand-navy"
        >
          <Sparkles className="h-3.5 w-3.5" />
          Update from conversation (uses API)
        </button>
      </div>

      {/* Paste target for the next-convo payload — the ferry's landing spot,
          so it gets first-class placement above the brief (was a fold at the
          bottom; Nico 2026-07-11). Accepts the full payload (brief + agent
          config) or brief-only JSON; the BriefEditor's raw view covers
          in-place edits. */}
      <Card hover={false}>
        <CardBody>
          <div ref={importCardRef} className="space-y-2">
            <h3 className="text-sm font-semibold text-brand-slate uppercase tracking-wide flex items-center gap-1.5">
              <Upload className="h-4 w-4" /> Paste next-convo payload
            </h3>
            <p className="text-xs text-gray-400">
              The JSON from your prep chat — full payload (brief + agent config) or brief-only.
            </p>
            <textarea
              ref={importTextareaRef}
              value={pasteJson}
              onChange={(e) => { setPasteJson(e.target.value); setPasteError(null) }}
              placeholder='Paste the "next-convo" JSON here...'
              rows={3}
              className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm font-mono focus:outline-none focus:ring-2 focus:ring-brand-navy focus:border-brand-navy"
            />
            {pasteError && <StatusMessage type="error" message={pasteError} />}
            <LoadingButton
              variant="secondary"
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
        </CardBody>
      </Card>

      <BriefEditor projectId={projectId} content={briefContent} version={brief?.version} loading={briefLoading} sessions={briefTabSessions} />

      {/* Confirm the metered-API regen — it overwrites the brief (locked
          decisions survive). Offer a copy-first so no manual edit is lost. */}
      <Modal isOpen={showGenConfirm} onClose={() => { if (!generating) setShowGenConfirm(false) }} title="Update brief from conversation?" size="sm">
        <div className="space-y-4">
          <p className="text-sm text-gray-600">
            This runs a fresh AI pass over the conversation and <span className="font-medium text-gray-900">replaces the current brief</span> (uses metered API). Locked decisions are kept. Any unsaved manual edits to other fields will be overwritten.
          </p>
          {hasBrief && (
            <button
              onClick={async () => {
                await navigator.clipboard.writeText(serializeBriefContent(briefContent!))
                setJsonCopied(true)
                setTimeout(() => setJsonCopied(false), 2000)
              }}
              className="flex items-center gap-1.5 text-xs text-gray-500 hover:text-brand-navy"
            >
              {jsonCopied ? <Check className="h-3.5 w-3.5 text-green-500" /> : <Copy className="h-3.5 w-3.5" />}
              {jsonCopied ? 'Copied current brief' : 'Copy current brief first (JSON)'}
            </button>
          )}
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setShowGenConfirm(false)} disabled={generating} className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800 disabled:opacity-50">
              Cancel
            </button>
            <LoadingButton variant="primary" loading={generating} loadingText="Updating…" icon={Sparkles} onClick={handleGenerate}>
              Update brief
            </LoadingButton>
          </div>
        </div>
      </Modal>

      {/* Attachments — Files folded into the Brief (#19 Phase 2). Anything
          uploaded to the brief that Sam can reference. */}
      <div className="pt-2">
        <h3 className="text-sm font-semibold text-brand-slate uppercase tracking-wide mb-2 flex items-center gap-1.5">
          <Upload className="h-4 w-4" />
          Attachments{files.length ? ` (${files.length})` : ''}
        </h3>
        <BuilderFilesTab projectId={projectId} files={files} />
      </div>
    </div>
  )
}

// --- Conversations Tab (#120 reader-first) ---
// The transcript IS the page: a status strip (turn state + full maker roster +
// reminders) with the one state-aware dispatch action on top, then the
// selected conversation, chronological and read-only.

function ConversationsTab({
  project,
  projectId,
  slug,
  sessions,
  sessionsLoaded,
  activeSession,
  turn,
  onShare,
  onOpenImport,
  justImported,
  onImportedConsumed,
}: {
  project: Project | undefined
  projectId: string
  slug?: string
  sessions: Session[]
  sessionsLoaded: boolean
  activeSession: Session | null
  turn: ReturnType<typeof getTurnIndicator>
  onShare: (mode?: 'maker' | 'add') => void
  onOpenImport?: () => void
  justImported?: { configUpdated: boolean } | null
  onImportedConsumed?: () => void
}) {
  const searchParams = useSearchParams()
  const router = useRouter()
  const sessionParam = searchParams.get('session')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const { data: currentUser } = useCurrentUser()
  const isAdmin = currentUser?.system_roles?.includes('admin') ?? false

  // Selected conversation: URL param wins, else the live one, else the newest.
  useEffect(() => {
    if (sessionParam && sessions.some((s) => s.id === sessionParam)) {
      setSelectedId(sessionParam)
    } else if (activeSession) {
      setSelectedId(activeSession.id)
    } else if (sessions.length > 0) {
      setSelectedId(sessions[0].id) // sessions come newest-first
    }
  }, [sessionParam, sessions, activeSession])

  const handleSelect = (sessionId: string) => {
    setSelectedId(sessionId)
    const params = new URLSearchParams(searchParams.toString())
    params.set('session', sessionId)
    params.delete('tab')
    router.replace(`/projects/${slug || projectId}?${params.toString()}`, { scroll: false })
  }

  if (!project || !sessionsLoaded) {
    return <Skeleton className="h-64 w-full rounded-lg" />
  }

  const selectedSession = sessions.find((s) => s.id === selectedId) || null
  // sessions are newest-first; conversation numbers count up from the oldest.
  const numberOf = (id: string) => sessions.length - sessions.findIndex((s) => s.id === id)

  return (
    <div className="space-y-4">
      <StatusStrip
        project={project}
        projectId={projectId}
        sessions={sessions}
        activeSession={activeSession}
        turn={turn}
        onShare={onShare}
        onOpenImport={onOpenImport}
        justImported={justImported}
        onImportedConsumed={onImportedConsumed}
      />

      {sessions.length === 0 ? (
        <EmptyState
          icon={MessageSquare}
          title="No conversations yet"
          description="Start the first conversation from the button above — the transcript lives here."
        />
      ) : (
        <div>
          <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
            {selectedSession && (
              <h2 className="text-sm font-semibold text-brand-slate uppercase tracking-wide flex items-center gap-2">
                {selectedSession.status === 'active' && (
                  <span className="w-2 h-2 rounded-full bg-green-500" aria-hidden />
                )}
                {conversationLabel(numberOf(selectedSession.id), selectedSession.status)}
                {/* Token/cost is operator telemetry, not reading material — admin-only (#120). */}
                {isAdmin && selectedSession.token_usage_input != null && (
                  <span className="text-[11px] font-normal normal-case tracking-normal text-gray-400">
                    {((selectedSession.token_usage_input + (selectedSession.token_usage_output || 0)) / 1000).toFixed(1)}k tokens
                    {selectedSession.token_cost_usd != null && <> · ~{formatCostUsd(selectedSession.token_cost_usd)}</>}
                  </span>
                )}
              </h2>
            )}
            {sessions.length > 1 && (
              <div className="flex items-center gap-1" aria-label="Conversations">
                {[...sessions].reverse().map((s) => {
                  const n = numberOf(s.id)
                  const isSelected = s.id === selectedId
                  return (
                    <button
                      key={s.id}
                      onClick={() => handleSelect(s.id)}
                      title={`Conversation ${n} · ${new Date(s.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`}
                      className={`min-w-7 px-2 py-1 rounded text-xs font-medium transition-colors ${
                        isSelected
                          ? 'bg-brand-navy text-white'
                          : 'bg-white border border-gray-200 text-gray-500 hover:text-brand-navy'
                      }`}
                    >
                      {n}
                    </button>
                  )
                })}
              </div>
            )}
          </div>
          {selectedSession && <TranscriptPane key={selectedSession.id} session={selectedSession} />}
        </div>
      )}
    </div>
  )
}

// --- People Tab (#19 Phase 2) ---
// Roster + per-person access, extracted from the old Setup tab.

function PeopleTab({ project, onShare }: { project: Project | undefined; onShare: (mode?: 'maker' | 'add') => void }) {
  if (!project) return <Skeleton className="h-48 w-full rounded-lg" />

  if (!project.requester_email) {
    return (
      <Card hover={false}>
        <CardBody>
          <h2 className="text-sm font-semibold text-brand-slate uppercase tracking-wide flex items-center gap-1.5 mb-3">
            <Users className="h-4 w-4" /> People on this brief
          </h2>
          <p className="text-sm text-gray-600 mb-4">
            No one yet. Invite the person this brief is for — you&apos;ll get a link and passcode to send them.
          </p>
          <LoadingButton variant="primary" icon={Share2} onClick={() => onShare('maker')}>
            Invite someone
          </LoadingButton>
        </CardBody>
      </Card>
    )
  }

  return <PeoplePanel project={project} onInvite={() => onShare('add')} />
}

// --- Status strip + dispatch (#120) ---
// One row: turn state, the full maker roster (not just the first requester),
// reminders state, and the single state-aware dispatch action.

function StatusStrip({
  project,
  projectId,
  sessions,
  activeSession,
  turn,
  onShare,
  onOpenImport,
  justImported,
  onImportedConsumed,
}: {
  project: Project
  projectId: string
  sessions: Session[]
  activeSession: Session | null
  turn: ReturnType<typeof getTurnIndicator>
  onShare: (mode?: 'maker' | 'add') => void
  onOpenImport?: () => void
  justImported?: { configUpdated: boolean } | null
  onImportedConsumed?: () => void
}) {
  const { data: members } = useProjectMembers(project.id)
  const { data: activeMessages } = useMessages(activeSession?.id)
  const hasUserMessages = activeMessages?.some((m) => m.role === 'user') ?? false

  const roster = makerRoster(members, project)
  const dispatch = getDispatchState({
    project,
    members,
    sessionCount: sessions.length,
    hasActiveSession: !!activeSession,
    makerRepliedInActive: hasUserMessages,
  })
  const remindersLine = remindersStripLine(project, Date.now())

  // Post-dispatch confirmation, rendered full-width under the strip so the
  // sent/copied/suppressed outcome stays visible after the modal closes.
  const [result, setResult] = useState<{
    sessionNumber: number
    sent?: string[]
    copied?: boolean
    suppressed?: boolean
  } | null>(null)

  return (
    <div className="bg-white border border-gray-200 rounded-lg px-4 py-3 space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 min-w-0">
          {turn && (
            <TurnBadge turn={turn} className={`text-xs px-2 py-0.5 rounded-full font-medium shrink-0 ${turn.className}`} />
          )}
          <span className="flex items-center gap-1.5 text-sm text-gray-700 min-w-0">
            <Users className="h-3.5 w-3.5 text-gray-400 shrink-0" />
            <span className="truncate">{roster.canSend ? roster.names : 'No maker yet'}</span>
          </span>
          <span className="text-xs text-gray-400">{remindersLine}</span>
        </div>
        <div className="shrink-0">
          {dispatch.kind === 'invite' && (
            <LoadingButton variant="primary" size="sm" icon={Share2} onClick={() => onShare('maker')}>
              Invite a maker
            </LoadingButton>
          )}
          {dispatch.kind === 'nudge' && (
            <NudgeDispatch
              project={project}
              projectId={projectId}
              makerNames={dispatch.makerNames}
              sessionNumber={dispatch.sessionNumber}
            />
          )}
          {dispatch.kind === 'start' && (
            <StartDispatch
              project={project}
              projectId={projectId}
              sessionNumber={dispatch.sessionNumber}
              makerNames={dispatch.makerNames}
              canSend={dispatch.canSend}
              onShare={onShare}
              onOpenImport={onOpenImport}
              onResult={setResult}
              justImported={justImported}
              onImportedConsumed={onImportedConsumed}
            />
          )}
        </div>
      </div>

      {/* Payload landed but it isn't start's turn (maker still mid-conversation,
          or no maker yet) — confirm the paste took instead of opening the Start
          modal. Config only snapshots into the NEXT session, hence the caveat. */}
      {justImported && dispatch.kind !== 'start' && (
        <div className="flex items-start justify-between gap-2 text-sm border-t border-gray-100 pt-2">
          <div className="flex items-start gap-2">
            <Check className="h-4 w-4 text-green-600 mt-0.5 shrink-0" />
            <p>
              <span className="font-medium text-green-800">Payload loaded.</span>{' '}
              <span className="text-gray-600">
                Brief updated{justImported.configUpdated ? '; agent config applies from the next conversation' : ''}.
              </span>
            </p>
          </div>
          <button onClick={onImportedConsumed} aria-label="Dismiss" className="text-gray-400 hover:text-gray-600 shrink-0">
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {result && (
        <div className="flex items-start gap-2 text-sm border-t border-gray-100 pt-2">
          <Check className="h-4 w-4 text-green-600 mt-0.5 shrink-0" />
          <p>
            <span className="font-medium text-green-800">Conversation {result.sessionNumber} created.</span>{' '}
            <span className="text-gray-600">
              {result.copied
                ? 'Nudge copied — paste it whenever you like.'
                : result.suppressed
                  ? `Dev: would have emailed ${result.sent?.join(' + ')} (suppressed on preview).`
                  : `Emailed ${result.sent?.join(' + ')} — their replies come back to you.`}
            </span>
          </p>
        </div>
      )}
    </div>
  )
}

function ShareModal({ project, onClose, mode = 'maker' }: { project: Project; onClose: () => void; mode?: 'maker' | 'add' }) {
  // 'add' mode invites an *additional* person to an already-shared brief, so the
  // form starts blank and defaults the role to Contributor. 'maker' mode keeps
  // the original behavior (first share / re-share the originator).
  const isAdd = mode === 'add'
  const [email, setEmail] = useState(isAdd ? '' : project.requester_email || '')
  const [firstName, setFirstName] = useState(isAdd ? '' : project.requester_first_name || '')
  const [lastName, setLastName] = useState(isAdd ? '' : project.requester_last_name || '')
  // Who this person is on the brief. Originator = the primary requester (default,
  // preserves existing behavior); Contributor = a second human who also chats
  // with Sam in the same brief. Both keep `maker` access so they can chat.
  const [briefRole, setBriefRole] = useState<'originator' | 'contributor'>(isAdd ? 'contributor' : 'originator')
  const [linkCopied, setLinkCopied] = useState(false)
  const [passcodeCopied, setPasscodeCopied] = useState(false)
  const [emailCopied, setEmailCopied] = useState(false)
  const [editingName, setEditingName] = useState(false)
  const [editFirstName, setEditFirstName] = useState(project.requester_first_name || '')
  const [editLastName, setEditLastName] = useState(project.requester_last_name || '')
  const [editingEmail, setEditingEmail] = useState(false)
  const [editEmail, setEditEmail] = useState(project.requester_email || '')
  const shareProject = useShareProject()
  const updateProject = useUpdateProject()
  const alreadyShared = !!project.requester_email
  const { data: fetchedPasscode } = useProjectPasscode(alreadyShared ? project.id : undefined)
  const resetPasscode = useResetPasscode()
  const changeEmail = useChangeRequesterEmail()

  // In add mode the originator's stored passcode (fetchedPasscode) is irrelevant —
  // only the freshly invited person's passcode (from the POST response) applies.
  const passcode = shareProject.data?.passcode || (isAdd ? null : fetchedPasscode) || null

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

  // Show the confirmation (link/passcode) after a successful share in this modal,
  // or — only in maker mode — when the brief was already shared.
  // Add mode always shows the form until the new person is actually invited.
  const showConfirmation = shareProject.isSuccess || (!isAdd && alreadyShared)
  // The first-time invite message (boilerplate + "Send invitation") belongs ONLY
  // to a fresh invite. For someone already on the brief who's opening this just to
  // grab their link/passcode, re-serving the "I'm putting together a brief…" copy
  // is the wrong tone (#19 Phase 4) — recurring contact is the Conversations
  // dispatch nudge, not the invite. So gate the invite block on a fresh share.
  const justInvited = shareProject.isSuccess
  // The person the confirmation refers to: the just-invited person on success,
  // otherwise the stored originator.
  const sharedEmail = justInvited ? email : project.requester_email || email

  const inviteEmailBody = copy.invite.body({ projectTitle: project.title, shareLink, email: sharedEmail, passcode })

  return (
    <Modal isOpen onClose={onClose} title={isAdd ? 'Invite someone to this brief' : justInvited ? 'Share with maker' : alreadyShared ? 'Maker access' : 'Share with maker'}>
      {showConfirmation ? (
        <div className="space-y-3">
          <div className="p-3 bg-green-50 border border-green-200 rounded-lg">
            <div className="flex items-center justify-between">
              <div className="min-w-0 flex-1">
                {!isAdd && editingEmail ? (
                  <div className="flex items-center gap-2">
                    <input
                      type="email"
                      value={editEmail}
                      onChange={(e) => setEditEmail(e.target.value)}
                      placeholder="maker@email.com"
                      className="flex-1 px-2 py-1 border border-green-300 rounded text-sm focus:outline-none focus:ring-1 focus:ring-brand-navy"
                      autoFocus
                    />
                    <LoadingButton
                      variant="ghost"
                      size="sm"
                      loading={changeEmail.isPending}
                      onClick={async () => {
                        const next = editEmail.trim()
                        if (!next) return
                        await changeEmail.mutateAsync({ project_id: project.id, new_email: next })
                        setEditingEmail(false)
                      }}
                    >
                      Save
                    </LoadingButton>
                    <button onClick={() => setEditingEmail(false)} className="text-xs text-gray-500 hover:text-gray-700">
                      Cancel
                    </button>
                  </div>
                ) : (
                  <p className="text-sm font-medium text-green-800 truncate">Shared with {sharedEmail}</p>
                )}
                {!isAdd && !editingName && !editingEmail && (editFirstName || editLastName) && (
                  <p className="text-xs text-green-700 mt-0.5">{[editFirstName, editLastName].filter(Boolean).join(' ')}</p>
                )}
              </div>
              {!isAdd && !editingName && !editingEmail && (
                <div className="flex shrink-0 gap-3 pl-2">
                  {/* Correcting a typo'd email reissues the passcode (the old
                      invite stops working), so only offer it for an established
                      maker — not a fresh invite the builder just typed. */}
                  {!justInvited && (
                    <button onClick={() => { setEditEmail(project.requester_email || ''); setEditingEmail(true) }} className="text-xs text-green-700 hover:text-green-900 underline">
                      Edit email
                    </button>
                  )}
                  <button onClick={() => setEditingName(true)} className="text-xs text-green-700 hover:text-green-900 underline">
                    Edit name
                  </button>
                </div>
              )}
            </div>
            {!isAdd && editingEmail && (
              <p className="text-xs text-green-700 mt-1">Changing the email reissues the passcode — re-send the invite to the new address below.</p>
            )}
            {!isAdd && editingName && (
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
          {/* First-time invite copy + send — only for a fresh invite (#19 Phase 4).
              An established maker opening this for their link/passcode sees access
              only; to contact them again, use the Conversations dispatch nudge. */}
          {justInvited ? (
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
          ) : (
            <p className="text-xs text-gray-500">
              Already on the brief. To reach {project.requester_first_name || 'them'} again, use the send action at the
              top of <span className="font-medium text-gray-600">Conversations</span>.
            </p>
          )}
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
      {changeEmail.error && <StatusMessage type="error" message={changeEmail.error.message} />}
    </Modal>
  )
}

// People on this brief: lists members with their access tier + an editable
// brief_role for chat participants (Originator/Contributor/Reviewer). Console
// operators (owner/builder) operate in a reviewing capacity — shown read-only.
function PeoplePanel({ project, onInvite }: { project: Project; onInvite: () => void }) {
  // include_removed so moved-out members show with a Restore action (#106 P2).
  const { data: members, isLoading, error } = useProjectMembers(project.id, true, true)
  const setBriefRole = useSetBriefRole(project.id)
  const setMemberRole = useSetMemberRole(project.id)
  const removeMember = useRemoveMember(project.id)
  const restoreMember = useRestoreMember(project.id)
  const [pendingEmail, setPendingEmail] = useState<string | null>(null)
  const [pendingTierId, setPendingTierId] = useState<string | null>(null)
  const [confirmRemoveId, setConfirmRemoveId] = useState<string | null>(null)

  const active = members?.filter((m) => !m.removed_at) ?? []
  const removed = members?.filter((m) => m.removed_at) ?? []

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
          {active.map((m) => {
            const isConsole = m.role === 'owner' || m.role === 'builder'
            const confirming = confirmRemoveId === m.id
            return (
              <li key={m.id} className="py-2">
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-brand-charcoal truncate">{m.display_name}</p>
                    <p className="text-xs text-gray-500 truncate">{m.email}</p>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    {/* Access tier (permission level) — editable for every member. */}
                    <select
                      aria-label="Access tier"
                      value={m.role ?? 'maker'}
                      disabled={setMemberRole.isPending && pendingTierId === m.id}
                      onChange={async (e) => {
                        const value = e.target.value
                        setPendingTierId(m.id)
                        try {
                          await setMemberRole.mutateAsync({ memberId: m.id, role: value })
                        } finally {
                          setPendingTierId(null)
                        }
                      }}
                      className="px-2 py-1 border border-gray-300 rounded-md text-xs focus:outline-none focus:ring-1 focus:ring-brand-navy"
                    >
                      {MEMBER_ROLES.map((r) => (
                        <option key={r} value={r}>{memberRoleLabel(r)}</option>
                      ))}
                    </select>
                    {/* Brief role (what they do) — console operators review by default. */}
                    {isConsole ? (
                      <span className="text-xs text-gray-400 px-1" title={briefRoleShort('reviewer')}>
                        {briefRoleLabel('reviewer')}
                      </span>
                    ) : (
                      <select
                        aria-label="Brief role"
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
                        className="px-2 py-1 border border-gray-300 rounded-md text-xs focus:outline-none focus:ring-1 focus:ring-brand-navy"
                      >
                        <option value="originator">{briefRoleLabel('originator')}</option>
                        <option value="contributor">{briefRoleLabel('contributor')}</option>
                        <option value="reviewer">{briefRoleLabel('reviewer')}</option>
                      </select>
                    )}
                    {/* Move out (#106) — non-destructive, two-step inline confirm. */}
                    <button
                      onClick={() => setConfirmRemoveId(m.id)}
                      title="Remove from brief"
                      aria-label="Remove from brief"
                      className="p-1 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>

                {confirming && (
                  <div className="mt-2 flex items-center justify-between gap-2 rounded-md bg-red-50 border border-red-200 p-2">
                    <span className="text-xs text-red-800">Remove {m.display_name} from this brief? Their access is revoked; you can restore them later.</span>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <button onClick={() => setConfirmRemoveId(null)} className="text-xs text-gray-600 hover:underline px-1">Cancel</button>
                      <button
                        onClick={async () => {
                          try {
                            await removeMember.mutateAsync(m.id)
                          } finally {
                            setConfirmRemoveId(null)
                          }
                        }}
                        disabled={removeMember.isPending}
                        className="text-xs font-medium text-white bg-red-600 hover:bg-red-700 rounded px-2 py-1 disabled:opacity-50"
                      >
                        Remove
                      </button>
                    </div>
                  </div>
                )}

                {/* Console operators sign in via OAuth — no passcode to reveal.
                    Chat participants need re-copyable creds (#81). */}
                {!isConsole && <MemberInviteReveal project={project} memberId={m.id} />}
              </li>
            )
          })}
        </ul>

        {removed.length > 0 && (
          <div className="mt-4">
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1">Removed</p>
            <ul className="divide-y divide-gray-100">
              {removed.map((m) => (
                <li key={m.id} className="py-2 flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm text-gray-500 truncate line-through">{m.display_name}</p>
                    <p className="text-xs text-gray-400 truncate">
                      {m.email}
                      {m.removed_at && ` · removed ${new Date(m.removed_at).toLocaleDateString()}`}
                    </p>
                  </div>
                  <button
                    onClick={() => restoreMember.mutate(m.id)}
                    disabled={restoreMember.isPending}
                    className="text-xs text-brand-navy hover:underline flex items-center gap-1 shrink-0 disabled:opacity-50"
                  >
                    <RotateCw className="h-3.5 w-3.5" /> Restore
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}

        {setBriefRole.error && <StatusMessage type="error" message={(setBriefRole.error as Error).message} />}
        {setMemberRole.error && <StatusMessage type="error" message={(setMemberRole.error as Error).message} />}
        {removeMember.error && <StatusMessage type="error" message={(removeMember.error as Error).message} />}
        {restoreMember.error && <StatusMessage type="error" message={(restoreMember.error as Error).message} />}
      </CardBody>
    </Card>
  )
}

// Per-member credential re-reveal (#81). The invite link is the same for everyone
// on the brief; the passcode is what's unique per person — and after the first
// invite it was unrecoverable, so the operator risked handing a 2nd person the
// originator's creds. Fetched on demand (a click), never carried in the list.
function MemberInviteReveal({ project, memberId }: { project: Project; memberId: string }) {
  const reveal = useRevealMemberPasscode(project.id)
  const [open, setOpen] = useState(false)
  const [copied, setCopied] = useState<'link' | 'passcode' | null>(null)

  const link = getProjectShareLink(project.slug, project.id)
  const passcode = reveal.data?.passcode

  const handleCopy = async (which: 'link' | 'passcode', value: string) => {
    await navigator.clipboard.writeText(value)
    setCopied(which)
    setTimeout(() => setCopied(null), 2000)
  }

  const toggle = () => {
    const next = !open
    setOpen(next)
    if (next && !reveal.data && !reveal.isPending) reveal.mutate(memberId)
  }

  return (
    <div className="mt-1.5">
      <button
        onClick={toggle}
        className="text-xs text-brand-navy hover:underline flex items-center gap-1"
      >
        <KeyRound className="h-3 w-3" />
        {open ? 'Hide sign-in details' : 'Show sign-in details'}
      </button>

      {open && (
        <div className="mt-2 space-y-2 rounded-md bg-gray-50 border border-gray-200 p-2.5">
          <div>
            <p className="text-[11px] text-gray-500 mb-0.5">Link</p>
            <div className="flex items-center gap-1.5">
              <code className="flex-1 min-w-0 truncate px-2 py-1 bg-white border border-gray-300 rounded text-xs text-gray-700">{link}</code>
              <button onClick={() => handleCopy('link', link)} className="p-1 text-gray-500 hover:text-brand-navy hover:bg-gray-100 rounded shrink-0" title="Copy link">
                {copied === 'link' ? <Check className="h-3.5 w-3.5 text-green-500" /> : <Copy className="h-3.5 w-3.5" />}
              </button>
            </div>
          </div>
          <div>
            <p className="text-[11px] text-gray-500 mb-0.5 flex items-center gap-1"><Lock className="h-3 w-3" /> Passcode</p>
            {reveal.isPending && <Skeleton className="h-7 w-28" />}
            {reveal.error && <StatusMessage type="error" message={(reveal.error as Error).message} />}
            {passcode && (
              <div className="flex items-center gap-1.5">
                <code className="px-2 py-1 bg-white border border-gray-300 rounded text-sm tracking-widest font-mono text-brand-charcoal">{passcode}</code>
                <button onClick={() => handleCopy('passcode', passcode)} className="p-1 text-gray-500 hover:text-brand-navy hover:bg-gray-100 rounded" title="Copy passcode">
                  {copied === 'passcode' ? <Check className="h-3.5 w-3.5 text-green-500" /> : <Copy className="h-3.5 w-3.5" />}
                </button>
              </div>
            )}
          </div>
          <p className="text-[11px] text-gray-400">Send this person their own link + passcode so they sign in as themselves.</p>
        </div>
      )}
    </div>
  )
}

// The single agent-config home (#19 UX-scrub Phase 1). Formerly the "Agent
// setup" card (EditableSetup); the duplicate config fold inside the dispatch
// card is gone, so this is now the ONE place to edit how the agent behaves.
// Collapsible so it doesn't dominate the surface; defaultExpanded after a JSON
// import (#25) so the builder lands on the thing to review.
function AgentConfigCard({ project, defaultExpanded = false }: { project: Project; defaultExpanded?: boolean }) {
  const [expanded, setExpanded] = useState(defaultExpanded)
  const [welcomeMessage, setWelcomeMessage] = useState(project.welcome_message || '')
  const [seedQuestions, setSeedQuestions] = useState<string[]>(project.seed_questions || [])
  const [newQuestion, setNewQuestion] = useState('')
  const [sessionMode, setSessionMode] = useState<'discover' | 'converge'>(project.session_mode || 'discover')
  const [directives, setDirectives] = useState<string[]>(project.builder_directives || [])
  const [newDirective, setNewDirective] = useState('')
  const [identity, setIdentity] = useState(project.identity || '')
  const [nudgeMessageOverride, setNudgeMessageOverride] = useState(project.nudge_message || '')
  const [voiceSample, setVoiceSample] = useState(project.voice_sample || '')
  const [autoReminders, setAutoReminders] = useState(project.auto_reminders_enabled === true)
  const [githubRepo, setGithubRepo] = useState(project.github_repo || '')
  const [saved, setSaved] = useState(false)
  const [deleting, setDeleting] = useState(false)

  const updateProject = useUpdateProject()
  const generateWelcome = useGenerateWelcome()
  const { data: currentUser } = useCurrentUser()
  // Destructive delete is the owner's escape hatch, relocated here from the
  // dashboard card so it can't be hit by accident next to Archive (#16). Same
  // gate as the old card control (system admin); the route enforces owner too.
  const isAdmin = currentUser?.system_roles?.includes('admin') ?? false

  useEffect(() => {
    setWelcomeMessage(project.welcome_message || '')
    setSeedQuestions(project.seed_questions || [])
    setSessionMode(project.session_mode || 'discover')
    setDirectives(project.builder_directives || [])
    setIdentity(project.identity || '')
    setNudgeMessageOverride(project.nudge_message || '')
    setVoiceSample(project.voice_sample || '')
    setAutoReminders(project.auto_reminders_enabled === true)
    setGithubRepo(project.github_repo || '')
  }, [project.welcome_message, project.seed_questions, project.session_mode, project.builder_directives, project.identity, project.nudge_message, project.voice_sample, project.auto_reminders_enabled, project.github_repo])

  const handleSave = async () => {
    await updateProject.mutateAsync({
      project_id: project.id,
      welcome_message: welcomeMessage,
      seed_questions: seedQuestions,
      session_mode: sessionMode,
      builder_directives: directives,
      identity: identity || undefined,
      nudge_message: nudgeMessageOverride || undefined,
      voice_sample: voiceSample || undefined,
      auto_reminders_enabled: autoReminders,
      github_repo: githubRepo.trim() || undefined,
      last_builder_activity_at: new Date().toISOString(),
    })
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  // Reminder status line (#67): read-only, derived from persisted fields + the
  // live toggle. Same gating as the cron via nextReminderAt() so it never shows a
  // phantom send (e.g. after the maker replied, or once the 3-send cap is hit).
  const reminderNext = nextReminderAt({
    autoRemindersEnabled: autoReminders,
    remindersSentCount: project.reminders_sent_count,
    lastReminderSentAt: project.last_reminder_sent_at,
    latestSessionCreatedAt: project.latest_session_created_at,
    sharedAt: project.shared_at,
    lastMakerMessageAt: project.last_maker_message_at,
    requesterEmail: project.requester_email,
  })
  const fmtDate = (iso: string) =>
    new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  let reminderNextLine: string
  if (reminderNext.at !== null) {
    const days = Math.ceil((Date.parse(reminderNext.at) - Date.now()) / 86400000)
    reminderNextLine =
      days <= 0
        ? 'Next reminder: due now (goes out on the next daily run)'
        : `Next reminder: in ~${days} day${days === 1 ? '' : 's'} (${fmtDate(reminderNext.at)})`
  } else {
    reminderNextLine = {
      no_maker_email: 'No maker email set — add one to enable reminders.',
      cap_reached: 'All 3 reminders sent — paused until the maker replies.',
      maker_already_responded: 'Maker has replied — reminders paused.',
      no_reference_timestamp: 'No conversation shared yet — nothing to remind about.',
      disabled: 'Reminders are off.',
    }[reminderNext.block]
  }

  return (
    <Card hover={false}>
      <CardBody>
        <button
          onClick={() => setExpanded((v) => !v)}
          className="w-full flex items-center justify-between text-sm font-semibold text-brand-slate uppercase tracking-wide"
        >
          <span className="flex items-center gap-1.5">
            <Settings className="h-4 w-4" />
            Agent setup
          </span>
          {expanded ? <ChevronUp className="h-4 w-4 text-gray-400" /> : <ChevronDown className="h-4 w-4 text-gray-400" />}
        </button>
        {!expanded && (
          <p className="text-xs text-gray-400 mt-1.5">
            {sessionMode === 'converge' ? 'Converge' : 'Discover'} mode
            {` · ${(sessionMode === 'discover' ? seedQuestions : directives).length} ${sessionMode === 'discover' ? 'seed question' : 'directive'}${(sessionMode === 'discover' ? seedQuestions : directives).length === 1 ? '' : 's'}`}
            {` · reminders ${autoReminders ? 'on' : 'off'}`}
          </p>
        )}
        {expanded && (
        <div className="space-y-5 mt-4">
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

          {/* Reminder status (#67) — only meaningful when reminders are on */}
          {autoReminders && (
            <div className="ml-6 -mt-2 rounded-md bg-gray-50 border border-gray-100 px-3 py-2 text-xs text-gray-600 space-y-0.5">
              <div>
                {(project.reminders_sent_count ?? 0)} of 3 reminders sent this round
                {project.last_reminder_sent_at ? ` · last ${fmtDate(project.last_reminder_sent_at)}` : ''}
              </div>
              <div className="text-gray-500">{reminderNextLine}</div>
            </div>
          )}

          {/* Advanced — rarely touched: agent persona + the Loop/feedback repo
              destination (not maker-send config; lives here so it isn't stranded
              while the eventual "Brief settings" home is built — #19 Phase 4). */}
          <details className="group">
            <summary className="cursor-pointer text-xs font-medium text-gray-400 hover:text-gray-600 list-none">Advanced</summary>
            <div className="mt-3 space-y-5">
              <div>
                <label className="text-sm font-medium text-gray-700 block mb-1.5">Agent identity (optional)</label>
                <textarea value={identity} onChange={(e) => setIdentity(e.target.value)} placeholder="Override the default agent persona. Leave blank for standard intake assistant." rows={2} className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-brand-navy focus:border-brand-navy" />
                <p className="text-xs text-gray-400 mt-1">Changes how the agent introduces itself and frames its role.</p>
              </div>
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
              <div>
                <label className="text-sm font-medium text-gray-700 block mb-1.5">Voice sample (optional)</label>
                <textarea value={voiceSample} onChange={(e) => setVoiceSample(e.target.value)} placeholder="One paragraph showing how you'd text this person by hand." rows={3} className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-brand-navy focus:border-brand-navy" />
                <p className="text-xs text-gray-400 mt-1">Anchors the AI-drafted nudge to your voice. Ignored when a nudge override is set.</p>
              </div>
              {isAdmin && (
                <div className="pt-4 border-t border-red-100">
                  <label className="text-sm font-medium text-red-700 block mb-1.5">Danger zone</label>
                  <p className="text-xs text-gray-400 mb-2">{copy.deleteProject.warning} To just hide it from your dashboard, use Archive instead.</p>
                  <button
                    onClick={() => setDeleting(true)}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-red-600 border border-red-200 rounded-md hover:bg-red-50"
                  >
                    <Trash2 className="h-4 w-4" /> Delete brief
                  </button>
                </div>
              )}
            </div>
          </details>

          <div className="flex items-center gap-2 pt-2 border-t border-gray-100">
            <LoadingButton variant="secondary" size="sm" loading={updateProject.isPending} loadingText="Saving..." onClick={handleSave}>
              {saved ? 'Saved!' : 'Save setup'}
            </LoadingButton>
            {updateProject.error && <span className="text-xs text-red-500">{updateProject.error.message}</span>}
          </div>
        </div>
        )}
      </CardBody>
      {deleting && <DeleteBriefModal project={project} onClose={() => setDeleting(false)} />}
    </Card>
  )
}

// Owner-only destructive delete, relocated from the dashboard card into the
// brief's Advanced section (#16). Type-"delete"-to-confirm; on success the brief
// is gone, so we leave the brief view for the dashboard.
function DeleteBriefModal({ project, onClose }: { project: Project; onClose: () => void }) {
  const router = useRouter()
  const [confirmation, setConfirmation] = useState('')
  const deleteProject = useDeleteProject()
  const canDelete = confirmation.toLowerCase() === 'delete'

  return (
    <Modal isOpen onClose={onClose} title={`Delete "${project.title}"?`}>
      <div className="space-y-4">
        <p className="text-sm text-gray-700">{copy.deleteProject.warning}</p>
        <div>
          <label htmlFor="brief-delete-confirm" className="block text-sm font-medium text-gray-700 mb-1">
            Type <span className="font-mono font-bold">delete</span> to confirm
          </label>
          <input
            id="brief-delete-confirm"
            type="text"
            value={confirmation}
            onChange={(e) => setConfirmation(e.target.value)}
            placeholder="delete"
            className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-red-500 focus:border-red-500"
            autoFocus
          />
        </div>
        {deleteProject.error && <StatusMessage type="error" message={deleteProject.error.message} />}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800">
            Cancel
          </button>
          <LoadingButton
            variant="danger"
            loading={deleteProject.isPending}
            loadingText="Deleting..."
            disabled={!canDelete}
            onClick={async () => {
              try {
                await deleteProject.mutateAsync(project.id)
                router.push('/dashboard')
              } catch {
                // error shown via deleteProject.error
              }
            }}
          >
            Delete
          </LoadingButton>
        </div>
      </div>
    </Modal>
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
                  // Pin the send to this one person — SendToMakerButton is
                  // always a targeted "send to X" action, never a fan-out.
                  const r = await sendEmail.mutateAsync({ project_id: projectId, kind, note, to: makerEmail })
                  setSentTo(r.to.join(' + '))
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

// Waiting-on-maker dispatch: nudge instead of starting a new round. The send
// targets the requester — the reminder path is single-recipient by design
// (see /api/projects/[id]/email).
function NudgeDispatch({
  project,
  projectId,
  makerNames,
  sessionNumber,
}: {
  project: Project
  projectId: string
  makerNames: string
  sessionNumber: number
}) {
  const [open, setOpen] = useState(false)
  const sendEmail = useSendMakerEmail()
  const { copied, copyNudge } = useNudgeCopy(projectId)
  const [sentTo, setSentTo] = useState<string | null>(null)

  const shareLink = getProjectShareLink(project.slug, projectId)
  const reminderMessage = copy.nudge.reminder({
    firstName: project.requester_first_name || null,
    sessionNumber,
    shareLink,
  })

  if (sentTo) {
    return (
      <span className="flex items-center gap-1.5 text-xs text-green-600 font-medium">
        <Check className="h-3.5 w-3.5" /> Reminder sent to {sentTo}
      </span>
    )
  }

  return (
    <>
      <LoadingButton variant="primary" size="sm" icon={Mail} onClick={() => { sendEmail.reset(); setOpen(true) }}>
        Nudge {makerNames}
      </LoadingButton>
      <Modal isOpen={open} onClose={() => { if (!sendEmail.isPending) setOpen(false) }} title={`Waiting on ${makerNames}`} size="sm">
        <div className="space-y-4">
          <p className="text-sm text-gray-600">No reply yet in conversation {sessionNumber}. Send a reminder:</p>
          <textarea
            readOnly
            value={reminderMessage}
            rows={3}
            className="w-full px-2.5 py-1.5 bg-gray-50 border border-gray-300 rounded-md text-sm text-gray-700 resize-none"
          />
          {sendEmail.isError && <StatusMessage type="error" message={sendEmail.error.message} />}
          <div className="flex items-center justify-end gap-4">
            <button
              onClick={() => copyNudge(reminderMessage)}
              className="flex items-center gap-1.5 text-xs text-gray-500 hover:text-brand-navy"
            >
              {copied ? <Check className="h-3.5 w-3.5 text-green-500" /> : <Copy className="h-3.5 w-3.5" />}
              {copied ? 'Copied!' : 'Copy reminder'}
            </button>
            <LoadingButton
              variant="primary"
              loading={sendEmail.isPending}
              loadingText="Sending…"
              icon={Send}
              disabled={!project.requester_email}
              onClick={async () => {
                try {
                  const r = await sendEmail.mutateAsync({ project_id: projectId, kind: 'reminder' })
                  setSentTo(r.to.join(' + '))
                  setOpen(false)
                } catch {
                  // surfaced via sendEmail.isError; keep the modal open
                }
              }}
            >
              Send reminder
            </LoadingButton>
          </div>
        </div>
      </Modal>
    </>
  )
}

// The "done with this round?" dispatch — the #115 machinery behind one header
// button. The confirm modal carries the prep summary, the email/copy actions,
// and the load-a-payload + invite escape hatches. Starting a new conversation
// closes the current one, hence the confirm.
function StartDispatch({
  project,
  projectId,
  sessionNumber,
  makerNames,
  canSend,
  onShare,
  onOpenImport,
  onResult,
  justImported,
  onImportedConsumed,
}: {
  project: Project
  projectId: string
  sessionNumber: number
  makerNames: string
  canSend: boolean
  onShare: (mode?: 'maker' | 'add') => void
  onOpenImport?: () => void
  onResult: (r: { sessionNumber: number; sent?: string[]; copied?: boolean; suppressed?: boolean }) => void
  justImported?: { configUpdated: boolean } | null
  onImportedConsumed?: () => void
}) {
  const [open, setOpen] = useState(false)

  // Return leg of the ferry: arriving from a successful payload paste opens
  // the modal directly — the paste's whole purpose is starting the next
  // conversation. One-shot; closing the modal (any way) consumes the flag.
  const autoOpenedRef = useRef(false)
  useEffect(() => {
    if (justImported && !autoOpenedRef.current) {
      autoOpenedRef.current = true
      setOpen(true)
    }
  }, [justImported])
  const close = () => {
    setOpen(false)
    if (justImported) onImportedConsumed?.()
  }
  const updateProject = useUpdateProject()
  const createSession = useCreateSession()
  const sendEmail = useSendMakerEmail()
  const generatePrep = useGeneratePrep()
  const { copyNudge } = useNudgeCopy(projectId)

  const shareLink = getProjectShareLink(project.slug, projectId)
  const sessionMode = project.session_mode || 'discover'

  // AI-prepped focus + nudge (slice 2). Seed from the stored values, refresh
  // from the eager prep call. Local state shows the freshest result without a
  // refetch.
  const [prep, setPrep] = useState<{ focus: string; nudge_message: string } | null>(
    project.prep_focus && project.prep_nudge
      ? { focus: project.prep_focus, nudge_message: project.prep_nudge }
      : null
  )
  const prepFiredRef = useRef(false)
  const runPrep = () => {
    generatePrep
      .mutateAsync({ project_id: projectId })
      .then((r) => setPrep({ focus: r.focus, nudge_message: r.nudge_message }))
      .catch(() => {}) // silent — UI falls back to the template
  }

  // Pre-warm prep once on mount. The route is idempotent (dedupes on a config
  // fingerprint) so this only pays for a Sonnet call when the config/brief
  // actually changed since the last generation.
  useEffect(() => {
    if (prepFiredRef.current) return
    prepFiredRef.current = true
    runPrep()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const override = (project.nudge_message || '').trim()
  const nudgeBodyText = override || prep?.nudge_message
  const nudgeMessage = nudgeBodyText
    ? [nudgeBodyText, '', shareLink].join('\n')
    : copy.nudge.body({ projectTitle: project.title, shareLink, sessionMode })

  // Config is saved separately (Agent setup tab); the dispatch just creates
  // the session + sends. Touch builder activity + refresh prep so a stale
  // fingerprint re-warms.
  const createAndThen = async () => {
    runPrep()
    await createSession.mutateAsync({ project_id: projectId })
    await updateProject.mutateAsync({
      project_id: project.id,
      last_builder_activity_at: new Date().toISOString(),
    })
  }

  const handleSend = async () => {
    try {
      await createAndThen()
      const r = await sendEmail.mutateAsync({ project_id: projectId, kind: 'nudge' })
      onResult({ sessionNumber, sent: r.to, suppressed: r.suppressed })
      close()
    } catch {
      // surfaced via actionError; keep the modal open
    }
  }

  const handleCopy = async () => {
    try {
      await createAndThen()
      copyNudge(nudgeMessage)
      onResult({ sessionNumber, copied: true })
      close()
    } catch {
      // surfaced via actionError; keep the modal open
    }
  }

  const firstFocusItem = sessionMode === 'discover' ? project.seed_questions?.[0] : project.builder_directives?.[0]
  const mechanicalFocus = `${sessionMode === 'converge' ? 'Converge' : 'Discover'}${firstFocusItem ? ` · ${firstFocusItem}` : ''}`
  const focusLine = prep?.focus || mechanicalFocus
  const prepping = generatePrep.isPending && !prep
  const openerPreview = (project.welcome_message || '').trim().replace(/\s+/g, ' ')
  const busy = updateProject.isPending || createSession.isPending || sendEmail.isPending
  const actionError = updateProject.error || createSession.error || sendEmail.error

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        disabled={busy || !canSend}
        title={canSend ? undefined : 'Add a maker email to this brief to send.'}
        className="flex items-center gap-1.5 text-sm font-medium text-brand-navy hover:underline disabled:opacity-40 disabled:no-underline"
      >
        <RotateCw className="h-3.5 w-3.5" /> Start conversation {sessionNumber} &amp; email {makerNames}
      </button>

      <Modal isOpen={open} onClose={() => { if (!busy) close() }} title={`Start conversation ${sessionNumber}?`} size="sm">
        <div className="space-y-4">
          {justImported && (
            <div className="flex items-start gap-2 rounded-md border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-800">
              <Check className="h-4 w-4 mt-0.5 shrink-0 text-green-600" />
              <span>
                <span className="font-medium">Payload loaded</span> — brief
                {justImported.configUpdated ? ' + agent config' : ''} updated.
              </span>
            </div>
          )}
          {/* What the next round will do — the old dispatch card's compact summary. */}
          <div className="space-y-1.5 text-sm">
            <div className="flex gap-2">
              <span className="text-gray-400 w-20 shrink-0">Focus</span>
              {prepping ? (
                <span className="text-gray-400 italic">Summarizing… ✨ send anytime — you&apos;re CC&apos;d.</span>
              ) : (
                <span className="text-gray-700">{focusLine}</span>
              )}
            </div>
            {openerPreview && (
              <div className="flex gap-2 min-w-0">
                <span className="text-gray-400 w-20 shrink-0">Opens with</span>
                <span className="text-gray-500 truncate">{openerPreview}</span>
              </div>
            )}
          </div>
          <p className="text-sm text-gray-600">
            This <span className="font-medium text-gray-900">closes the current conversation</span> and starts a fresh
            one (#{sessionNumber}). Everyone on the brief moves to the new conversation.
          </p>
          {actionError && <StatusMessage type="error" message={actionError.message || 'Failed'} />}
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            {onOpenImport && (
              <button
                onClick={() => { close(); onOpenImport() }}
                disabled={busy}
                className="flex items-center gap-1.5 text-xs text-gray-500 hover:text-brand-navy disabled:opacity-40"
              >
                <Upload className="h-3.5 w-3.5" /> Load a next-convo payload first
              </button>
            )}
            <button
              onClick={() => { close(); onShare('add') }}
              disabled={busy}
              className="flex items-center gap-1.5 text-xs text-gray-500 hover:text-brand-navy disabled:opacity-40"
            >
              <UserPlus className="h-3.5 w-3.5" /> Invite someone to this conversation instead
            </button>
          </div>
          <div className="flex justify-end gap-2 pt-1">
            <button
              onClick={handleCopy}
              disabled={busy}
              className="px-3 py-2 text-sm text-gray-600 hover:text-gray-800 disabled:opacity-50 flex items-center gap-1.5"
            >
              <Copy className="h-3.5 w-3.5" /> Start &amp; copy nudge
            </button>
            <LoadingButton variant="primary" loading={busy} loadingText="Working…" icon={Send} onClick={handleSend} disabled={!canSend}>
              Start conversation {sessionNumber}
            </LoadingButton>
          </div>
          <p className="text-xs text-gray-400">Edit how the agent behaves in the Agent setup tab.</p>
        </div>
      </Modal>
    </>
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
