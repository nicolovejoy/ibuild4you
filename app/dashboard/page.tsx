'use client'

import { useAuth } from '@/lib/hooks/useAuth'
import { useApproval } from '@/lib/hooks/useApproval'
import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import { UserMenu } from '@/components/user-menu'
import { Plus, FolderOpen, Share2, Copy, Check, Mail, Trash2 } from 'lucide-react'
import { ScaffoldIcon } from '@/components/ScaffoldIcon'
import { BuildTimestamp } from '@/components/build-timestamp'
import { useProjects, useCreateProject, useShareProject, useDeleteProject } from '@/lib/query/hooks'
import { isAdminEmail } from '@/lib/constants'
import { LoadingButton } from '@/components/ui/LoadingButton'
import { Card, CardBody } from '@/components/ui/Card'
import { EmptyState } from '@/components/ui/EmptyState'
import { StatusMessage } from '@/components/ui/StatusMessage'
import { Skeleton } from '@/components/ui/Skeleton'
import { Modal } from '@/components/ui/Modal'
import type { Project } from '@/lib/types'
import { copy, formatDisplayName } from '@/lib/copy'
import { stripCodeFences } from '@/lib/utils'

export default function DashboardPage() {
  const { user, loading: authLoading, isAuthenticated } = useAuth()
  const { approved, loading: approvalLoading } = useApproval()
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

  const isAdmin = isAdminEmail(user.email)

  return (
    <div className="min-h-screen bg-brand-cream">
      <header className="bg-white border-b border-gray-200 sticky top-0 z-10">
        <div className="px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            <div className="flex items-center gap-3 group relative">
              <ScaffoldIcon className="h-7 w-7 text-brand-navy" />
              <h1 className="text-xl font-bold text-brand-charcoal">iBuild4you</h1>
              <BuildTimestamp />
            </div>
            <UserMenu />
          </div>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-4 py-8">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-2xl font-semibold text-gray-900">Your projects</h2>
          {isAdmin && <NewProjectButton />}
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
  const [context, setContext] = useState('')
  const [jsonInput, setJsonInput] = useState('')
  const [jsonError, setJsonError] = useState<string | null>(null)
  const createProject = useCreateProject()
  const router = useRouter()

  const resetAndClose = () => {
    setTitle('')
    setContext('')
    setJsonInput('')
    setJsonError(null)
    setMode('form')
    setShowForm(false)
  }

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!title.trim()) return

    try {
      const result = await createProject.mutateAsync({
        title: title.trim(),
        context: context.trim() || undefined,
      })
      resetAndClose()
      router.push(`/projects/${result.id}?tab=setup`)
    } catch {
      // error is available via createProject.error
    }
  }

  const handleImport = async () => {
    setJsonError(null)
    let payload: Record<string, unknown>
    try {
      payload = JSON.parse(stripCodeFences(jsonInput))
    } catch {
      setJsonError('Invalid JSON')
      return
    }
    if (!payload || typeof payload !== 'object') {
      setJsonError('JSON must be an object')
      return
    }
    if (!payload.title || typeof payload.title !== 'string' || !payload.title.trim()) {
      setJsonError('JSON must include a "title" field')
      return
    }

    try {
      const result = await createProject.mutateAsync(payload as { title: string; [key: string]: unknown })
      resetAndClose()
      router.push(`/projects/${result.id}?tab=setup`)
    } catch {
      // error is available via createProject.error
    }
  }

  const jsonPreview = (() => {
    if (!jsonInput.trim()) return null
    try {
      const obj = JSON.parse(stripCodeFences(jsonInput))
      if (!obj?.title) return null
      const fields: string[] = []
      if (obj.requester_email) fields.push(obj.requester_email)
      if (obj.session_mode) fields.push(obj.session_mode)
      if (Array.isArray(obj.seed_questions)) fields.push(`${obj.seed_questions.length} seed questions`)
      if (Array.isArray(obj.builder_directives)) fields.push(`${obj.builder_directives.length} directives`)
      if (obj.welcome_message) fields.push('welcome message')
      if (Array.isArray(obj.layout_mockups)) fields.push(`${obj.layout_mockups.length} mockup${obj.layout_mockups.length === 1 ? '' : 's'}`)
      return { title: obj.title, fields }
    } catch { return null }
  })()

  return (
    <>
      <LoadingButton variant="primary" icon={Plus} onClick={() => setShowForm(true)}>
        New project
      </LoadingButton>

      <Modal isOpen={showForm} onClose={resetAndClose} title="New project">
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
                placeholder="Jamie's Bakery App"
                className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-brand-navy focus:border-brand-navy"
                autoFocus
              />
            </div>

            <div>
              <label htmlFor="project-context" className="block text-sm font-medium text-gray-700 mb-1">
                Context for the agent
              </label>
              <textarea
                id="project-context"
                value={context}
                onChange={(e) => setContext(e.target.value)}
                placeholder="Jamie owns a bakery in downtown Portland. She wants to let customers order online and pick up in store. She's not technical at all..."
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
                Create project
              </LoadingButton>
            </div>
          </form>
        ) : (
          <div className="space-y-4">
            <div>
              <label htmlFor="project-json" className="block text-sm font-medium text-gray-700 mb-1">
                Paste setup JSON
              </label>
              <textarea
                id="project-json"
                value={jsonInput}
                onChange={(e) => { setJsonInput(e.target.value); setJsonError(null) }}
                placeholder={'{\n  "title": "Jamie\'s Bakery App",\n  "requester_email": "jamie@example.com",\n  "seed_questions": [...],\n  ...\n}'}
                rows={10}
                className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm text-xs font-mono focus:outline-none focus:ring-2 focus:ring-brand-navy focus:border-brand-navy"
                autoFocus
              />
              <p className="text-xs text-gray-500 mt-1">
                Full setup payload from your prep workflow. Only &quot;title&quot; is required.
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
  const [sharingProject, setSharingProject] = useState<Project | null>(null)
  const [deletingProject, setDeletingProject] = useState<Project | null>(null)

  if (isLoading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-20 w-full rounded-lg" />
        <Skeleton className="h-20 w-full rounded-lg" />
      </div>
    )
  }

  if (error) {
    return <StatusMessage type="error" message="Failed to load projects. Please try again." />
  }

  if (!projects?.length) {
    return (
      <EmptyState
        icon={FolderOpen}
        title="No projects yet"
        description={isAdmin ? copy.dashboard.emptyAdmin : copy.dashboard.emptyMaker}
      />
    )
  }

  return (
    <>
      <div className="space-y-3">
        {projects.map((project) => {
          const turn = getTurnIndicator(project)
          return (
            <Card key={project.id}>
              <CardBody>
                <div className="flex items-center justify-between">
                  <div
                    className="flex-1 cursor-pointer"
                    onClick={() => router.push(`/projects/${project.id}`)}
                  >
                    <div className="flex items-center gap-2 mb-1">
                      <h3 className="font-medium text-gray-900">{project.title}</h3>
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${turn.className}`}>
                        {turn.label}
                      </span>
                    </div>
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-sm text-gray-500">
                      {project.requester_email && (
                        <span className="text-brand-slate">
                          {makerDisplayName(project) || project.requester_email}
                        </span>
                      )}
                      {isAdmin && project.session_count !== undefined && project.session_count > 0 && (
                        <span className="text-gray-400">
                          {project.session_count} conversation{project.session_count === 1 ? '' : 's'}
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
                    {isAdmin && (
                      <>
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
                        <button
                          onClick={(e) => {
                            e.stopPropagation()
                            setDeletingProject(project)
                          }}
                          className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded"
                          title="Delete project"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </>
                    )}
                  </div>
                </div>
              </CardBody>
            </Card>
          )
        })}
      </div>

      {sharingProject && (
        <ShareModal
          project={sharingProject}
          onClose={() => setSharingProject(null)}
        />
      )}

      {deletingProject && (
        <DeleteProjectModal
          project={deletingProject}
          onClose={() => setDeletingProject(null)}
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
  const shareLink = typeof window !== 'undefined'
    ? `${window.location.origin}/projects/${project.id}`
    : ''

  const inviteEmailBody = copy.invite.body({
    shareLink,
    email,
    passcode: shareProject.data?.passcode || null,
  })

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
          <StatusMessage type="success" message={`${email} has been approved and linked to this project.`} />
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
                placeholder="Jamie"
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
                placeholder="Baker"
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

function DeleteProjectModal({ project, onClose }: { project: Project; onClose: () => void }) {
  const [confirmation, setConfirmation] = useState('')
  const deleteProject = useDeleteProject()

  const canDelete = confirmation.toLowerCase() === 'delete'

  return (
    <Modal isOpen onClose={onClose} title={`Delete "${project.title}"?`}>
      <div className="space-y-4">
        <p className="text-sm text-gray-700">
          This permanently deletes the project, all conversations, and the brief. This can&apos;t be undone.
        </p>
        <div>
          <label htmlFor="delete-confirm" className="block text-sm font-medium text-gray-700 mb-1">
            Type <span className="font-mono font-bold">delete</span> to confirm
          </label>
          <input
            id="delete-confirm"
            type="text"
            value={confirmation}
            onChange={(e) => setConfirmation(e.target.value)}
            placeholder="delete"
            className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-red-500 focus:border-red-500"
            autoFocus
          />
        </div>

        {deleteProject.error && (
          <StatusMessage type="error" message={deleteProject.error.message} />
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
            variant="danger"
            loading={deleteProject.isPending}
            loadingText="Deleting..."
            disabled={!canDelete}
            onClick={async () => {
              try {
                await deleteProject.mutateAsync(project.id)
                onClose()
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

function getTurnIndicator(project: Project): { label: string; className: string } {
  if (!project.requester_email || !project.session_count) {
    return { label: copy.dashboard.turnNeedsSetup, className: 'bg-gray-100 text-gray-600' }
  }
  // Maker must have messaged since the latest session was created
  const makerMessagedInCurrentSession = project.last_maker_message_at
    && project.latest_session_created_at
    && project.last_maker_message_at > project.latest_session_created_at
  if (!makerMessagedInCurrentSession) {
    const name = makerShortName(project)
    return { label: copy.dashboard.turnAwaitingMaker(name), className: 'bg-blue-100 text-blue-700' }
  }
  return { label: copy.dashboard.turnYourTurn, className: 'bg-amber-100 text-amber-700' }
}

function makerDisplayName(project: Project): string | null {
  return formatDisplayName(project.requester_first_name, project.requester_last_name)
}

function makerShortName(project: Project): string {
  return project.requester_first_name || project.requester_email?.split('@')[0] || 'maker'
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
