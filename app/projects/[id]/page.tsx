'use client'

import { useAuth } from '@/lib/hooks/useAuth'
import { useApproval } from '@/lib/hooks/useApproval'
import {
  useProject,
  useBrief,
  useSessions,
  useMessages,
  useClaimProject,
  useDeleteMessage,
  useUpdateProject,
  useGenerateWelcome,
  useShareProject,
  useCreateSession,
} from '@/lib/query/hooks'
import { useRouter, useParams } from 'next/navigation'
import { useEffect, useState, useRef, useCallback } from 'react'
import { MessageSquare, Send, ArrowLeft, FileText, Calendar, Trash2, Sparkles, Plus, X, Share2, ChevronDown, ChevronUp, Copy, Check, Mail, RotateCw, Lock } from 'lucide-react'
import { BuildTimestamp } from '@/components/build-timestamp'
import { apiFetch } from '@/lib/firebase/api-fetch'
import { isAdminEmail } from '@/lib/constants'
import { useQueryClient } from '@tanstack/react-query'
import { StatusMessage } from '@/components/ui/StatusMessage'
import { Card, CardBody } from '@/components/ui/Card'
import { Skeleton } from '@/components/ui/Skeleton'
import { LoadingButton } from '@/components/ui/LoadingButton'
import type { BriefContent, Session } from '@/lib/types'

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

  return <ProjectHub projectId={projectId} userEmail={user.email || ''} />
}

function ProjectHub({ projectId, userEmail }: { projectId: string; userEmail: string }) {
  const router = useRouter()
  const claimProject = useClaimProject()
  const { data: project, isLoading: projectLoading } = useProject(projectId)
  const { data: brief } = useBrief(projectId)
  const { data: sessions } = useSessions(projectId)
  const activeSession = sessions?.find((s) => s.status === 'active') || sessions?.[0]
  const { data: messages } = useMessages(activeSession?.id)
  const isAdmin = isAdminEmail(userEmail)

  // Auto-claim on mount
  useEffect(() => {
    claimProject.mutate(projectId)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId])

  const briefContent = brief?.content as BriefContent | undefined
  const isUnshared = isAdmin && project && !project.requester_email

  // Derive workflow state
  const hasSetup = !!(project?.welcome_message || (project?.seed_questions && project.seed_questions.length > 0))
  const isShared = !!project?.requester_email
  // A conversation has happened if: current session has user messages, OR there are completed sessions
  const hasUserMessages = !!(messages && messages.some((m) => m.role === 'user'))
  const hasCompletedSessions = !!(sessions && sessions.some((s) => s.status === 'completed'))
  const hasConversation = hasUserMessages || hasCompletedSessions
  const hasBrief = !!(briefContent && hasBriefContent(briefContent))

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
            {project.requester_email && (
              <span>Maker: {project.requester_email}</span>
            )}
          </div>
        ) : null}

        {/* Workflow status — admin only */}
        {isAdmin && project && !projectLoading && (
          <WorkflowStatus
            hasSetup={hasSetup}
            isShared={isShared}
            hasConversation={hasConversation}
            hasBrief={hasBrief}
          />
        )}

        {/* Admin setup — only before conversation starts */}
        {isAdmin && project && !projectLoading && !hasConversation && (
          <AdminSetup project={project} isUnshared={!!isUnshared} />
        )}

        {/* After conversation: locked session config + prep next session */}
        {isAdmin && project && !projectLoading && hasConversation && activeSession && (
          <>
            <SessionConfig session={activeSession} sessionNumber={sessions?.length || 1} />
            <PrepNextSession project={project} projectId={projectId} sessionNumber={(sessions?.length || 1) + 1} />
          </>
        )}

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
          <ChatSection projectId={projectId} userEmail={userEmail} isAdmin={isAdmin} />
        </div>

        {/* Export — admin only */}
        {isAdmin && project && !projectLoading && (
          <ExportSection project={project} briefContent={briefContent || null} projectId={projectId} />
        )}
      </main>
    </div>
  )
}

type WorkflowStep = { label: string; who: string; done: boolean; active: boolean }

