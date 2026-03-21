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
  const [title, setTitle] = useState('')
  const [context, setContext] = useState('')
  const createProject = useCreateProject()
  const router = useRouter()

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!title.trim()) return

    try {
      const result = await createProject.mutateAsync({
        title: title.trim(),
        context: context.trim() || undefined,
      })
      setTitle('')
      setContext('')
      setShowForm(false)
      router.push(`/projects/${result.id}`)
    } catch {
      // error is available via createProject.error
    }
  }

  return (
    <>
      <LoadingButton variant="primary" icon={Plus} onClick={() => setShowForm(true)}>
        New project
      </LoadingButton>

      <Modal isOpen={showForm} onClose={() => setShowForm(false)} title="New project">
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
              onClick={() => setShowForm(false)}
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
        description={isAdmin
          ? "Create a project, set it up, and share it with a maker."
          : "You don't have any projects yet. Check back soon!"}
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
                          {project.requester_email}
                        </span>
                      )}
                      {isAdmin && project.session_count !== undefined && project.session_count > 0 && (
                        <span className="text-gray-400">
                          {project.session_count} session{project.session_count === 1 ? '' : 's'}
                        </span>
                      )}
                      {project.brief_version != null && (
                        <span className="text-gray-400">
                          Brief v{project.brief_version}
                          {(project.brief_decision_count ?? 0) > 0 && (
                            <> &middot; {project.brief_decision_count} decision{project.brief_decision_count === 1 ? '' : 's'}</>
                          )}
                        </span>
                      )}
                    </div>
                    {project.last_message_at && (
                      <p className="text-xs text-gray-400 mt-1">
                        {formatActivityLine(project)}
                      </p>
                    )}
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
  const [copied, setCopied] = useState(false)
  const [emailCopied, setEmailCopied] = useState(false)
  const shareProject = useShareProject()
  const shareLink = typeof window !== 'undefined'
    ? `${window.location.origin}/projects/${project.id}`
    : ''

  const inviteEmailBody = `Hey! I've set up a project for you on iBuild4you — it's a tool that helps figure out exactly what you want built through a simple conversation.

Here's your link:
${shareLink}

Just sign in with your email (${email}) and you'll see a chat waiting for you. Answer a few questions about your idea and it'll start putting together a project brief.

No rush — you can come back anytime to pick up where you left off.`

  const handleShare = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!email.trim()) return

    try {
      await shareProject.mutateAsync({ project_id: project.id, email: email.trim() })
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
          <div>
            <label htmlFor="share-email" className="block text-sm font-medium text-gray-700 mb-1">
              Their email address
            </label>
            <input
              id="share-email"
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="jamie@example.com"
              className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-brand-navy focus:border-brand-navy"
              autoFocus
            />
            <p className="text-xs text-gray-500 mt-1">
              They&apos;ll be approved automatically. You&apos;ll get a link to send them.
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
    return { label: 'Needs setup', className: 'bg-gray-100 text-gray-600' }
  }
  if (!project.last_message_by || project.last_message_by === 'agent') {
    const name = project.requester_email.split('@')[0]
    return { label: `Waiting on ${name}`, className: 'bg-blue-100 text-blue-700' }
  }
  return { label: 'Ready to review', className: 'bg-amber-100 text-amber-700' }
}

function formatActivityLine(project: Project): string {
  if (!project.last_message_at) return ''
  const time = formatRelativeTime(project.last_message_at)
  if (project.last_message_by === 'agent') {
    return `Agent responded ${time}`
  }
  if (project.last_message_by) {
    return `${project.last_message_by} sent a message ${time}`
  }
  return `Last active ${time}`
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
