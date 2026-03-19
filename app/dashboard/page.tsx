'use client'

import { useAuth } from '@/lib/hooks/useAuth'
import { useApproval } from '@/lib/hooks/useApproval'
import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import { UserMenu } from '@/components/user-menu'
import { MessageSquare, Plus, FolderOpen } from 'lucide-react'
import { useProjects, useCreateProject } from '@/lib/query/hooks'
import { LoadingButton } from '@/components/ui/LoadingButton'
import { Card, CardBody } from '@/components/ui/Card'
import { EmptyState } from '@/components/ui/EmptyState'
import { StatusMessage } from '@/components/ui/StatusMessage'
import { Skeleton } from '@/components/ui/Skeleton'

export default function DashboardPage() {
  const { user, loading: authLoading, isAuthenticated } = useAuth()
  const { approved, loading: approvalLoading } = useApproval()
  const router = useRouter()

  // Redirect unauthenticated users to login
  useEffect(() => {
    if (!authLoading && !isAuthenticated) {
      router.push('/auth/login')
    }
  }, [authLoading, isAuthenticated, router])

  // Redirect unapproved users
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

  return (
    <div className="min-h-screen bg-brand-cream">
      <header className="bg-white border-b border-gray-200 sticky top-0 z-10">
        <div className="px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            <div className="flex items-center gap-3">
              <MessageSquare className="h-7 w-7 text-brand-navy" />
              <h1 className="text-xl font-bold text-brand-charcoal">iBuild4you</h1>
            </div>
            <UserMenu />
          </div>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-4 py-8">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-2xl font-semibold text-gray-900">Your projects</h2>
          <NewProjectButton />
        </div>
        <ProjectList />
      </main>
    </div>
  )
}

function NewProjectButton() {
  const [showInput, setShowInput] = useState(false)
  const [title, setTitle] = useState('')
  const createProject = useCreateProject()
  const router = useRouter()

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!title.trim()) return

    try {
      const result = await createProject.mutateAsync(title.trim())
      setTitle('')
      setShowInput(false)
      router.push(`/projects/${result.id}`)
    } catch {
      // error is available via createProject.error
    }
  }

  if (!showInput) {
    return (
      <LoadingButton variant="primary" icon={Plus} onClick={() => setShowInput(true)}>
        New project
      </LoadingButton>
    )
  }

  return (
    <form onSubmit={handleCreate} className="flex items-center gap-2">
      <input
        type="text"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="Project title..."
        className="px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-brand-navy focus:border-brand-navy"
        autoFocus
      />
      <LoadingButton
        type="submit"
        variant="primary"
        loading={createProject.isPending}
        loadingText="Creating..."
        disabled={!title.trim()}
      >
        Create
      </LoadingButton>
      <button
        type="button"
        onClick={() => {
          setShowInput(false)
          setTitle('')
        }}
        className="text-sm text-gray-500 hover:text-gray-700"
      >
        Cancel
      </button>
    </form>
  )
}

function ProjectList() {
  const { data: projects, isLoading, error } = useProjects()
  const router = useRouter()

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
        description="Create your first project and start chatting about your idea."
      />
    )
  }

  return (
    <div className="space-y-3">
      {projects.map((project) => (
        <Card key={project.id} onClick={() => router.push(`/projects/${project.id}`)}>
          <CardBody>
            <div className="flex items-center justify-between">
              <div>
                <h3 className="font-medium text-gray-900">{project.title}</h3>
                <p className="text-sm text-gray-500">
                  {new Date(project.created_at).toLocaleDateString()}
                </p>
              </div>
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
          </CardBody>
        </Card>
      ))}
    </div>
  )
}