function WorkflowStatus({ hasSetup, isShared, hasConversation, hasBrief }: {
  hasSetup: boolean; isShared: boolean; hasConversation: boolean; hasBrief: boolean
}) {
  const steps: WorkflowStep[] = [
    { label: 'Setup', who: 'Builder', done: hasSetup || isShared, active: !hasSetup && !isShared },
    { label: 'Share', who: 'Builder', done: isShared, active: hasSetup && !isShared },
    { label: 'Conversation', who: 'Maker', done: hasConversation, active: isShared && !hasConversation },
    { label: 'Brief', who: 'Auto', done: hasBrief, active: hasConversation && !hasBrief },
    { label: 'Review', who: 'Builder', done: false, active: hasBrief },
  ]

  return (
    <div className="flex items-center gap-1">
      {steps.map((step, i) => (
        <div key={step.label} className="flex items-center">
          {i > 0 && (
            <div className={`w-4 h-px mx-0.5 ${step.done || steps[i - 1].done ? 'bg-green-300' : 'bg-gray-200'}`} />
          )}
          <div className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium ${
            step.done
              ? 'bg-green-100 text-green-700'
              : step.active
                ? 'bg-brand-navy/10 text-brand-navy ring-1 ring-brand-navy/20'
                : 'bg-gray-100 text-gray-400'
          }`}>
            {step.done && <span>&#10003;</span>}
            {step.active && <span className="w-1.5 h-1.5 rounded-full bg-brand-navy animate-pulse" />}
            <span>{step.label}</span>
            <span className={`text-[10px] ${step.done ? 'text-green-500' : step.active ? 'text-brand-navy/60' : 'text-gray-300'}`}>
              {step.who}
            </span>
          </div>
        </div>
      ))}
    </div>
  )
}

function AdminSetup({ project, isUnshared }: { project: { id: string; title: string; welcome_message?: string; seed_questions?: string[]; style_guide?: string; context?: string; session_mode?: 'discover' | 'converge'; builder_directives?: string[] }; isUnshared: boolean }) {
  const [expanded, setExpanded] = useState(isUnshared)
  const [welcomeMessage, setWelcomeMessage] = useState(project.welcome_message || '')
  const [seedQuestions, setSeedQuestions] = useState<string[]>(project.seed_questions || [])
  const [newQuestion, setNewQuestion] = useState('')
  const [styleGuide, setStyleGuide] = useState(project.style_guide || '')
  const [sessionMode, setSessionMode] = useState<'discover' | 'converge'>(project.session_mode || 'discover')
  const [directives, setDirectives] = useState<string[]>(project.builder_directives || [])
  const [newDirective, setNewDirective] = useState('')
  const [shareEmail, setShareEmail] = useState('')
  const [saved, setSaved] = useState(false)
  const [linkCopied, setLinkCopied] = useState(false)
  const [emailCopied, setEmailCopied] = useState(false)

  const updateProject = useUpdateProject()
  const generateWelcome = useGenerateWelcome()
  const shareProject = useShareProject()

  const shareLink = typeof window !== 'undefined'
    ? `${window.location.origin}/projects/${project.id}`
    : ''

  // Sync from project data when it changes
  useEffect(() => {
    setWelcomeMessage(project.welcome_message || '')
    setSeedQuestions(project.seed_questions || [])
    setStyleGuide(project.style_guide || '')
    setSessionMode(project.session_mode || 'discover')
    setDirectives(project.builder_directives || [])
  }, [project.welcome_message, project.seed_questions, project.style_guide, project.session_mode, project.builder_directives])

  const handleSave = async () => {
    await updateProject.mutateAsync({
      project_id: project.id,
      welcome_message: welcomeMessage,
      seed_questions: seedQuestions,
      style_guide: styleGuide,
      session_mode: sessionMode,
      builder_directives: directives,
    })
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  const handleGenerateWelcome = async () => {
    const result = await generateWelcome.mutateAsync(project.id)
    setWelcomeMessage(result.welcome_message)
  }

  const handleAddQuestion = () => {
    if (!newQuestion.trim()) return
    setSeedQuestions((prev) => [...prev, newQuestion.trim()])
    setNewQuestion('')
  }

  const handleRemoveQuestion = (index: number) => {
    setSeedQuestions((prev) => prev.filter((_, i) => i !== index))
  }

  const handleAddDirective = () => {
    if (!newDirective.trim()) return
    setDirectives((prev) => [...prev, newDirective.trim()])
    setNewDirective('')
  }

  const handleRemoveDirective = (index: number) => {
    setDirectives((prev) => prev.filter((_, i) => i !== index))
  }

  const handleShare = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!shareEmail.trim()) return
    // Save setup first, then share
    await updateProject.mutateAsync({
      project_id: project.id,
      welcome_message: welcomeMessage,
      seed_questions: seedQuestions,
      style_guide: styleGuide,
      session_mode: sessionMode,
      builder_directives: directives,
    })
    await shareProject.mutateAsync({ project_id: project.id, email: shareEmail.trim() })
  }

  return (
    <Card hover={false}>
      <CardBody>
        <button
          onClick={() => setExpanded(!expanded)}
          className="w-full flex items-center justify-between"
        >
          <h2 className="text-sm font-semibold text-brand-slate uppercase tracking-wide flex items-center gap-1.5">
            <Sparkles className="h-4 w-4" />
            {isUnshared ? 'Setup before sharing' : 'Agent setup'}
          </h2>
          {expanded ? <ChevronUp className="h-4 w-4 text-gray-400" /> : <ChevronDown className="h-4 w-4 text-gray-400" />}
        </button>

        {expanded && (
          <div className="mt-4 space-y-5">
            {/* Welcome message */}
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="text-sm font-medium text-gray-700">Welcome message</label>
                <LoadingButton
                  variant="ghost"
                  size="sm"
                  loading={generateWelcome.isPending}
                  loadingText="Generating..."
                  onClick={handleGenerateWelcome}
                  icon={Sparkles}
                >
                  {welcomeMessage ? 'Regenerate' : 'Generate'}
                </LoadingButton>
              </div>
              <textarea
                value={welcomeMessage}
                onChange={(e) => setWelcomeMessage(e.target.value)}
                placeholder="The maker will see this message when they first open the project. Generate one or write your own."
                rows={4}
                className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-brand-navy focus:border-brand-navy"
              />
            </div>

            {/* Session mode toggle */}
            <div>
              <label className="text-sm font-medium text-gray-700 block mb-1.5">Session mode</label>
              <div className="flex gap-2">
                <button
                  onClick={() => setSessionMode('discover')}
                  className={`flex-1 px-3 py-2 rounded-md text-sm font-medium transition-colors ${
                    sessionMode === 'discover'
                      ? 'bg-brand-navy text-white'
                      : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                  }`}
                >
                  Discover
                </button>
                <button
                  onClick={() => setSessionMode('converge')}
                  className={`flex-1 px-3 py-2 rounded-md text-sm font-medium transition-colors ${
                    sessionMode === 'converge'
                      ? 'bg-brand-navy text-white'
                      : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                  }`}
                >
                  Converge
                </button>
              </div>
              <p className="text-xs text-gray-500 mt-1">
                {sessionMode === 'discover'
                  ? 'Broad exploration — the agent asks open-ended questions'
                  : 'Push for decisions — the agent narrows scope and presents options'}
              </p>
            </div>

            {/* Seed questions (discover mode) */}
            {sessionMode === 'discover' && (
              <div>
                <label className="text-sm font-medium text-gray-700 block mb-1.5">Seed questions</label>
                <p className="text-xs text-gray-500 mb-2">Questions the agent should weave into the conversation early on.</p>
                {seedQuestions.length > 0 && (
                  <ul className="space-y-1.5 mb-2">
                    {seedQuestions.map((q, i) => (
                      <li key={i} className="flex items-start gap-2 text-sm text-gray-700 bg-gray-50 rounded px-2.5 py-1.5">
                        <span className="text-gray-400 text-xs mt-0.5">{i + 1}.</span>
                        <span className="flex-1">{q}</span>
                        <button
                          onClick={() => handleRemoveQuestion(i)}
                          className="p-0.5 text-gray-400 hover:text-red-500 shrink-0"
                        >
                          <X className="h-3.5 w-3.5" />
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={newQuestion}
                    onChange={(e) => setNewQuestion(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleAddQuestion() } }}
                    placeholder="What does a typical day look like for you?"
                    className="flex-1 px-3 py-1.5 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-brand-navy focus:border-brand-navy"
                  />
                  <button
                    onClick={handleAddQuestion}
                    disabled={!newQuestion.trim()}
                    className="p-1.5 text-gray-400 hover:text-brand-navy hover:bg-gray-100 rounded disabled:opacity-40"
                  >
                    <Plus className="h-4 w-4" />
                  </button>
                </div>
              </div>
            )}

            {/* Builder directives (converge mode) */}
            {sessionMode === 'converge' && (
              <div>
                <label className="text-sm font-medium text-gray-700 block mb-1.5">Builder directives</label>
                <p className="text-xs text-gray-500 mb-2">Things the agent should actively drive toward. It will not leave the session without covering these.</p>
                {directives.length > 0 && (
                  <ul className="space-y-1.5 mb-2">
                    {directives.map((d, i) => (
                      <li key={i} className="flex items-start gap-2 text-sm text-gray-700 bg-gray-50 rounded px-2.5 py-1.5">
                        <span className="text-gray-400 text-xs mt-0.5">{i + 1}.</span>
                        <span className="flex-1">{d}</span>
                        <button
                          onClick={() => handleRemoveDirective(i)}
                          className="p-0.5 text-gray-400 hover:text-red-500 shrink-0"
                        >
                          <X className="h-3.5 w-3.5" />
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={newDirective}
                    onChange={(e) => setNewDirective(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleAddDirective() } }}
                    placeholder="Get them to pick 1-2 tickers to start with"
                    className="flex-1 px-3 py-1.5 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-brand-navy focus:border-brand-navy"
                  />
                  <button
                    onClick={handleAddDirective}
                    disabled={!newDirective.trim()}
                    className="p-1.5 text-gray-400 hover:text-brand-navy hover:bg-gray-100 rounded disabled:opacity-40"
                  >
                    <Plus className="h-4 w-4" />
                  </button>
                </div>
              </div>
            )}

            {/* Style guide */}
            <div>
              <label className="text-sm font-medium text-gray-700 block mb-1.5">Style guide</label>
              <textarea
                value={styleGuide}
                onChange={(e) => setStyleGuide(e.target.value)}
                placeholder="Jamie isn't technical at all — keep it super simple. She thinks in terms of her bakery workflow, not app features. Be warm and encouraging."
                rows={3}
                className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-brand-navy focus:border-brand-navy"
              />
            </div>

            {/* Save + Share */}
            <div className="flex items-center justify-between pt-2 border-t border-gray-100">
              <div className="flex items-center gap-2">
                <LoadingButton
                  variant="secondary"
                  size="sm"
                  loading={updateProject.isPending}
                  loadingText="Saving..."
                  onClick={handleSave}
                >
                  {saved ? 'Saved!' : 'Save setup'}
                </LoadingButton>
                {updateProject.error && (
                  <span className="text-xs text-red-500">{updateProject.error.message}</span>
                )}
              </div>

              <form onSubmit={handleShare} className="flex items-center gap-2">
                <input
                  type="email"
                  value={shareEmail}
                  onChange={(e) => setShareEmail(e.target.value)}
                  placeholder="maker@email.com"
                  className="px-2.5 py-1.5 border border-gray-300 rounded-md text-sm w-48 focus:outline-none focus:ring-2 focus:ring-brand-navy focus:border-brand-navy"
                />
                <LoadingButton
                  type="submit"
                  variant="primary"
                  size="sm"
                  loading={shareProject.isPending}
                  loadingText="Sharing..."
                  disabled={!shareEmail.trim()}
                  icon={Share2}
                >
                  {isUnshared ? 'Share' : 'Reshare'}
                </LoadingButton>
              </form>
            </div>

            {shareProject.isSuccess && (
              <div className="space-y-3 p-3 bg-green-50 border border-green-200 rounded-lg">
                <p className="text-sm font-medium text-green-800">
                  Shared with {shareEmail}! Send them the link and invite email below.
                </p>

                {/* Copy link */}
                <div>
                  <p className="text-xs text-gray-600 mb-1">Project link</p>
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      readOnly
                      value={shareLink}
                      className="flex-1 px-2.5 py-1.5 bg-white border border-gray-300 rounded-md text-sm text-gray-700"
                    />
                    <button
                      onClick={async () => {
                        await navigator.clipboard.writeText(shareLink)
                        setLinkCopied(true)
                        setTimeout(() => setLinkCopied(false), 2000)
                      }}
                      className="p-1.5 text-gray-500 hover:text-brand-navy hover:bg-white rounded"
                    >
                      {linkCopied ? <Check className="h-4 w-4 text-green-500" /> : <Copy className="h-4 w-4" />}
                    </button>
                  </div>
                </div>

                {/* Invite email */}
                <div>
                  <p className="text-xs text-gray-600 mb-1 flex items-center gap-1">
                    <Mail className="h-3.5 w-3.5" />
                    Invite email
                  </p>
                  <textarea
                    readOnly
                    value={`Hey! I've set up a project for you on iBuild4you — it's a tool that helps figure out exactly what you want built through a simple conversation.\n\nHere's your link:\n${shareLink}\n\nJust sign in with your email (${shareEmail}) and you'll see a chat waiting for you. Answer a few questions about your idea and it'll start putting together a project brief.\n\nNo rush — you can come back anytime to pick up where you left off.`}
                    rows={8}
                    className="w-full px-2.5 py-1.5 bg-white border border-gray-300 rounded-md text-sm text-gray-700 resize-none"
                  />
                  <button
                    onClick={async () => {
                      await navigator.clipboard.writeText(`Hey! I've set up a project for you on iBuild4you — it's a tool that helps figure out exactly what you want built through a simple conversation.\n\nHere's your link:\n${shareLink}\n\nJust sign in with your email (${shareEmail}) and you'll see a chat waiting for you. Answer a few questions about your idea and it'll start putting together a project brief.\n\nNo rush — you can come back anytime to pick up where you left off.`)
                      setEmailCopied(true)
                      setTimeout(() => setEmailCopied(false), 2000)
                    }}
                    className="mt-1 flex items-center gap-1.5 text-xs text-gray-500 hover:text-brand-navy"
                  >
                    {emailCopied ? <Check className="h-3.5 w-3.5 text-green-500" /> : <Copy className="h-3.5 w-3.5" />}
                    {emailCopied ? 'Copied!' : 'Copy email'}
                  </button>
                </div>
              </div>
            )}
            {shareProject.error && (
              <StatusMessage type="error" message={shareProject.error.message} />
            )}
          </div>
        )}
      </CardBody>
    </Card>
  )
}

