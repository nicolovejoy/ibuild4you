'use client'

import { useAuth } from '@/lib/hooks/useAuth'
import { useApproval } from '@/lib/hooks/useApproval'
import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Plus, FolderOpen, Share2, Copy, Check, Mail, Settings, ChevronRight, ChevronDown, Archive, ArchiveRestore } from 'lucide-react'
import { SiteHeader } from '@/components/site-header'
import { useProjects, useCreateProject, useShareProject, useCurrentUser, useArchiveProject } from '@/lib/query/hooks'
import { LoadingButton } from '@/components/ui/LoadingButton'
import { Card, CardBody } from '@/components/ui/Card'
import { EmptyState } from '@/components/ui/EmptyState'
import { StatusMessage } from '@/components/ui/StatusMessage'
import { Skeleton } from '@/components/ui/Skeleton'
import { Modal } from '@/components/ui/Modal'
import type { Project } from '@/lib/types'
import { getTurnIndicator } from '@/lib/turn-indicator'
import { TurnBadge } from '@/components/ui/TurnBadge'
import { BriefBadge } from '@/components/ui/BriefBadge'
import { RoleGlyph } from '@/components/ui/RoleGlyph'
import { briefIdentity } from '@/lib/brief-identity'
import { copy, formatDisplayName, getMakerShortName } from '@/lib/copy'
import { viewerBriefRole } from '@/lib/roles/display'
import { groupBriefs, shouldFlatten, type SectionKey } from '@/lib/dashboard/group-briefs'
import { getProjectShareLink } from '@/lib/url'
import { parseNewProjectPayload } from '@/lib/api/import-payload'
import { parseLooseJson } from '@/lib/utils'
import { buildNewProjectPrompt } from '@/lib/agent/new-project-prompt'

export default function DashboardPage() {
  const { user, loading: authLoading, isAuthenticated } = useAuth()
  const { approved, loading: approvalLoading } = useApproval()
  const { data: currentUser } = useCurrentUser()
  const router = useRouter()

  useEffect(() => {
    if (!authLoading && !isAuthenticated) {
      router.push('/auth/login')
    }
  }, [authLoading, isAuthenticated, router])

  useEffect(() => {
    if (!approvalLoading && approved === false && isAuthenticated) {
      router.push('/not-approved')
    }
  }, [approvalLoading, approved, isAuthenticated, router])

  if (authLoading || approvalLoading) {
    return (
      <div className="min-h-screen bg-brand-cream flex items-center justify-center">
        <div className="animate-pulse text-brand-slate">Loading...</div>
      </div>
    )
  }

  if (!user || !approved) return null

  const isAdmin = currentUser?.system_roles?.includes('admin') ?? false

  // Theme dashboard by who's looking at it. Admin/builders get the dark
  // slate "operator console" that matches the builder side rail. Pure makers
  // keep the warm cream — their dashboard is just "briefs I was invited into".
  const pageBg = isAdmin ? 'bg-slate-900' : 'bg-brand-cream'
  const headingColor = isAdmin ? 'text-white' : 'text-gray-900'
  const adminBtnColor = isAdmin
    ? 'text-slate-400 hover:text-white hover:bg-slate-800'
    : 'text-gray-400 hover:text-brand-navy hover:bg-gray-100'

  return (
    <div className={`min-h-screen ${pageBg}`}>
      <SiteHeader />

      <main className="max-w-4xl mx-auto px-4 py-8">
        <div className="flex items-center justify-between mb-6">
          <h2 className={`text-2xl font-semibold ${headingColor}`}>{copy.dashboard.title}</h2>
          {isAdmin && (
            <div className="flex items-center gap-2">
              <Link
                href="/admin"
                className={`p-2 rounded-lg transition-colors ${adminBtnColor}`}
                title="Admin"
              >
                <Settings className="h-5 w-5" />
              </Link>
              <NewProjectButton />
            </div>
          )}
        </div>
        <ProjectList isAdmin={isAdmin} />
      </main>
    </div>
  )
}

