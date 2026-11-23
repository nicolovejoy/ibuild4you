'use client'

import { useState, useEffect, useRef } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import {
  ArrowLeft, MessageSquare, Send, FileText, X,
  Share2, ChevronDown, ChevronUp, Copy, Check, Mail, RotateCw,
  Trash2, Settings, Upload, Users, UserPlus, NotebookPen,
} from 'lucide-react'
import { BuildTimestamp } from '@/components/build-timestamp'
import { Skeleton } from '@/components/ui/Skeleton'
import { StatusMessage } from '@/components/ui/StatusMessage'
import { Button } from '@/components/ui/Button'
import { LoadingButton } from '@/components/ui/LoadingButton'
import { EmptyState } from '@/components/ui/EmptyState'
import { MessageContent } from '@/components/ui/MessageContent'
import { parseNextConvoPayload, nextConvoImportWarnings, type NextConvoPayload } from '@/lib/api/import-payload'
import { briefSizeWarning, regenFailureNotice } from '@/lib/agent/brief-size'
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
  useShareProject,
  useChangeRequesterEmail,
  useCreateSession,
  useProjectFiles,
  useProjectMembers,
  useSendMakerEmail,
  useGeneratePrep,
  useCurrentUser,
  useBriefNotes,
  StalePrepError,
  PatchDropUnmatchedError,
  type StalePrepInfo,
} from '@/lib/query/hooks'
import { buildNextConvoPrompt } from '@/lib/agent/next-convo-prompt'
import { copy } from '@/lib/copy'
import { outboundCopyFor } from '@/lib/email/outbound-copy'
import { formatCostUsd } from '@/lib/observability/session-cost'
import { briefRoleLabel, briefRoleShort, viewerBriefRole } from '@/lib/roles/display'
import { apiFetch } from '@/lib/firebase/api-fetch'
import { useRealtimeMessages } from '@/lib/hooks/useRealtimeMessages'
import {
  makerRoster,
  getDispatchState,
  conversationLabel,
  remindersStripLine,
} from '@/lib/builder/conversations-view'
import { useQueryClient } from '@tanstack/react-query'
import { queryKeys } from '@/lib/query/keys'
import { BuilderFilesTab } from './BuilderFilesTab'
import { BriefEditor } from './BriefEditor'
import { FerryDesk } from './FerryDesk'
import { ConversationComposer } from './ConversationComposer'
import { SettingsTab } from './SettingsTab'
import { NextRoundPanel } from './NextRoundPanel'
import { OpenQuestionsCard } from './OpenQuestionsCard'
import { StalePrepNotice, UnfoldedNotesList } from './BriefNotes'
import { makerQuestions, riskOwner, riskText } from '@/lib/brief/risks'
import { latestShipped } from '@/lib/brief/shipped'
import { hasBriefContent } from '@/lib/brief/has-content'
import { ferryStamps } from '@/lib/builder/ferry-stamps'
import { getTurnIndicator } from '@/lib/turn-indicator'
import { TurnBadge } from '@/components/ui/TurnBadge'
import { BriefSwitcher } from '@/components/brief-switcher'
import { resolveBuilderTab, DEFAULT_BUILDER_TAB, type BuilderTabId } from '@/lib/projects/project-view'
import type { Project, Session, BriefContent, BriefNote, BuildReport, ProjectFile } from '@/lib/types'

// Builder nav is Brief · Conversations · Settings. #120 made Conversations
// reader-first (the transcript is the page). Settings holds the people on the
// brief and the standing settings (SettingsTab); the per-round agent config is
// set by each paste and shown read only on Conversations (NextRoundPanel).
// Opening a brief lands on Brief; see resolveBuilderTab for the URL rules.
type TabId = BuilderTabId