function SessionConfig({ session, sessionNumber }: { session: Session; sessionNumber: number }) {
  const [expanded, setExpanded] = useState(false)
  const mode = session.session_mode || 'discover'
  const questions = session.seed_questions || []
  const dirs = session.builder_directives || []
  const guide = session.style_guide || ''

  const hasConfig = mode || questions.length > 0 || dirs.length > 0 || guide

  if (!hasConfig) return null

  return (
    <Card hover={false}>
      <CardBody>
        <button
          onClick={() => setExpanded(!expanded)}
          className="w-full flex items-center justify-between"
        >
          <h2 className="text-sm font-semibold text-brand-slate uppercase tracking-wide flex items-center gap-1.5">
            <Lock className="h-4 w-4" />
            Session {sessionNumber} setup
          </h2>
          <div className="flex items-center gap-2">
            {session.token_usage_input != null && (
              <span className="text-[10px] text-gray-400">
                {((session.token_usage_input + (session.token_usage_output || 0)) / 1000).toFixed(1)}k tokens
              </span>
            )}
            <span className="text-xs text-gray-400 bg-gray-100 px-2 py-0.5 rounded">{mode}</span>
            {expanded ? <ChevronUp className="h-4 w-4 text-gray-400" /> : <ChevronDown className="h-4 w-4 text-gray-400" />}
          </div>
        </button>

        {expanded && (
          <div className="mt-4 space-y-3 text-sm text-gray-700">
            {mode === 'discover' && questions.length > 0 && (
              <div>
                <p className="text-xs font-medium text-gray-500 uppercase mb-1">Seed questions</p>
                <ul className="space-y-1">
                  {questions.map((q, i) => (
                    <li key={i} className="bg-gray-50 rounded px-2.5 py-1.5 text-sm">{i + 1}. {q}</li>
                  ))}
                </ul>
              </div>
            )}
            {mode === 'converge' && dirs.length > 0 && (
              <div>
                <p className="text-xs font-medium text-gray-500 uppercase mb-1">Builder directives</p>
                <ul className="space-y-1">
                  {dirs.map((d, i) => (
                    <li key={i} className="bg-gray-50 rounded px-2.5 py-1.5 text-sm">{i + 1}. {d}</li>
                  ))}
                </ul>
              </div>
            )}
            {guide && (
              <div>
                <p className="text-xs font-medium text-gray-500 uppercase mb-1">Style guide</p>
                <p className="bg-gray-50 rounded px-2.5 py-1.5">{guide}</p>
              </div>
            )}
            {session.model && (
              <p className="text-xs text-gray-400">Model: {session.model}</p>
            )}
          </div>
        )}
      </CardBody>
    </Card>
  )
}