function NewProjectButton() {
  const [showForm, setShowForm] = useState(false)
  const [mode, setMode] = useState<'form' | 'import'>('form')
  const [title, setTitle] = useState('')
  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [email, setEmail] = useState('')
  const [context, setContext] = useState('')
  const [jsonInput, setJsonInput] = useState('')
  const [jsonError, setJsonError] = useState<string | null>(null)
  const [prepCopied, setPrepCopied] = useState(false)
  const createProject = useCreateProject()
  const router = useRouter()

  const handleCopyPrep = async () => {
    await navigator.clipboard.writeText(buildNewProjectPrompt())
    setPrepCopied(true)
    setTimeout(() => setPrepCopied(false), 2000)
  }

  const resetAndClose = () => {
    setTitle('')
    setFirstName('')
    setLastName('')
    setEmail('')
    setContext('')
    setJsonInput('')
    setJsonError(null)
    setPrepCopied(false)
    setMode('form')
    setShowForm(false)
  }

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!title.trim()) return

    try {
      const result = await createProject.mutateAsync({
        title: title.trim(),
        ...(firstName.trim() && { requester_first_name: firstName.trim() }),
        ...(lastName.trim() && { requester_last_name: lastName.trim() }),
        ...(email.trim() && { requester_email: email.trim() }),
        ...(context.trim() && { context: context.trim() }),
      })
      resetAndClose()
      router.push(`/projects/${result.slug || result.id}?tab=conversations`)
    } catch {
      // error is available via createProject.error
    }
  }

  const handleImport = async () => {
    setJsonError(null)
    const parsed = parseNewProjectPayload(jsonInput)
    if (!parsed.ok) {
      setJsonError(parsed.error)
      return
    }

    try {
      const result = await createProject.mutateAsync(parsed.value)
      resetAndClose()
      router.push(`/projects/${result.slug || result.id}?tab=conversations`)
    } catch {
      // error is available via createProject.error
    }
  }

  const jsonPreview = (() => {
    if (!jsonInput.trim()) return null
    try {
      const obj = parseLooseJson(jsonInput) as {
        title?: string
        requester_email?: string
        session_mode?: string
        seed_questions?: unknown
        builder_directives?: unknown
        welcome_message?: string
        session_opener?: string
        layout_mockups?: unknown
        brief?: unknown
      }
      if (!obj?.title) return null
      const fields: string[] = []
      if (obj.requester_email) fields.push(obj.requester_email)
      if (obj.session_mode) fields.push(obj.session_mode)
      if (Array.isArray(obj.seed_questions)) fields.push(`${obj.seed_questions.length} seed questions`)
      if (Array.isArray(obj.builder_directives)) fields.push(`${obj.builder_directives.length} directives`)
      if (obj.welcome_message || obj.session_opener) fields.push('welcome message')
      if (Array.isArray(obj.layout_mockups)) fields.push(`${obj.layout_mockups.length} mockup${obj.layout_mockups.length === 1 ? '' : 's'}`)
      if (obj.brief && typeof obj.brief === 'object') fields.push('brief seeded')
      return { title: obj.title, fields }
    } catch { return null }
  })()

  return (
    <>
      <LoadingButton variant="primary" icon={Plus} onClick={() => setShowForm(true)}>
        New brief
      </LoadingButton>

      <Modal isOpen={showForm} onClose={resetAndClose} title="New brief">
        {/* Mode toggle */}
        <div className="flex gap-1 mb-4">
          <button
            onClick={() => setMode('form')}
            className={`px-3 py-1 rounded text-xs font-medium transition-colors ${
              mode === 'form' ? 'bg-brand-navy text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}
          >
            Form
          </button>
          <button
            onClick={() => setMode('import')}
            className={`px-3 py-1 rounded text-xs font-medium transition-colors ${
              mode === 'import' ? 'bg-brand-navy text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}
          >
            Import JSON
          </button>
        </div>

        {mode === 'form' ? (
          <form onSubmit={handleCreate} className="space-y-4">
            <div>
              <label htmlFor="project-title" className="block text-sm font-medium text-gray-700 mb-1">
                Title *
              </label>
              <input
                id="project-title"
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Sam's Cafe App"
                className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-brand-navy focus:border-brand-navy"
                autoFocus
              />
            </div>

            <div className="flex gap-3">
              <div className="flex-1">
                <label htmlFor="project-first-name" className="block text-sm font-medium text-gray-700 mb-1">
                  Maker first name
                </label>
                <input
                  id="project-first-name"
                  type="text"
                  value={firstName}
                  onChange={(e) => setFirstName(e.target.value)}
                  placeholder="Sam"
                  className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-brand-navy focus:border-brand-navy"
                />
              </div>
              <div className="flex-1">
                <label htmlFor="project-last-name" className="block text-sm font-medium text-gray-700 mb-1">
                  Last name
                </label>
                <input
                  id="project-last-name"
                  type="text"
                  value={lastName}
                  onChange={(e) => setLastName(e.target.value)}
                  placeholder="Lee"
                  className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-brand-navy focus:border-brand-navy"
                />
              </div>
            </div>

            <div>
              <label htmlFor="project-email" className="block text-sm font-medium text-gray-700 mb-1">
                Maker email
              </label>
              <input
                id="project-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="sam@example.com"
                className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-brand-navy focus:border-brand-navy"
              />
              <p className="text-xs text-gray-500 mt-1">
                Needed to share the brief with them later.
              </p>
            </div>

            <div>
              <label htmlFor="project-context" className="block text-sm font-medium text-gray-700 mb-1">
                Context for the agent
              </label>
              <textarea
                id="project-context"
                value={context}
                onChange={(e) => setContext(e.target.value)}
                placeholder="Sam owns a cafe in downtown Portland. They want to let customers order online and pick up in store. They're not technical at all..."
                rows={4}
                className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-brand-navy focus:border-brand-navy"
              />
              <p className="text-xs text-gray-500 mt-1">
                Background info the agent will use to skip basic discovery questions.
              </p>
            </div>

            {createProject.error && (
              <StatusMessage type="error" message={createProject.error.message} />
            )}

            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={resetAndClose}
                className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800"
              >
                Cancel
              </button>
              <LoadingButton
                type="submit"
                variant="primary"
                loading={createProject.isPending}
                loadingText="Creating..."
                disabled={!title.trim()}
              >
                Create brief
              </LoadingButton>
            </div>
          </form>
        ) : (
          <div className="space-y-4">
            <div>
              <button
                type="button"
                onClick={handleCopyPrep}
                className="flex items-center gap-1.5 text-xs text-gray-600 hover:text-brand-navy mb-2"
              >
                {prepCopied ? <Check className="h-3.5 w-3.5 text-green-500" /> : <Copy className="h-3.5 w-3.5" />}
                {prepCopied ? 'Copied!' : 'Copy new-brief prep'}
              </button>
              <label htmlFor="project-json" className="block text-sm font-medium text-gray-700 mb-1">
                Paste new-brief JSON
              </label>
              <textarea
                id="project-json"
                value={jsonInput}
                onChange={(e) => { setJsonInput(e.target.value); setJsonError(null) }}
                placeholder={'{\n  "_payload_type": "new-project",\n  "title": "Sam\'s Cafe App",\n  "requester_email": "sam@example.com",\n  ...\n}'}
                rows={10}
                className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm text-xs font-mono focus:outline-none focus:ring-2 focus:ring-brand-navy focus:border-brand-navy"
                autoFocus
              />
              <p className="text-xs text-gray-500 mt-1">
                Copy the new-brief prep, paste into Claude to discuss the setup, then paste the returned JSON here. Only &quot;title&quot; is required.
              </p>
            </div>

            {jsonPreview && (
              <div className="bg-gray-50 rounded-md px-3 py-2 text-sm">
                <p className="font-medium text-gray-800">{jsonPreview.title}</p>
                {jsonPreview.fields.length > 0 && (
                  <p className="text-xs text-gray-500 mt-0.5">{jsonPreview.fields.join(' · ')}</p>
                )}
              </div>
            )}

            {jsonError && <StatusMessage type="error" message={jsonError} />}
            {createProject.error && (
              <StatusMessage type="error" message={createProject.error.message} />
            )}

            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={resetAndClose}
                className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800"
              >
                Cancel
              </button>
              <LoadingButton
                variant="primary"
                loading={createProject.isPending}
                loadingText="Creating..."
                disabled={!jsonInput.trim()}
                onClick={handleImport}
              >
                Import & create
              </LoadingButton>
            </div>
          </div>
        )}
      </Modal>
    </>
  )
}

function ProjectList({ isAdmin }: { isAdmin: boolean }) {
  const { data: projects, isLoading, error } = useProjects()
  const router = useRouter()
  const archiveProject = useArchiveProject()
  const [sharingProject, setSharingProject] = useState<Project | null>(null)

  if (isLoading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-20 w-full rounded-lg" />
        <Skeleton className="h-20 w-full rounded-lg" />
      </div>
    )
  }

  if (error) {
    return <StatusMessage type="error" message="Failed to load briefs. Please try again." />
  }

  if (!projects?.length) {
    return (
      <EmptyState
        icon={FolderOpen}
        title="No briefs yet"
        description={isAdmin ? copy.dashboard.emptyAdmin : copy.dashboard.emptyMaker}
      />
    )
  }

  const renderCard = (project: Project) => {
    const turn = getTurnIndicator(project, project.viewer_role ?? null)
    return (
      <Card key={project.id} style={{ borderLeft: `6px solid ${briefIdentity(project.id).color}` }}>
        <CardBody>
          <div className="flex items-center justify-between">
            <div
              className="flex-1 cursor-pointer"
              onClick={() => router.push(`/projects/${project.slug || project.id}`)}
            >
              <div className="flex flex-wrap items-center gap-2 mb-1">
                <BriefBadge id={project.id} showCode size={18} />
                {project.viewer_role && (
                  // Per-brief role as a studio-family glyph (the mode channel) —
                  // reads the stored brief_role (#44 Phase 0 threaded it through),
                  // falling back to the access-tier default. Replaces the old text
                  // badge: a glyph carries the at-a-glance signal without the
                  // "Reviewer everywhere" clutter for the operator-of-everything.
                  <RoleGlyph
                    role={viewerBriefRole(project.viewer_role, project.viewer_brief_role)}
                    size={16}
                  />
                )}
                <h3 className="font-medium text-gray-900">{project.title}</h3>
                {turn && (
                  <TurnBadge turn={turn} className={`text-xs px-2 py-0.5 rounded-full font-medium ${turn.className}`} />
                )}
              </div>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-sm text-gray-500">
                {project.requester_email && (
                  <span className="text-brand-slate">
                    {makerDisplayName(project) || project.requester_email?.split('@')[0]}
                  </span>
                )}
                {isAdmin && project.session_count !== undefined && project.session_count > 0 && (
                  <span className="text-gray-400">
                    {project.session_count} session{project.session_count === 1 ? '' : 's'}
                  </span>
                )}
                {project.brief_version != null && (
                  <span className="text-gray-400">
                    Brief
                    {(project.brief_feature_count ?? 0) > 0 && (
                      <> &middot; {project.brief_feature_count} feature{project.brief_feature_count === 1 ? '' : 's'}</>
                    )}
                    {(project.brief_decision_count ?? 0) > 0 && (
                      <> &middot; {project.brief_decision_count} decision{project.brief_decision_count === 1 ? '' : 's'}</>
                    )}
                  </span>
                )}
              </div>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-gray-400 mt-1">
                {project.last_maker_message_at && (
                  <span>{makerShortName(project)} messaged {formatRelativeTime(project.last_maker_message_at)}</span>
                )}
                {project.last_message_at && project.last_message_by === 'agent' && (
                  <span>{copy.dashboard.activityAgent(formatRelativeTime(project.last_message_at))}</span>
                )}
                {project.last_builder_activity_at && (
                  <span>{copy.dashboard.builderActivity(formatRelativeTime(project.last_builder_activity_at))}</span>
                )}
                {!project.last_maker_message_at && project.shared_at && (
                  <span>{copy.dashboard.sharedAt(formatRelativeTime(project.shared_at))}</span>
                )}
                {project.last_nudged_at && (
                  <span>{copy.dashboard.nudgedAt(formatRelativeTime(project.last_nudged_at))}</span>
                )}
              </div>
            </div>
            <div className="flex items-center gap-2">
              {/* Archive is self-service — any viewer can hide a brief from their
                  own dashboard (per-viewer; doesn't affect others). */}
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  archiveProject.mutate({ project_id: project.id, archived: !project.viewer_archived })
                }}
                disabled={archiveProject.isPending}
                className="p-1.5 text-gray-400 hover:text-brand-navy hover:bg-gray-100 rounded disabled:opacity-50"
                title={project.viewer_archived ? copy.dashboard.unarchive : copy.dashboard.archive}
              >
                {project.viewer_archived ? <ArchiveRestore className="h-4 w-4" /> : <Archive className="h-4 w-4" />}
              </button>
              {isAdmin && (
                <button
                  onClick={(e) => {
                    e.stopPropagation()
                    setSharingProject(project)
                  }}
                  className="p-1.5 text-gray-400 hover:text-brand-navy hover:bg-gray-100 rounded"
                  title="Share with someone"
                >
                  <Share2 className="h-4 w-4" />
                </button>
              )}
            </div>
          </div>
        </CardBody>
      </Card>
    )
  }

  // Group into role/turn-state sections (#44). When grouping earns nothing
  // (one bucket, or a small total), fall back to the flat activity-sorted list
  // exactly as before — only multi-bucket dashboards get section headers.
  const sections = groupBriefs(projects)

  return (
    <>
      {shouldFlatten(sections) ? (
        <div className="space-y-3">{projects.map(renderCard)}</div>
      ) : (
        <div className="space-y-8">
          {sections.map((section) => {
            if (section.briefs.length === 0) {
              // Role sections show a one-line "your queue is clear" hint; the
              // cross-role Awaiting + the two bottom folders stay silent when empty.
              if (!section.emptyHint) return null
              return (
                <div key={section.key}>
                  <SectionHeader title={section.title} count={0} isAdmin={isAdmin} accent={section.key === 'awaiting'} />
                  <p className={`text-sm ${isAdmin ? 'text-slate-500' : 'text-gray-400'}`}>
                    {section.emptyHint}
                  </p>
                </div>
              )
            }
            return (
              <CollapsibleSection
                key={section.key}
                sectionKey={section.key}
                title={section.title}
                count={section.briefs.length}
                isAdmin={isAdmin}
                accent={section.key === 'awaiting'}
                defaultOpen={DEFAULT_SECTION_OPEN[section.key]}
              >
                <div className="space-y-3">{section.briefs.map(renderCard)}</div>
              </CollapsibleSection>
            )
          })}
        </div>
      )}

      {sharingProject && (
        <ShareModal
          project={sharingProject}
          onClose={() => setSharingProject(null)}
        />
      )}
    </>
  )
}

