'use client'

import { useAuth } from '@/lib/hooks/useAuth'
import { useApproval } from '@/lib/hooks/useApproval'
import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import { UserMenu } from '@/components/user-menu'
import { MessageSquare, Plus, FolderOpen, Share2, Copy, Check } from 'lucide-react'
import { BuildTimestamp } from '@/components/build-timestamp'
import { useProjects, useCreateProject, useShareProject } from '@/lib/query/hooks'
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
              <MessageSquare className="h-7 w-7 text-brand-navy" />
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
          ? "Create your first project and start chatting about your idea."
          : "You don't have any projects yet. Check back soon!"}
      />
    )
  }

  return (
    <>
      <div className="space-y-3">
        {projects.map((project) => (
          <Card key={project.id}>
            <CardBody>
              <div className="flex items-center justify-between">
                <div
                  className="flex-1 cursor-pointer"
                  onClick={() => router.push(`/projects/${project.id}`)}
                >
                  <h3 className="font-medium text-gray-900">{project.title}</h3>
                  <p className="text-sm text-gray-500">
                    {new Date(project.created_at).toLocaleDateString()}
                    {project.requester_email && (
                      <span className="ml-2 text-brand-slate">
                        → {project.requester_email}
                      </span>
                    )}
                  </p>
                </div>
                <div className="flex items-center gap-2">
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
                  <span
                    className={`text-xs px-2 py-1 rounded-full ${
                      project.status === 'active'
                        ? 'bg-green-100 text-green-700'
                        : project.status === 'completed'
                          ? 'bg-blue-100 text-blue-700'
                          : 'bg-gray-100 text-gray-600'
                    }`}
                  >
                    {project.status}
                  </span>
                </div>
              </div>
            </CardBody>
          </Card>
        ))}
      </div>

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
  const [copied, setCopied] = useState(false)
  const shareProject = useShareProject()
  const shareLink = typeof window !== 'undefined'
    ? `${window.location.origin}/projects/${project.id}`
    : ''

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