function PrepNextSession({ project, projectId, sessionNumber }: {
  project: { id: string; title: string; requester_email?: string; welcome_message?: string; seed_questions?: string[]; style_guide?: string; session_mode?: 'discover' | 'converge'; builder_directives?: string[] }
  projectId: string
  sessionNumber: number
}) {
  const [expanded, setExpanded] = useState(false)
  const [sessionMode, setSessionMode] = useState<'discover' | 'converge'>(project.session_mode || 'discover')
  const [welcomeMessage, setWelcomeMessage] = useState(project.welcome_message || '')
  const [seedQuestions, setSeedQuestions] = useState<string[]>(project.seed_questions || [])
  const [newQuestion, setNewQuestion] = useState('')
  const [directives, setDirectives] = useState<string[]>(project.builder_directives || [])
  const [newDirective, setNewDirective] = useState('')
  const [styleGuide, setStyleGuide] = useState(project.style_guide || '')
  const [nudgeNote, setNudgeNote] = useState('')
  const [created, setCreated] = useState(false)
  const [nudgeCopied, setNudgeCopied] = useState(false)

  const updateProject = useUpdateProject()
  const generateWelcome = useGenerateWelcome()
  const createSession = useCreateSession()

  const shareLink = typeof window !== 'undefined'
    ? `${window.location.origin}/projects/${projectId}`
    : ''
  const makerEmail = project.requester_email || ''

  useEffect(() => {
    setWelcomeMessage(project.welcome_message || '')
    setSeedQuestions(project.seed_questions || [])
    setStyleGuide(project.style_guide || '')
    setSessionMode(project.session_mode || 'discover')
    setDirectives(project.builder_directives || [])
  }, [project.welcome_message, project.seed_questions, project.style_guide, project.session_mode, project.builder_directives])

  const handleAddQuestion = () => {
    if (!newQuestion.trim()) return
    setSeedQuestions((prev) => [...prev, newQuestion.trim()])
    setNewQuestion('')
  }
  const handleRemoveQuestion = (index: number) => setSeedQuestions((prev) => prev.filter((_, i) => i !== index))
  const handleAddDirective = () => {
    if (!newDirective.trim()) return
    setDirectives((prev) => [...prev, newDirective.trim()])
    setNewDirective('')
  }
  const handleRemoveDirective = (index: number) => setDirectives((prev) => prev.filter((_, i) => i !== index))

  const handleCreate = async () => {
    // Save config to project (staging area), then create session (snapshots it)
    await updateProject.mutateAsync({
      project_id: project.id,
      welcome_message: welcomeMessage,
      seed_questions: seedQuestions,
      style_guide: styleGuide,
      session_mode: sessionMode,
      builder_directives: directives,
    })
    await createSession.mutateAsync({ project_id: projectId })
    setCreated(true)
  }

  const modeLabel = sessionMode === 'converge'
    ? 'This time we want to narrow things down and lock in some decisions.'
    : 'We want to dig deeper into a few things from last time.'

  const nudgeMessage = [
    `Hey! Thanks for the last conversation about ${project.title} — really helpful.`,
    '',
    nudgeNote || modeLabel,
    '',
    `Same link as before:`,
    shareLink,
    '',
    `Just sign in when you have a few minutes — there'll be a fresh chat ready to go.`,
  ].join('\n')

  if (created) {
    return (
      <Card hover={false}>
        <CardBody>
          <h2 className="text-sm font-semibold text-brand-slate uppercase tracking-wide flex items-center gap-1.5 mb-3">
            <Check className="h-4 w-4 text-green-600" />
            Session {sessionNumber} ready
          </h2>
          <div className="space-y-3 p-3 bg-green-50 border border-green-200 rounded-lg">
            <p className="text-sm font-medium text-green-800">
              New session created. Send {makerEmail} this message:
            </p>
            <textarea
              readOnly
              value={nudgeMessage}
              rows={6}
              className="w-full px-2.5 py-1.5 bg-white border border-gray-300 rounded-md text-sm text-gray-700 resize-none"
            />
            <button
              onClick={async () => {
                await navigator.clipboard.writeText(nudgeMessage)
                setNudgeCopied(true)
                setTimeout(() => setNudgeCopied(false), 2000)
              }}
              className="flex items-center gap-1.5 text-xs text-gray-500 hover:text-brand-navy"
            >
              {nudgeCopied ? <Check className="h-3.5 w-3.5 text-green-500" /> : <Copy className="h-3.5 w-3.5" />}
              {nudgeCopied ? 'Copied!' : 'Copy message'}
            </button>
          </div>
        </CardBody>
      </Card>
    )
  }

  return (
    <Card hover={false}>
      <CardBody>
        <button
          onClick={() => setExpanded(!expanded)}
          className="w-full flex items-center justify-between"
        >
          <h2 className="text-sm font-semibold text-brand-slate uppercase tracking-wide flex items-center gap-1.5">
            <RotateCw className="h-4 w-4" />
            Prep session {sessionNumber}
          </h2>
          {expanded ? <ChevronUp className="h-4 w-4 text-gray-400" /> : <ChevronDown className="h-4 w-4 text-gray-400" />}
        </button>

        {expanded && (
          <div className="mt-4 space-y-5">
            {/* Session mode toggle */}
            <div>
              <label className="text-sm font-medium text-gray-700 block mb-1.5">Session mode</label>
              <div className="flex gap-2">
                <button
                  onClick={() => setSessionMode('discover')}
                  className={`flex-1 px-3 py-2 rounded-md text-sm font-medium transition-colors ${
                    sessionMode === 'discover'
                      ? 'bg-brand-navy text-white'
                      : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                  }`}
                >
                  Discover
                </button>
                <button
                  onClick={() => setSessionMode('converge')}
                  className={`flex-1 px-3 py-2 rounded-md text-sm font-medium transition-colors ${
                    sessionMode === 'converge'
                      ? 'bg-brand-navy text-white'
                      : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                  }`}
                >
                  Converge
                </button>
              </div>
              <p className="text-xs text-gray-500 mt-1">
                {sessionMode === 'discover'
                  ? 'Broad exploration — the agent asks open-ended questions'
                  : 'Push for decisions — the agent narrows scope and presents options'}
              </p>
            </div>

            {/* Seed questions (discover) */}
            {sessionMode === 'discover' && (
              <div>
                <label className="text-sm font-medium text-gray-700 block mb-1.5">Seed questions</label>
                <p className="text-xs text-gray-500 mb-2">Questions the agent should weave into the conversation early on.</p>
                {seedQuestions.length > 0 && (
                  <ul className="space-y-1.5 mb-2">
                    {seedQuestions.map((q, i) => (
                      <li key={i} className="flex items-start gap-2 text-sm text-gray-700 bg-gray-50 rounded px-2.5 py-1.5">
                        <span className="text-gray-400 text-xs mt-0.5">{i + 1}.</span>
                        <span className="flex-1">{q}</span>
                        <button onClick={() => handleRemoveQuestion(i)} className="p-0.5 text-gray-400 hover:text-red-500 shrink-0">
                          <X className="h-3.5 w-3.5" />
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={newQuestion}
                    onChange={(e) => setNewQuestion(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleAddQuestion() } }}
                    placeholder="What does a typical day look like for you?"
                    className="flex-1 px-3 py-1.5 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-brand-navy focus:border-brand-navy"
                  />
                  <button onClick={handleAddQuestion} disabled={!newQuestion.trim()} className="p-1.5 text-gray-400 hover:text-brand-navy hover:bg-gray-100 rounded disabled:opacity-40">
                    <Plus className="h-4 w-4" />
                  </button>
                </div>
              </div>
            )}

            {/* Builder directives (converge) */}
            {sessionMode === 'converge' && (
              <div>
                <label className="text-sm font-medium text-gray-700 block mb-1.5">Builder directives</label>
                <p className="text-xs text-gray-500 mb-2">Things the agent should actively drive toward. It will not leave the session without covering these.</p>
                {directives.length > 0 && (
                  <ul className="space-y-1.5 mb-2">
                    {directives.map((d, i) => (
                      <li key={i} className="flex items-start gap-2 text-sm text-gray-700 bg-gray-50 rounded px-2.5 py-1.5">
                        <span className="text-gray-400 text-xs mt-0.5">{i + 1}.</span>
                        <span className="flex-1">{d}</span>
                        <button onClick={() => handleRemoveDirective(i)} className="p-0.5 text-gray-400 hover:text-red-500 shrink-0">
                          <X className="h-3.5 w-3.5" />
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={newDirective}
                    onChange={(e) => setNewDirective(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleAddDirective() } }}
                    placeholder="Get them to pick 1-2 tickers to start with"
                    className="flex-1 px-3 py-1.5 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-brand-navy focus:border-brand-navy"
                  />
                  <button onClick={handleAddDirective} disabled={!newDirective.trim()} className="p-1.5 text-gray-400 hover:text-brand-navy hover:bg-gray-100 rounded disabled:opacity-40">
                    <Plus className="h-4 w-4" />
                  </button>
                </div>
              </div>
            )}

            {/* Welcome message */}
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="text-sm font-medium text-gray-700">Welcome message</label>
                <LoadingButton
                  variant="ghost"
                  size="sm"
                  loading={generateWelcome.isPending}
                  loadingText="Generating..."
                  onClick={async () => {
                    const result = await generateWelcome.mutateAsync(project.id)
                    setWelcomeMessage(result.welcome_message)
                  }}
                  icon={Sparkles}
                >
                  {welcomeMessage ? 'Regenerate' : 'Generate'}
                </LoadingButton>
              </div>
              <textarea
                value={welcomeMessage}
                onChange={(e) => setWelcomeMessage(e.target.value)}
                placeholder="The maker will see this message when they open the new session."
                rows={3}
                className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-brand-navy focus:border-brand-navy"
              />
            </div>

            {/* Style guide */}
            <div>
              <label className="text-sm font-medium text-gray-700 block mb-1.5">Style guide</label>
              <textarea
                value={styleGuide}
                onChange={(e) => setStyleGuide(e.target.value)}
                placeholder="Tone and approach notes for communicating with this maker."
                rows={2}
                className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-brand-navy focus:border-brand-navy"
              />
            </div>

            {/* Nudge note + create */}
            <div className="pt-3 border-t border-gray-100 space-y-3">
              <div>
                <label className="text-sm font-medium text-gray-700 block mb-1.5">Note for {makerEmail} (optional)</label>
                <textarea
                  value={nudgeNote}
                  onChange={(e) => setNudgeNote(e.target.value)}
                  placeholder="This time we'll narrow down which data sources to use and pick a few tickers to start with."
                  rows={2}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-brand-navy focus:border-brand-navy"
                />
              </div>
              <LoadingButton
                variant="primary"
                size="sm"
                loading={updateProject.isPending || createSession.isPending}
                loadingText="Creating session..."
                onClick={handleCreate}
                icon={RotateCw}
              >
                Create session {sessionNumber} & copy nudge
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

function ExportSection({ project, briefContent, projectId }: {
  project: { title: string; context?: string; seed_questions?: string[]; style_guide?: string }
  briefContent: BriefContent | null
  projectId: string
}) {
  const [convCopied, setConvCopied] = useState(false)
  const [briefCopied, setBriefCopied] = useState(false)
  const { data: sessions } = useSessions(projectId)
  const activeSession = sessions?.find((s) => s.status === 'active') || sessions?.[0]
  const { data: messages } = useMessages(activeSession?.id)

  const formatConversation = () => {
    const lines: string[] = [`# ${project.title}`, '']
    if (project.context) {
      lines.push(`## Context`, project.context, '')
    }
    if (project.style_guide) {
      lines.push(`## Style guide`, project.style_guide, '')
    }
    if (project.seed_questions?.length) {
      lines.push(`## Seed questions`, ...project.seed_questions.map((q, i) => `${i + 1}. ${q}`), '')
    }
    lines.push(`## Conversation`, '')
    if (messages) {
      for (const msg of messages) {
        const sender = msg.role === 'agent' ? 'Agent' : (msg.sender_email || 'User')
        lines.push(`**${sender}:** ${msg.content}`, '')
      }
    }
    return lines.join('\n')
  }

  const formatBrief = () => {
    if (!briefContent) return ''
    const sections: string[] = [`# Brief: ${project.title}`, '']
    if (briefContent.problem) sections.push(`## Problem`, briefContent.problem, '')
    if (briefContent.target_users) sections.push(`## Target users`, briefContent.target_users, '')
    if (briefContent.features?.length) {
      sections.push(`## Features`, ...briefContent.features.map((f) => `- ${f}`), '')
    }
    if (briefContent.constraints) sections.push(`## Constraints`, briefContent.constraints, '')
    if (briefContent.additional_context) sections.push(`## Additional context`, briefContent.additional_context, '')
    if (briefContent.decisions && briefContent.decisions.length > 0) {
      sections.push(`## Decisions`, ...briefContent.decisions.map((d) => `- **${d.topic}:** ${d.decision}`), '')
    }
    return sections.join('\n')
  }

  const handleCopyConversation = async () => {
    await navigator.clipboard.writeText(formatConversation())
    setConvCopied(true)
    setTimeout(() => setConvCopied(false), 2000)
  }

  const handleCopyBrief = async () => {
    await navigator.clipboard.writeText(formatBrief())
    setBriefCopied(true)
    setTimeout(() => setBriefCopied(false), 2000)
  }

  return (
    <div className="flex items-center gap-3 pt-2 border-t border-gray-200">
      <span className="text-xs text-gray-400 uppercase tracking-wide">Export</span>
      <button
        onClick={handleCopyConversation}
        disabled={!messages?.length}
        className="flex items-center gap-1.5 text-xs text-gray-500 hover:text-brand-navy disabled:opacity-40 disabled:cursor-not-allowed"
      >
        {convCopied ? <Check className="h-3.5 w-3.5 text-green-500" /> : <Copy className="h-3.5 w-3.5" />}
        {convCopied ? 'Copied!' : 'Conversation'}
      </button>
      <button
        onClick={handleCopyBrief}
        disabled={!briefContent || !hasBriefContent(briefContent)}
        className="flex items-center gap-1.5 text-xs text-gray-500 hover:text-brand-navy disabled:opacity-40 disabled:cursor-not-allowed"
      >
        {briefCopied ? <Check className="h-3.5 w-3.5 text-green-500" /> : <Copy className="h-3.5 w-3.5" />}
        {briefCopied ? 'Copied!' : 'Brief'}
      </button>
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
  if (content.decisions && content.decisions.length > 0) {
    parts.push(`${content.decisions.length} decision${content.decisions.length === 1 ? '' : 's'} made`)
  }

  return (
    <p className="text-sm text-gray-700 leading-relaxed">
      {parts.join(' · ')}
    </p>
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

function ChatSection({ projectId, userEmail, isAdmin }: { projectId: string; userEmail: string; isAdmin: boolean }) {
  const queryClient = useQueryClient()
  const { data: sessions, isLoading: sessionsLoading } = useSessions(projectId)
  const activeSession = sessions?.find((s) => s.status === 'active') || sessions?.[0]
  const sessionId = activeSession?.id

  const { data: savedMessages, isLoading: messagesLoading } = useMessages(sessionId)

  type ChatMessage = { id?: string; role: 'user' | 'agent'; content: string; created_at?: string; sender_email?: string }
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState('')
  const [streaming, setStreaming] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const lastBriefUpdate = useRef<number>(0)
  const briefTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const deleteMessage = useDeleteMessage()

  // Sync saved messages into local state
  useEffect(() => {
    if (savedMessages) {
      setMessages(savedMessages.map((m) => ({ id: m.id, role: m.role, content: m.content, created_at: m.created_at, sender_email: m.sender_email })))
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

    const nowIso = new Date().toISOString()
    setMessages((prev) => [...prev, { role: 'user', content: userMessage, created_at: nowIso, sender_email: userEmail }])
    setMessages((prev) => [...prev, { role: 'agent', content: '', created_at: nowIso }])
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
              key={msg.id || i}
              className={`group flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
            >
              <div
                className={`relative max-w-[80%] rounded-lg px-4 py-2.5 ${
                  msg.role === 'user'
                    ? 'bg-brand-navy text-white'
                    : 'bg-white border border-gray-200 text-gray-800'
                }`}
              >
                <p className={`text-[10px] mb-1 ${
                  msg.role === 'user' ? 'text-blue-200' : 'text-gray-400'
                }`}>
                  {msg.role === 'user' ? (msg.sender_email || userEmail) : 'iBuild4you assistant'}
                  {msg.created_at ? ` · ${formatTimestamp(msg.created_at)}` : ''}
                </p>
                <p className="whitespace-pre-wrap text-sm leading-relaxed">{msg.content}</p>
                {isAdmin && msg.id && sessionId && (
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
    </div>
  )
}

function formatTimestamp(iso: string): string {
  const date = new Date(iso)
  const now = new Date()
  const isToday = date.toDateString() === now.toDateString()

  const time = date.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  })

  if (isToday) return time

  return `${date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} ${time}`
}