function ShareModal({ project, onClose }: { project: Project; onClose: () => void }) {
  const [email, setEmail] = useState('')
  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [copied, setCopied] = useState(false)
  const [emailCopied, setEmailCopied] = useState(false)
  const shareProject = useShareProject()
  const shareLink = getProjectShareLink(project.slug, project.id)

  const inviteEmailBody = copy.invite.body({ projectTitle: project.title, shareLink, email, passcode: shareProject.data?.passcode || null })

  const handleShare = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!email.trim()) return

    try {
      await shareProject.mutateAsync({
        project_id: project.id,
        email: email.trim(),
        first_name: firstName.trim() || undefined,
        last_name: lastName.trim() || undefined,
      })
    } catch {
      // error shown via shareProject.error
    }
  }

  const handleCopy = async () => {
    await navigator.clipboard.writeText(shareLink)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const handleCopyEmail = async () => {
    await navigator.clipboard.writeText(inviteEmailBody)
    setEmailCopied(true)
    setTimeout(() => setEmailCopied(false), 2000)
  }

  return (
    <Modal isOpen onClose={onClose} title={`Share "${project.title}"`}>
      {shareProject.isSuccess ? (
        <div className="space-y-4">
          <StatusMessage type="success" message={copy.shareModal.successMessage(email)} />
          <div>
            <p className="text-sm text-gray-700 mb-2">Send them this link:</p>
            <div className="flex items-center gap-2">
              <input
                type="text"
                readOnly
                value={shareLink}
                className="flex-1 px-3 py-2 bg-gray-50 border border-gray-300 rounded-md text-sm text-gray-700"
              />
              <button
                onClick={handleCopy}
                className="p-2 text-gray-500 hover:text-brand-navy hover:bg-gray-100 rounded"
                title="Copy link"
              >
                {copied ? <Check className="h-4 w-4 text-green-500" /> : <Copy className="h-4 w-4" />}
              </button>
            </div>
          </div>

          <div>
            <p className="text-sm text-gray-700 mb-2 flex items-center gap-1.5">
              <Mail className="h-4 w-4" />
              Invite email to send them:
            </p>
            <textarea
              readOnly
              value={inviteEmailBody}
              rows={8}
              className="w-full px-3 py-2 bg-gray-50 border border-gray-300 rounded-md text-sm text-gray-700 resize-none"
            />
            <button
              onClick={handleCopyEmail}
              className="mt-1.5 flex items-center gap-1.5 text-sm text-gray-500 hover:text-brand-navy"
            >
              {emailCopied ? <Check className="h-3.5 w-3.5 text-green-500" /> : <Copy className="h-3.5 w-3.5" />}
              {emailCopied ? 'Copied!' : 'Copy email'}
            </button>
          </div>

          <div className="flex justify-end">
            <button onClick={onClose} className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800">
              Done
            </button>
          </div>
        </div>
      ) : (
        <form onSubmit={handleShare} className="space-y-4">
          <div className="flex gap-3">
            <div className="flex-1">
              <label htmlFor="share-first-name" className="block text-sm font-medium text-gray-700 mb-1">
                First name
              </label>
              <input
                id="share-first-name"
                type="text"
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
                placeholder="Sam"
                className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-brand-navy focus:border-brand-navy"
                autoFocus
              />
            </div>
            <div className="flex-1">
              <label htmlFor="share-last-name" className="block text-sm font-medium text-gray-700 mb-1">
                Last name
              </label>
              <input
                id="share-last-name"
                type="text"
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
                placeholder="Lee"
                className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-brand-navy focus:border-brand-navy"
              />
            </div>
          </div>
          <div>
            <label htmlFor="share-email" className="block text-sm font-medium text-gray-700 mb-1">
              {copy.shareModal.emailLabel}
            </label>
            <input
              id="share-email"
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder={copy.shareModal.emailPlaceholder}
              className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-brand-navy focus:border-brand-navy"
            />
            <p className="text-xs text-gray-500 mt-1">
              {copy.shareModal.emailHelp}
            </p>
          </div>

          {shareProject.error && (
            <StatusMessage type="error" message={shareProject.error.message} />
          )}

          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800"
            >
              Cancel
            </button>
            <LoadingButton
              type="submit"
              variant="primary"
              loading={shareProject.isPending}
              loadingText="Sharing..."
              disabled={!email.trim()}
              icon={Share2}
            >
              Share
            </LoadingButton>
          </div>
        </form>
      )}
    </Modal>
  )
}