// What a saved brief remembers for the retry of a paste whose config PATCH failed.
type SavedBrief = {
  text: string
  version: number | undefined
  locks_kept?: string[]
  size_warning?: string | null
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
  // 'maker' = first share / re-share the originator (link view).
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
  const activeTab: TabId = resolveBuilderTab(searchParams.get('tab'), searchParams.get('session'))

  const setTab = (tab: TabId) => {
    const params = new URLSearchParams(searchParams.toString())
    if (tab === DEFAULT_BUILDER_TAB) {
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
    { id: 'settings', label: 'Settings', shortLabel: 'Settings', Icon: Settings, tooltip: copy.glossary.settings.short },
  ]

  const viewerRole = viewerBriefRole(project?.viewer_role, project?.viewer_brief_role)
  const activeLabel = tabs.find((tab) => tab.id === activeTab)?.label ?? ''

  // The brief's title, click to rename. It sits in the rail on desktop (light
  // on indigo) and in the top bar on a phone (dark on white).
  const titleControl = (onDark: boolean) =>
    editingTitle ? (
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
        className={`font-heading font-semibold bg-transparent border-b-2 outline-none px-0 py-0 min-w-0 w-full ${
          onDark ? 'text-white border-white' : 'text-brand-charcoal border-brand-navy'
        }`}
        autoFocus
      />
    ) : (
      <button
        onClick={() => { setTitleDraft(project?.title || ''); setEditingTitle(true) }}
        className={`font-heading font-semibold cursor-text text-left min-w-0 ${
          onDark
            ? 'text-white leading-snug break-words hover:text-brand-rail-text'
            : 'text-brand-charcoal truncate hover:text-brand-navy'
        }`}
        title={copy.builderShell.renameTitle}
      >
        {projectLoading ? '...' : project?.title}
      </button>
    )

  return (
    // Builder view: operator-console layout. Indigo side rail on desktop,
    // bottom tab bar on phone, ivory ground. The chrome itself is the loudest
    // signal that this is a different surface from the maker chat view.
    <div className="min-h-screen bg-background md:flex">
      {/* Desktop side rail: back, which brief this is, then the tabs */}
      <aside className="hidden md:flex md:flex-col gap-6 w-[208px] px-3 py-5 bg-brand-rail text-brand-rail-text sticky top-0 h-screen shrink-0 z-10">
        <button
          onClick={() => router.push('/dashboard')}
          className="flex items-center gap-2 px-2 min-h-7 text-[13px] text-brand-rail-muted hover:text-white transition-colors"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden />
          <span>{copy.builderShell.back}</span>
        </button>
        <div className="px-2 space-y-1.5">
          <div className="flex items-start gap-2 min-w-0">
            <span className="mt-0.5 shrink-0">
              <BriefSwitcher currentId={project?.id} currentTitle={project?.title} loading={projectLoading} compact />
            </span>
            {titleControl(true)}
          </div>
          <p className="text-xs text-brand-rail-muted" title={briefRoleShort(viewerRole)}>
            {copy.builderShell.roleLine[viewerRole]}
          </p>
        </div>
        <nav className="flex flex-col gap-0.5">
          {tabs.map(({ id, label, Icon, tooltip }) => (
            <button
              key={id}
              onClick={() => setTab(id)}
              title={tooltip}
              aria-current={activeTab === id ? 'page' : undefined}
              className={`w-full flex items-center gap-3 px-3 h-11 rounded-lg text-sm transition-colors ${
                activeTab === id
                  ? 'bg-brand-cream text-brand-rail font-semibold'
                  : 'text-brand-rail-text hover:bg-white/10 hover:text-white'
              }`}
            >
              <Icon className="h-4 w-4 shrink-0" aria-hidden />
              <span className="truncate">{label}</span>
            </button>
          ))}
        </nav>
      </aside>

      {/* Main column */}
      <div className="flex-1 min-w-0 pb-20 md:pb-0">
        {/* Phone-only top bar: back and which brief this is. On desktop the rail says it. */}
        <header className="md:hidden bg-white border-b border-brand-line sticky top-0 z-10">
          <div className="px-3 py-2.5 flex items-center gap-2 min-w-0">
            <button
              onClick={() => router.push('/dashboard')}
              aria-label={copy.builderShell.back}
              className="p-2 -ml-1 hover:bg-brand-bubble rounded-lg shrink-0"
            >
              <ArrowLeft className="h-5 w-5 text-brand-ink-soft" aria-hidden />
            </button>
            <BriefSwitcher currentId={project?.id} currentTitle={project?.title} loading={projectLoading} compact />
            {titleControl(false)}
          </div>
        </header>

        <main className="max-w-4xl px-4 sm:px-8 py-6 md:py-10">
          {/* Page heading: which tab, whose turn, who it is shared with */}
          <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-2 mb-5">
            <div className="group relative min-w-0">
              <h1 className="text-2xl md:text-[26px] font-semibold text-brand-charcoal">{activeLabel}</h1>
              {project && (
                <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] text-brand-ink-soft">
                  <span className="md:hidden" title={briefRoleShort(viewerRole)}>
                    {copy.builderShell.roleLine[viewerRole]}
                  </span>
                  {project.requester_email ? (
                    <button
                      onClick={() => openShare('maker')}
                      className="flex items-center gap-1.5 hover:text-brand-navy transition-colors"
                    >
                      <Share2 className="h-3.5 w-3.5" aria-hidden />
                      <span>{project.requester_first_name ? `${project.requester_first_name}${project.requester_last_name ? ` ${project.requester_last_name.charAt(0)}` : ''}` : project.requester_email?.split('@')[0]}</span>
                    </button>
                  ) : (
                    <button
                      onClick={() => openShare('maker')}
                      className="flex items-center gap-1.5 text-brand-navy hover:text-brand-navy-light transition-colors font-semibold"
                    >
                      <Share2 className="h-3.5 w-3.5" aria-hidden />
                      Share
                    </button>
                  )}
                  {sessions && <span>{sessions.length} session{sessions.length === 1 ? '' : 's'}</span>}
                  <BuildTimestamp />
                </div>
              )}
            </div>
            {/* Conversations shows whose turn it is in its own status row. */}
            {turn && activeTab !== 'conversations' && (
              <TurnBadge turn={turn} className={`text-xs px-2.5 py-1 rounded-full font-medium shrink-0 ${turn.className}`} />
            )}
          </div>

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
          {activeTab === 'settings' && (
            project ? (
              <SettingsTab project={project} onShare={openShare} onGoToConversations={() => setTab('conversations')} />
            ) : (
              <Skeleton className="h-64 w-full rounded-xl" />
            )
          )}
        </main>
      </div>

      {/* Mobile bottom tab bar */}
      <nav className="md:hidden fixed bottom-0 left-0 right-0 bg-brand-rail text-brand-rail-text grid grid-cols-3 z-20">
        {tabs.map(({ id, shortLabel, Icon }) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            aria-current={activeTab === id ? 'page' : undefined}
            className={`flex flex-col items-center justify-center py-2 text-[11px] gap-0.5 transition-colors ${
              activeTab === id ? 'text-white font-semibold' : 'text-brand-rail-muted hover:text-white'
            }`}
          >
            <Icon className="h-5 w-5" aria-hidden />
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
          className="scrollbar-visible max-h-[65vh] overflow-y-auto space-y-3 rounded-xl border border-brand-line bg-white p-3"
        >
          {messages.map((msg) => (
            <div
              key={msg.id}
              className={`group flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
            >
              <div className={`relative max-w-[80%] rounded-lg px-4 py-2.5 ${
                msg.role === 'user'
                  ? 'bg-brand-navy text-white'
                  : 'bg-brand-bubble text-brand-charcoal'
              }`}>
                <p className={`text-[10px] mb-1 ${msg.role === 'user' ? 'text-brand-rail-muted' : 'text-brand-ink-soft'}`}>
                  {msg.role === 'user' ? (msg.sender_display_name || msg.sender_email?.split('@')[0] || 'Maker') : copy.chat.agentLabel}
                  {msg.created_at ? ` · ${formatTimestamp(msg.created_at)}` : ''}
                  {/* Maker's rating (#130) — quiet signal for the builder */}
                  {msg.role === 'agent' && msg.rating ? (msg.rating === 'up' ? ' · 👍' : ' · 👎') : ''}
                  {msg.role === 'agent' && msg.rating === 'down' && msg.rating_reason ? ` “${msg.rating_reason}”` : ''}
                </p>
                <MessageContent content={msg.content} />
                <button
                  onClick={() => deleteMessage.mutate({ messageId: msg.id, sessionId })}
                  className="absolute -top-2 -right-2 p-1 bg-white border border-brand-line rounded-full text-gray-400 hover:text-red-600 hover:border-red-200 opacity-0 group-hover:opacity-100 transition-opacity shadow-sm"
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
    <div className="border-t border-brand-line-soft pt-3 mt-3">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-1.5 text-xs text-gray-400 hover:text-brand-ink-soft"
      >
        <Settings className="h-3.5 w-3.5" />
        Config used
        <span className="bg-gray-100 px-1.5 py-0.5 rounded text-[10px]">{mode}</span>
        {expanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
      </button>
      {expanded && (
        <div className="mt-2 space-y-2 text-sm text-brand-ink-soft">
          {session.welcome_message && (
            <div>
              <p className="text-xs font-semibold text-brand-ink-soft mb-1">Opening message</p>
              <p className="text-sm text-gray-700 bg-brand-bubble rounded px-2.5 py-1.5 whitespace-pre-wrap">{session.welcome_message}</p>
            </div>
          )}
          {questions.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-brand-ink-soft mb-1">Seed questions{mode === 'converge' && <span className="font-normal text-gray-400"> (not sent in converge mode)</span>}</p>
              <ul className="space-y-1">
                {questions.map((q, i) => <li key={i} className="bg-brand-bubble rounded px-2.5 py-1.5 text-sm">{i + 1}. {q}</li>)}
              </ul>
            </div>
          )}
          {dirs.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-brand-ink-soft mb-1">Builder directives{mode === 'discover' && <span className="font-normal text-gray-400"> (not sent in discover mode)</span>}</p>
              <ul className="space-y-1">
                {dirs.map((d, i) => <li key={i} className="bg-brand-bubble rounded px-2.5 py-1.5 text-sm">{i + 1}. {d}</li>)}
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
  brief: { version: number; content: BriefContent; updated_at?: string } | null | undefined
  briefLoading?: boolean
  project: Project | undefined
  files?: ProjectFile[]
  onImported?: (r: { configUpdated: boolean }) => void
  autoOpenImport?: boolean
  onAutoOpenConsumed?: () => void
}) {
  const [payloadCopied, setPayloadCopied] = useState(false)
  const [briefCopied, setBriefCopied] = useState(false)
  const [pasteJson, setPasteJson] = useState('')
  const [pasteError, setPasteError] = useState<string | null>(null)
  const [importWarnings, setImportWarnings] = useState<{ messages: string[]; configUpdated: boolean } | null>(null)
  const [showGenConfirm, setShowGenConfirm] = useState(false)
  const queryClient = useQueryClient()
  const [generating, setGenerating] = useState(false)
  const [genError, setGenError] = useState<string | null>(null)
  // #276: the writer answered but wrote no note (nothing relevant). Shown in the
  // dialog, which stays open, so the builder is not left to think a note exists.
  const [genNothingRelevant, setGenNothingRelevant] = useState(false)
  // #229: a paste the server refused as a stale prep (409). Keeps the payload
  // as parsed, so Save anyway resends exactly that with force: true.
  const [stalePrep, setStalePrep] = useState<{ info: StalePrepInfo; payload: NextConvoPayload } | null>(null)
  // A paste whose brief saved but whose config PATCH failed: the text and the
  // version it saved. The next Import of the same text skips the brief save, so
  // a retry cannot save the brief twice. Cleared on success or when the text changes.
  // The first save's answers ride along, so a retry after a failed config PATCH
  // still shows its lock and size warnings.
  const savedBriefRef = useRef<SavedBrief | null>(null)
  const { data: briefNotes } = useBriefNotes(projectId)
  const [loadingPayload, setLoadingPayload] = useState(false)
  // Copy prep failed (nothing on the clipboard): shown in the desk's notices.
  const [copyPrepError, setCopyPrepError] = useState<string | null>(null)
  // Shown after a copy that had no unfolded notes to carry and/or carried build
  // reports (cleared on the next copy).
  const [copyPrepNotice, setCopyPrepNotice] = useState<string | null>(null)
  // Covers the whole import (brief save + optional config PATCH + paste
  // stamp), not just the brief mutation.
  const [importing, setImporting] = useState(false)
  const router = useRouter()
  const updateBrief = useUpdateBrief()
  const updateProject = useUpdateProject()
  // #121: session id → conversation number, for decision-provenance suffixes in
  // the read view and the markdown copy. Query is shared with the other tabs.
  const { data: briefTabSessions } = useSessions(projectId)

  const briefContent = brief?.content as BriefContent | undefined
  const regenNotice = project ? regenFailureNotice(project, brief?.updated_at) : null
  // The live brief is close to (or over) the curation budget the comms agent
  // works to (lib/agent/brief-size.ts). Shown whenever the tab is open, not
  // only right after a paste, so an oversized brief is visible before the
  // next prep.
  const sizeNotice = briefContent ? briefSizeWarning(briefContent) : null
  const hasBrief = briefContent && hasBriefContent(briefContent)

  // Arriving via the dispatch modal's "load a payload" link (#115): scroll to
  // the ferry desk + focus its paste box, then consume the one-shot flag.
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

  // "Write note now" (#229): runs the note writer over the conversation since
  // the last note. It writes a note, not the brief (except a lock contest).
  const handleGenerate = async () => {
    setGenerating(true)
    setGenError(null)
    setGenNothingRelevant(false)
    try {
      const res = await apiFetch('/api/briefs/notes', {
        method: 'POST',
        body: JSON.stringify({ project_id: projectId }),
      })
      if (!res.ok) {
        setGenError(res.status === 400 ? copy.brief.writeNoteNothingNew : copy.brief.writeNoteFailed)
        return
      }
      queryClient.invalidateQueries({ queryKey: queryKeys.brief(projectId) })
      queryClient.invalidateQueries({ queryKey: queryKeys.briefVersions(projectId) })
      queryClient.invalidateQueries({ queryKey: queryKeys.briefNotes(projectId) })
      // note_id is null when the stretch had nothing relevant: no note exists.
      const { note_id } = (await res.json()) as { note_id: string | null }
      if (note_id === null) {
        setGenNothingRelevant(true)
        return
      }
      setShowGenConfirm(false)
    } catch (err) {
      console.error('Writing the note failed:', err)
      setGenError(copy.brief.writeNoteFailed)
    } finally {
      setGenerating(false)
    }
  }

  const handleCopyPayload = async () => {
    // Never build the prep prompt without the loaded project (no "Untitled" fallback).
    if (!project) return
    setLoadingPayload(true)
    setCopyPrepError(null)
    setCopyPrepNotice(null)
    try {
      // #229: the prep carries the brief plus the notes not yet folded into
      // it (no transcript), and a stamp the paste guard checks on the way back.
      const notesRes = await apiFetch(`/api/briefs/notes?project_id=${projectId}`)
      if (!notesRes.ok) throw new Error('Failed to load brief notes')
      const { brief_version, notes } = (await notesRes.json()) as {
        brief_version: number
        notes: BriefNote[]
      }

      // The stamp's version must describe the brief text in the prep. If the
      // live brief moved on since the tab loaded it (e.g. a note contested a
      // lock), read the live one rather than stamp old text with a new version.
      let liveContent = briefContent
      if (brief_version !== (brief?.version ?? 0)) {
        const briefRes = await apiFetch(`/api/briefs?project_id=${projectId}`)
        if (!briefRes.ok) throw new Error('Failed to load brief')
        const live = (await briefRes.json()) as { version: number; content: BriefContent } | null
        if ((live?.version ?? 0) !== brief_version) {
          // Moved again between the two reads: stamp and text would disagree.
          queryClient.invalidateQueries({ queryKey: ['brief', projectId] })
          setCopyPrepError(copy.brief.copyPrepBriefChanged)
          return
        }
        liveContent = live?.content
        queryClient.invalidateQueries({ queryKey: ['brief', projectId] })
      }
      const currentBrief: BriefContent | null =
        liveContent && hasBriefContent(liveContent) ? liveContent : null

      // Build reports from Code, read fresh like the notes (not from the
      // cache). A failed read stops the copy: a prep that silently lacks the
      // reports would read as "no new build news". Done before the clipboard
      // write so a failure leaves the clipboard untouched.
      let reportsRes: Response
      try {
        reportsRes = await apiFetch(`/api/build-status?project_id=${projectId}`)
      } catch {
        reportsRes = new Response(null, { status: 500 })
      }
      if (!reportsRes.ok) {
        setCopyPrepError(copy.brief.copyPrepReportsFailed)
        return
      }
      const { reports, latest_posted_at } = (await reportsRes.json()) as {
        reports: BuildReport[]
        latest_posted_at: string | null
      }

      // The session count comes from the page's sessions query. While that
      // query has no data (still loading, or it failed) the count is unknown,
      // not zero: a prep once said "Sessions so far: 0" on a project with 26
      // conversations. Read the sessions here in that case; if that fails too,
      // the prep leaves the line out.
      let sessionCount: number | undefined = briefTabSessions?.length
      if (sessionCount === undefined) {
        try {
          const sessionsRes = await apiFetch(`/api/sessions?project_id=${projectId}`)
          if (sessionsRes.ok) {
            const list = (await sessionsRes.json()) as unknown
            if (Array.isArray(list)) sessionCount = list.length
          }
        } catch {
          // Count stays unknown.
        }
      }

      // The stamp lists EVERY unfolded report, including any the prompt leaves
      // out for length: the paste folds exactly the ids the stamp carries.
      const prompt = buildNextConvoPrompt({
        currentBrief,
        notes,
        stamp: {
          brief_version,
          note_ids: notes.map((n) => n.id),
          report_ids: reports.map((r) => r.id),
        },
        reports,
        latestReportAt: latest_posted_at,
        projectTitle: project.title,
        sessionCount,
        language: project.language,
      })

      await navigator.clipboard.writeText(prompt)
      setPayloadCopied(true)
      setTimeout(() => setPayloadCopied(false), 2000)
      // Both notices can apply; the no-new-notes one comes first. With reports
      // the prep is not "only the brief as it stands", so its shorter form is used.
      const notices: string[] = []
      if (notes.length === 0) {
        notices.push(
          reports.length > 0 ? copy.brief.copyPrepNoNewNotesWithReports : copy.brief.copyPrepNoNewNotes
        )
      }
      if (reports.length > 0) notices.push(copy.brief.copyPrepReports(reports.length))
      if (notices.length > 0) setCopyPrepNotice(notices.join(' '))
      // "Prep copied" stamp. Fire-and-forget: a failed stamp write must not
      // undo or hide a copy that already landed on the clipboard.
      updateProject.mutate(
        { project_id: projectId, prep_copied_at: new Date().toISOString() },
        { onError: (err) => console.error('Failed to write prep_copied_at stamp:', err) }
      )
    } catch (err) {
      console.error('Failed to copy payload:', err)
      setCopyPrepError(copy.brief.copyPrepFailed)
    } finally {
      setLoadingPayload(false)
    }
  }

  const handleImportJson = async () => {
    setPasteError(null)
    setImportWarnings(null)
    setStalePrep(null)
    const result = parseNextConvoPayload(pasteJson)
    if (!result.ok) {
      setPasteError(result.error)
      return
    }
    await savePayload(result.value, false)
  }

  // Save a parsed payload. `force` is the stale-prep 409's Save anyway: the
  // same payload and stamp, resent so the server saves despite missed notes.
  const savePayload = async (payload: NextConvoPayload, force: boolean) => {
    setImporting(true)
    // Set once the brief is saved, so a later failure can be told apart.
    let briefSaved: SavedBrief | null = null
    try {
      let configUpdated = false
      let warnings: string[] = []
      // What the brief save answered (or, on a retry, what the first save answered).
      let saved: { version?: number; locks_kept?: string[]; size_warning?: string | null } | undefined
      // "Payload pasted" stamp: written only once the brief save (and any
      // config PATCH) succeeded — never on a failed path. When the payload
      // carries config, it rides in that same PATCH; otherwise it is its own
      // PATCH, whose failure is only logged: the brief is already saved, so
      // a missing stamp must not read as a failed import.
      // The stamp also records the brief version this paste produced (from
      // the PUT /api/briefs result), so the desk shows "vN" for the paste
      // itself even after a later regen moves the brief on.
      const pastedAt = new Date().toISOString()
      const stampPasted = async (pastedVersion: number | undefined) => {
        try {
          await updateProject.mutateAsync({
            project_id: projectId,
            payload_pasted_at: pastedAt,
            payload_pasted_version: pastedVersion,
          })
        } catch (err) {
          console.error('Failed to write payload_pasted_at stamp:', err)
        }
      }
      // #229: the prep stamp rides along so the server can fold the notes the
      // comms agent saw, or refuse a stale prep (409 → StalePrepError).
      const guard = { prep_stamp: payload.stamp, force }
      if (payload.mode === 'multi' || payload.mode === 'patch') {
        // Retry of a paste whose brief already saved: reuse that version, save nothing twice.
        const resume = savedBriefRef.current?.text === pasteJson ? savedBriefRef.current : null
        if (resume) {
          saved = { version: resume.version, locks_kept: resume.locks_kept, size_warning: resume.size_warning }
        } else {
          saved = await updateBrief.mutateAsync(
            payload.mode === 'patch'
              ? { project_id: projectId, patch: payload.patch, ...guard }
              : { project_id: projectId, content: payload.brief, ...guard }
          )
        }
        // From here the brief is saved. A failure below must not read as a failed
        // import, and the next Import must not save the brief again.
        briefSaved = {
          text: pasteJson,
          version: saved?.version,
          locks_kept: saved?.locks_kept,
          size_warning: saved?.size_warning,
        }
        if (Object.keys(payload.projectUpdate).length > 0) {
          await updateProject.mutateAsync({
            project_id: projectId,
            ...payload.projectUpdate,
            payload_pasted_at: pastedAt,
            payload_pasted_version: saved?.version,
          } as Parameters<typeof updateProject.mutateAsync>[0])
          configUpdated = true
        } else {
          await stampPasted(saved?.version)
        }
        // Skip while the project is unloaded: session_mode would default to
        // discover and could warn falsely.
        warnings =
          project || payload.projectUpdate.session_mode !== undefined
            ? nextConvoImportWarnings(payload.projectUpdate, project?.session_mode)
            : []
        // Locks the patch tried to change: the server kept them as they were.
        if (saved?.locks_kept?.length) warnings = [...warnings, copy.brief.patchLocksKept(saved.locks_kept)]
      } else {
        saved = await updateBrief.mutateAsync({ project_id: projectId, content: payload.brief as BriefContent, ...guard })
        await stampPasted(saved?.version)
      }
      // A payload without a prep stamp (old prep, hand-written JSON) folds no
      // notes. Say so here only: the structured editor and Restore don't warn.
      if (payload.stamp === null) warnings = [...warnings, copy.brief.pasteNotFromPrep]
      // A brief over the curation budget saves fine; it just costs every chat
      // turn and every prep more. Warn, never reject: the paste is the builder's call.
      // The server computed it on the brief as saved (a patch has no whole brief here).
      if (saved?.size_warning) warnings = [...warnings, saved.size_warning]
      savedBriefRef.current = null
      setPasteJson('')
      setStalePrep(null)
      // Ignored fields: stay on the Brief tab so the builder reads the warning.
      if (warnings.length > 0) {
        setImportWarnings({ messages: warnings, configUpdated })
        return
      }
      // Import succeeded — hand the builder to the next step instead of leaving
      // them staring at the updated brief with no cue (#25).
      onImported?.({ configUpdated })
    } catch (err) {
      if (err instanceof StalePrepError) {
        setStalePrep({ info: err.info, payload })
        return
      }
      if (err instanceof PatchDropUnmatchedError) {
        setPasteError(copy.brief.patchDropUnmatched(err.unmatched, false))
        return
      }
      if (briefSaved) {
        // The brief is in; only the config PATCH failed. Remember it for the retry.
        savedBriefRef.current = briefSaved
        console.error('Failed to save the rest of the payload:', err)
        setPasteError(copy.brief.configSaveFailedBriefSaved)
        return
      }
      setPasteError(err instanceof Error ? err.message : 'Failed to save')
    } finally {
      setImporting(false)
    }
  }

  const questions = makerQuestions(briefContent)
  const makerName = project?.requester_first_name || copy.brief.openQuestionsFallbackName

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
    if (briefContent.open_risks?.length) {
      sections.push(
        `## ${copy.brief.exportOpenRisks}`,
        ...briefContent.open_risks.map((r) => {
          const o = riskOwner(r)
          return `- ${o ? `(${o}) ` : ''}${riskText(r)}`
        }),
        '',
      )
    }
    if (briefContent.shipped?.length) {
      sections.push(`## ${copy.brief.shipped}`, '')
      for (const batch of latestShipped(briefContent.shipped, briefContent.shipped.length)) {
        sections.push(`### ${batch.date}`, ...batch.items.map((it) => `- ${it}`), '')
      }
    }
    if (briefContent.queued?.length) {
      sections.push(`## ${copy.brief.queued}`, ...briefContent.queued.map((q) => `- ${q}`), '')
    }
    return sections.join('\n')
  }

  return (
    <div className="space-y-4">
      {/* The ferry desk: stamps (prep copied / payload pasted / maker last
          active), the big paste box, Import + Copy prep. The copy-paste
          round-trip routes builder reasoning onto the Max sub (cost model);
          the metered "Write note now" lives under Details. Stamps
          are written in handleCopyPayload (prep_copied_at) and, on success
          only, in handleImportJson (payload_pasted_at). importCardRef wraps
          the desk so the dispatch modal's "load a payload" link (#115) still
          scrolls here and focuses the paste box. Copy prep is disabled (and
          handleCopyPayload no-ops) while the project is unloaded, so the
          export never says `Title: Untitled` (#215). */}
      <div ref={importCardRef}>
        <FerryDesk
          stamps={ferryStamps(project ?? {})}
          briefVersion={brief?.version ?? null}
          briefContent={briefContent ?? null}
          sessionCount={briefTabSessions?.length}
          pasteValue={pasteJson}
          onPasteChange={(v) => { setPasteJson(v); savedBriefRef.current = null; setPasteError(null); setImportWarnings(null); setStalePrep(null) }}
          pasteError={pasteError}
          importing={importing}
          onImport={handleImportJson}
          copyingPrep={loadingPayload}
          prepCopied={payloadCopied}
          onCopyPrep={handleCopyPayload}
          copyPrepDisabled={!project}
          onEscapeEmpty={() => router.push('/dashboard')}
          textareaRef={importTextareaRef}
          openQuestions={
            <OpenQuestionsCard title={project?.title ?? ''} makerName={makerName} questions={questions} />
          }
          notices={
            (copyPrepError || copyPrepNotice || regenNotice || sizeNotice || importWarnings || stalePrep) && (
              <>
                {copyPrepError && <StatusMessage type="error" message={copyPrepError} />}
                {copyPrepNotice && <StatusMessage type="info" message={copyPrepNotice} />}
                {/* #229: the server refused a stale prep; nothing was saved.
                    Save anyway resends the same parsed payload with force. */}
                {stalePrep && (
                  <StalePrepNotice
                    info={stalePrep.info}
                    saving={importing}
                    onSaveAnyway={() => savePayload(stalePrep.payload, true)}
                  />
                )}
                {/* The last automatic update failed and nothing has refreshed
                    the brief since (lib/agent/brief-size.ts). */}
                {regenNotice && <StatusMessage type="warning" message={regenNotice} />}
                {/* Brief size vs. the regen budget; skipped when the paste
                    warnings below already carry the same line. */}
                {sizeNotice && !importWarnings?.messages.includes(sizeNotice) && (
                  <StatusMessage type="warning" message={sizeNotice} />
                )}
                {/* Import succeeded but some fields were ignored (or the brief
                    is near the size limit): stay on the Brief tab so the
                    builder reads the note, then continue by hand. */}
                {importWarnings && (
                  <>
                    {importWarnings.messages.map((w) => (
                      <StatusMessage key={w} type="warning" message={w} />
                    ))}
                    <div className="flex items-center gap-3">
                      <p className="text-xs text-brand-ink-soft">{copy.brief.importStayHint}</p>
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => {
                          const { configUpdated } = importWarnings
                          setImportWarnings(null)
                          onImported?.({ configUpdated })
                        }}
                      >
                        {copy.brief.importContinueButton}
                      </Button>
                    </div>
                  </>
                )}
              </>
            )
          }
        >
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
              {hasBrief && (
                <button
                  onClick={async () => {
                    await navigator.clipboard.writeText(formatBrief())
                    setBriefCopied(true)
                    setTimeout(() => setBriefCopied(false), 2000)
                  }}
                  className="flex items-center gap-1.5 text-xs text-brand-ink-soft hover:text-brand-navy"
                >
                  {briefCopied ? <Check className="h-3.5 w-3.5 text-green-500" /> : <Copy className="h-3.5 w-3.5" />}
                  {briefCopied ? 'Copied!' : 'Copy markdown'}
                </button>
              )}
              <button
                onClick={() => { setGenError(null); setGenNothingRelevant(false); setShowGenConfirm(true) }}
                className="flex items-center gap-1.5 text-xs text-brand-ink-soft hover:text-brand-navy"
              >
                <NotebookPen className="h-3.5 w-3.5" />
                {copy.brief.writeNoteNow}
              </button>
            </div>

            <BriefEditor projectId={projectId} content={briefContent} version={brief?.version} loading={briefLoading} sessions={briefTabSessions} />

            {/* #229: notes written since the last curated paste, read-only.
                The next prep carries them; a stamped paste folds them. */}
            <UnfoldedNotesList notes={briefNotes?.notes} />

            {/* Attachments — Files folded into the Brief (#19 Phase 2). Anything
                uploaded to the brief that Sam can reference. */}
            <div className="pt-2">
              <h3 className="font-heading text-[15px] font-semibold text-brand-charcoal mb-2 flex items-center gap-1.5">
                <Upload className="h-4 w-4" />
                Attachments{files.length ? ` (${files.length})` : ''}
              </h3>
              <BuilderFilesTab projectId={projectId} files={files} />
            </div>
          </div>
        </FerryDesk>
      </div>

      {/* Confirm the metered-API note writer (#229). It writes a note, not a
          new brief, so there is nothing to copy first. */}
      <Modal isOpen={showGenConfirm} onClose={() => { if (!generating) setShowGenConfirm(false) }} title={`${copy.brief.writeNoteNow}?`} size="sm">
        <div className="space-y-4">
          <p className="text-sm text-brand-ink-soft">{copy.brief.writeNoteConfirm}</p>
          {genError && <StatusMessage type="error" message={genError} />}
          {genNothingRelevant && <StatusMessage type="info" message={copy.brief.writeNoteNothingRelevant} />}
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setShowGenConfirm(false)} disabled={generating} className="px-4 py-2 text-sm text-brand-ink-soft hover:text-gray-800 disabled:opacity-50">
              {copy.brief.writeNoteCancel}
            </button>
            <LoadingButton variant="primary" loading={generating} loadingText={copy.brief.writeNoteWriting} icon={NotebookPen} onClick={handleGenerate}>
              {copy.brief.writeNoteSubmit}
            </LoadingButton>
          </div>
        </div>
      </Modal>
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
              <h2 className="font-heading text-[15px] font-semibold text-brand-charcoal flex items-center gap-2">
                {selectedSession.status === 'active' && (
                  <span className="w-2 h-2 rounded-full bg-green-500" aria-hidden />
                )}
                {conversationLabel(numberOf(selectedSession.id), selectedSession.status)}
                {/* Token/cost is operator telemetry, not reading material — admin-only (#120). */}
                {isAdmin && selectedSession.token_usage_input != null && (
                  <span className="font-sans text-[11px] font-normal text-gray-400">
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
                      className={`min-w-9 h-8 px-2 rounded-lg text-xs font-semibold transition-colors ${
                        isSelected
                          ? 'bg-brand-navy text-white'
                          : 'bg-white border border-brand-line text-brand-ink-soft hover:text-brand-navy'
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
          {selectedSession?.status === 'active' && (
            <ConversationComposer key={`composer-${selectedSession.id}`} projectId={projectId} sessionId={selectedSession.id} />
          )}
        </div>
      )}
    </div>
  )
}

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
  const router = useRouter()
  const { data: members } = useProjectMembers(project.id)
  const { data: activeMessages } = useMessages(activeSession?.id)
  const hasUserMessages = activeMessages?.some((m) => m.role === 'user') ?? false

  const joinConversation = () => router.push(`/projects/${project.slug || project.id}?view=chat`)

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
    <>
    <div className="bg-white border border-brand-line rounded-lg px-4 py-3 space-y-2">
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
          {/* Dual-role (#110): the builder view is read-only, so this is the
              explicit way in — opens the maker chat as yourself. */}
          {activeSession && (
            <button
              onClick={() => joinConversation()}
              className="flex items-center gap-1 text-sm text-brand-navy hover:underline underline-offset-2 shrink-0"
            >
              <MessageSquare className="h-3.5 w-3.5" />
              {copy.builderChat.joinConversation}
            </button>
          )}
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
        <div className="flex items-start justify-between gap-2 text-sm border-t border-brand-line-soft pt-2">
          <div className="flex items-start gap-2">
            <Check className="h-4 w-4 text-green-600 mt-0.5 shrink-0" />
            <p>
              <span className="font-medium text-green-800">Payload loaded.</span>{' '}
              <span className="text-brand-ink-soft">
                Brief updated{justImported.configUpdated ? '; agent config applies from the next conversation' : ''}.
              </span>
            </p>
          </div>
          <button onClick={onImportedConsumed} aria-label="Dismiss" className="text-gray-400 hover:text-brand-ink-soft shrink-0">
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {result && (
        <div className="flex items-start gap-2 text-sm border-t border-brand-line-soft pt-2">
          <Check className="h-4 w-4 text-green-600 mt-0.5 shrink-0" />
          <p>
            <span className="font-medium text-green-800">Conversation {result.sessionNumber} created.</span>{' '}
            <span className="text-brand-ink-soft">
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

    {/* What the next conversation opens with. Left out while the open
        conversation waits on the maker's first reply: that round is already
        running, and its transcript shows the config it used. */}
    {dispatch.kind !== 'nudge' && (
      <NextRoundPanel
        project={project}
        sessions={sessions}
        unusedSessionId={activeSession && !hasUserMessages ? activeSession.id : null}
        onOpenImport={onOpenImport}
      />
    )}
    </>
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
  const [emailCopied, setEmailCopied] = useState(false)
  const [editingName, setEditingName] = useState(false)
  const [editFirstName, setEditFirstName] = useState(project.requester_first_name || '')
  const [editLastName, setEditLastName] = useState(project.requester_last_name || '')
  const [editingEmail, setEditingEmail] = useState(false)
  const [editEmail, setEditEmail] = useState(project.requester_email || '')
  const shareProject = useShareProject()
  const updateProject = useUpdateProject()
  const alreadyShared = !!project.requester_email
  const changeEmail = useChangeRequesterEmail()

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

  // Show the confirmation (sign-in link) after a successful share in this modal,
  // or — only in maker mode — when the brief was already shared.
  // Add mode always shows the form until the new person is actually invited.
  const showConfirmation = shareProject.isSuccess || (!isAdd && alreadyShared)
  // The first-time invite message (boilerplate + "Send invitation") belongs ONLY
  // to a fresh invite. For someone already on the brief who's opening this just to
  // grab their link, re-serving the "I'm putting together a brief…" copy
  // is the wrong tone (#19 Phase 4) — recurring contact is the Conversations
  // dispatch nudge, not the invite. So gate the invite block on a fresh share.
  const justInvited = shareProject.isSuccess
  // The person the confirmation refers to: the just-invited person on success,
  // otherwise the stored originator.
  const sharedEmail = justInvited ? email : project.requester_email || email

  const resetLink = shareProject.data?.reset_link ?? null
  const garmSyncFailed = shareProject.data?.garm_sync === 'failed'
  // Shown to the builder exactly as the maker will receive it: the brief's language.
  const inviteEmailBody = outboundCopyFor(project.language).invite.body({ projectTitle: project.title, shareLink, resetLink })

  return (
    <Modal isOpen onClose={onClose} title={isAdd ? 'Invite someone to this brief' : justInvited ? 'Share with maker' : alreadyShared ? 'Maker access' : 'Share with maker'}>
      {showConfirmation ? (
        <div className="space-y-3">
          {garmSyncFailed && <StatusMessage type="warning" message={copy.shareModal.garmSyncFailed} />}
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
                    <button onClick={() => setEditingEmail(false)} className="text-xs text-brand-ink-soft hover:text-gray-700">
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
                  {/* Correcting a typo'd email re-keys membership + approval,
                      so only offer it for an established maker — not a fresh
                      invite the builder just typed. */}
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
              <p className="text-xs text-green-700 mt-1">Changing the email moves their access — re-send the invite to the new address below.</p>
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
                <button onClick={() => setEditingName(false)} className="text-xs text-brand-ink-soft hover:text-gray-700">
                  Cancel
                </button>
              </div>
            )}
          </div>
          <div>
            <p className="text-xs text-brand-ink-soft mb-1">Brief link</p>
            <div className="flex items-center gap-2">
              <input type="text" readOnly value={shareLink} className="flex-1 px-2.5 py-1.5 bg-brand-bubble border border-brand-line-strong rounded-md text-sm text-gray-700" />
              <button onClick={async () => { await navigator.clipboard.writeText(shareLink); setLinkCopied(true); setTimeout(() => setLinkCopied(false), 2000) }} className="p-1.5 text-brand-ink-soft hover:text-brand-navy hover:bg-gray-100 rounded">
                {linkCopied ? <Check className="h-4 w-4 text-green-500" /> : <Copy className="h-4 w-4" />}
              </button>
            </div>
          </div>
          {/* First-time invite copy + send — only for a fresh invite (#19 Phase 4).
              An established maker opening this for their link sees access only;
              to contact them again, use the Conversations dispatch nudge. */}
          {justInvited ? (
            <div>
              <p className="text-xs text-brand-ink-soft mb-1 flex items-center gap-1"><Mail className="h-3.5 w-3.5" /> Invite message</p>
              <textarea readOnly value={inviteEmailBody} rows={8} className="w-full px-2.5 py-1.5 bg-brand-bubble border border-brand-line-strong rounded-md text-sm text-gray-700 resize-none" />
              <div className="mt-1 flex items-center gap-4">
                <SendToMakerButton projectId={project.id} kind="invite" makerEmail={sharedEmail} idleLabel={`Send to ${sharedEmail}`} />
                <button onClick={async () => { await navigator.clipboard.writeText(inviteEmailBody); setEmailCopied(true); setTimeout(() => setEmailCopied(false), 2000) }} className="flex items-center gap-1.5 text-xs text-brand-ink-soft hover:text-brand-navy">
                  {emailCopied ? <Check className="h-3.5 w-3.5 text-green-500" /> : <Copy className="h-3.5 w-3.5" />}
                  {emailCopied ? 'Copied!' : 'Copy message'}
                </button>
              </div>
            </div>
          ) : (
            <p className="text-xs text-brand-ink-soft">
              Already on the brief. To reach {project.requester_first_name || 'them'} again, use the send action at the
              top of <span className="font-medium text-brand-ink-soft">Conversations</span>.
            </p>
          )}
          <div className="flex justify-end">
            <button onClick={onClose} className="px-4 py-2 text-sm text-brand-ink-soft hover:text-gray-800">Done</button>
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
              className="flex-1 px-3 py-2 border border-brand-line-strong rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-brand-navy focus:border-brand-navy"
              autoFocus
            />
            <input
              type="text"
              value={lastName}
              onChange={(e) => setLastName(e.target.value)}
              placeholder="Last name"
              className="flex-1 px-3 py-2 border border-brand-line-strong rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-brand-navy focus:border-brand-navy"
            />
          </div>
          <div>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="maker@email.com"
              className="w-full px-3 py-2 border border-brand-line-strong rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-brand-navy focus:border-brand-navy"
            />
          </div>
          <div>
            <label className="block text-xs text-brand-ink-soft mb-1">Role on this brief</label>
            <select
              value={briefRole}
              onChange={(e) => setBriefRole(e.target.value as 'originator' | 'contributor')}
              className="w-full px-3 py-2 border border-brand-line-strong rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-brand-navy focus:border-brand-navy"
            >
              <option value="originator">{briefRoleLabel('originator')} — the person whose idea this is</option>
              <option value="contributor">{briefRoleLabel('contributor')} — a second person who also chats with {copy.chat.agentLabel}</option>
            </select>
          </div>
          {shareProject.error && <StatusMessage type="error" message={shareProject.error.message} />}
          <div className="flex justify-end gap-2">
            <button type="button" onClick={onClose} className="px-4 py-2 text-sm text-brand-ink-soft hover:text-gray-800">Cancel</button>
            <LoadingButton type="submit" variant="primary" loading={shareProject.isPending} loadingText="Sharing..." disabled={!email.trim()} icon={Share2}>
              Share
            </LoadingButton>
          </div>
        </form>
      )}
      {changeEmail.error && <StatusMessage type="error" message={changeEmail.error.message} />}
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
          <p className="text-sm text-brand-ink-soft">
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
              className="px-4 py-2 text-sm text-brand-ink-soft hover:text-gray-800 disabled:opacity-50"
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
  const reminderMessage = outboundCopyFor(project.language).nudge.reminder({
    firstName: project.requester_first_name || null,
    sessionNumber,
    projectTitle: project.title,
    shareLink,
    canReply: true,
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
          <p className="text-sm text-brand-ink-soft">No reply yet in conversation {sessionNumber}. Send a reminder:</p>
          <textarea
            readOnly
            value={reminderMessage}
            rows={3}
            className="w-full px-2.5 py-1.5 bg-brand-bubble border border-brand-line-strong rounded-md text-sm text-gray-700 resize-none"
          />
          {sendEmail.isError && <StatusMessage type="error" message={sendEmail.error.message} />}
          <div className="flex items-center justify-end gap-4">
            <button
              onClick={() => copyNudge(reminderMessage)}
              className="flex items-center gap-1.5 text-xs text-brand-ink-soft hover:text-brand-navy"
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
    : outboundCopyFor(project.language).nudge.body({ projectTitle: project.title, shareLink, sessionMode })

  // The agent config comes from the last paste; the dispatch just creates
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
                <span className="text-brand-ink-soft truncate">{openerPreview}</span>
              </div>
            )}
          </div>
          <p className="text-sm text-brand-ink-soft">
            This <span className="font-medium text-gray-900">closes the current conversation</span> and starts a fresh
            one (#{sessionNumber}). Everyone on the brief moves to the new conversation.
          </p>
          {actionError && <StatusMessage type="error" message={actionError.message || 'Failed'} />}
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            {onOpenImport && (
              <button
                onClick={() => { close(); onOpenImport() }}
                disabled={busy}
                className="flex items-center gap-1.5 text-xs text-brand-ink-soft hover:text-brand-navy disabled:opacity-40"
              >
                <Upload className="h-3.5 w-3.5" /> Load a next-convo payload first
              </button>
            )}
            <button
              onClick={() => { close(); onShare('add') }}
              disabled={busy}
              className="flex items-center gap-1.5 text-xs text-brand-ink-soft hover:text-brand-navy disabled:opacity-40"
            >
              <UserPlus className="h-3.5 w-3.5" /> Invite someone to this conversation instead
            </button>
          </div>
          <div className="flex justify-end gap-2 pt-1">
            <button
              onClick={handleCopy}
              disabled={busy}
              className="px-3 py-2 text-sm text-brand-ink-soft hover:text-gray-800 disabled:opacity-50 flex items-center gap-1.5"
            >
              <Copy className="h-3.5 w-3.5" /> Start &amp; copy nudge
            </button>
            <LoadingButton variant="primary" loading={busy} loadingText="Working…" icon={Send} onClick={handleSend} disabled={!canSend}>
              Start conversation {sessionNumber}
            </LoadingButton>
          </div>
          <p className="text-xs text-gray-400">{copy.nextRound.startHint}</p>
        </div>
      </Modal>
    </>
  )
}

// --- Helpers ---

function formatTimestamp(iso: string): string {
  const date = new Date(iso)
  const now = new Date()
  const isToday = date.toDateString() === now.toDateString()
  const time = date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })
  if (isToday) return time
  return `${date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} ${time}`
}