function SectionHeader({
  title,
  count,
  isAdmin,
  accent,
}: {
  title: string
  count: number
  isAdmin: boolean
  accent?: boolean
}) {
  // "Awaiting you" is the action list — give it an amber accent + dot so the eye
  // lands there first. Other sections get a quieter but still bold treatment.
  const titleColor = accent
    ? isAdmin
      ? 'text-amber-300'
      : 'text-amber-600'
    : isAdmin
      ? 'text-slate-200'
      : 'text-gray-800'
  const countColor = accent
    ? isAdmin
      ? 'bg-amber-400/15 text-amber-300'
      : 'bg-amber-100 text-amber-700'
    : isAdmin
      ? 'bg-slate-700/60 text-slate-300'
      : 'bg-gray-200 text-gray-600'
  return (
    <div className={`flex items-center gap-2 mb-3 pb-1.5 border-b ${isAdmin ? 'border-slate-700/60' : 'border-gray-200'}`}>
      {accent && <span className="h-2 w-2 rounded-full bg-amber-400 shrink-0" />}
      <h3 className={`text-sm font-bold uppercase tracking-widest ${titleColor}`}>{title}</h3>
      {count > 0 && (
        <span className={`text-xs font-semibold rounded-full px-2 py-0.5 ${countColor}`}>{count}</span>
      )}
    </div>
  )
}

// Default open/collapsed per section: live work expanded, the two bottom
// folders collapsed. A viewer's manual toggle overrides this and persists.
const DEFAULT_SECTION_OPEN: Record<SectionKey, boolean> = {
  awaiting: true,
  yours: true,
  reviewing: true,
  contributing: true,
  done: false,
  archived: false,
}

const SECTION_OPEN_PREFIX = 'dashboard:section:'

// A collapsible section with a chevron header. Open state persists per section
// in localStorage so a viewer's choice survives reloads. Initialized from the
// default to avoid an SSR/client hydration mismatch, then synced from storage.
function CollapsibleSection({
  sectionKey,
  title,
  count,
  isAdmin,
  accent,
  defaultOpen,
  children,
}: {
  sectionKey: SectionKey
  title: string
  count: number
  isAdmin: boolean
  accent?: boolean
  defaultOpen: boolean
  children: React.ReactNode
}) {
  const [open, setOpen] = useState(defaultOpen)
  useEffect(() => {
    try {
      const stored = localStorage.getItem(SECTION_OPEN_PREFIX + sectionKey)
      if (stored !== null) setOpen(stored === '1')
    } catch {
      // localStorage unavailable — keep the default
    }
  }, [sectionKey])

  const toggle = () =>
    setOpen((prev) => {
      const next = !prev
      try {
        localStorage.setItem(SECTION_OPEN_PREFIX + sectionKey, next ? '1' : '0')
      } catch {
        // ignore persistence failures
      }
      return next
    })

  const Chevron = open ? ChevronDown : ChevronRight
  const titleColor = accent
    ? isAdmin ? 'text-amber-300' : 'text-amber-600'
    : isAdmin ? 'text-slate-200' : 'text-gray-800'
  const countColor = accent
    ? isAdmin ? 'bg-amber-400/15 text-amber-300' : 'bg-amber-100 text-amber-700'
    : isAdmin ? 'bg-slate-700/60 text-slate-300' : 'bg-gray-200 text-gray-600'

  return (
    <div>
      <button
        onClick={toggle}
        className={`flex items-center gap-2 mb-3 pb-1.5 border-b w-full ${isAdmin ? 'border-slate-700/60' : 'border-gray-200'}`}
      >
        <Chevron className={`h-4 w-4 shrink-0 ${isAdmin ? 'text-slate-400' : 'text-gray-400'}`} />
        {accent && <span className="h-2 w-2 rounded-full bg-amber-400 shrink-0" />}
        <h3 className={`text-sm font-bold uppercase tracking-widest ${titleColor}`}>{title}</h3>
        <span className={`text-xs font-semibold rounded-full px-2 py-0.5 ${countColor}`}>{count}</span>
      </button>
      {open && children}
    </div>
  )
}

function makerDisplayName(project: Project): string | null {
  return formatDisplayName(project.requester_first_name, project.requester_last_name)
}

function makerShortName(project: Project): string {
  return getMakerShortName(project.requester_first_name, project.requester_email)
}

function formatRelativeTime(iso: string): string {
  const date = new Date(iso)
  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  const diffMins = Math.floor(diffMs / 60000)
  const diffHours = Math.floor(diffMs / 3600000)
  const diffDays = Math.floor(diffMs / 86400000)

  if (diffMins < 1) return 'just now'
  if (diffMins < 60) return `${diffMins}m ago`
  if (diffHours < 24) return `${diffHours}h ago`
  if (diffDays < 7) return `${diffDays}d ago`
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}
