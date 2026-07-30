'use client'

import { useAuth } from '@/lib/hooks/useAuth'
import { useApproval } from '@/lib/hooks/useApproval'
import { useClaimProject, useResolveProject } from '@/lib/query/hooks'
import { useRouter, useParams, useSearchParams } from 'next/navigation'
import { useEffect } from 'react'
import { BuilderProjectView } from '@/components/builder/BuilderProjectView'
import { MakerProjectView } from '@/components/maker/MakerProjectView'
import { selectProjectView, isBuilderSideRole } from '@/lib/projects/project-view'

export default function ProjectPage() {
  const { user, loading: authLoading, isAuthenticated } = useAuth()
  const { approved, loading: approvalLoading } = useApproval()
  const router = useRouter()
  const params = useParams()
  const searchParams = useSearchParams()
  const slugOrId = params.id as string

  // Resolve slug or Firestore ID to a project. Response includes viewer_role —
  // no separate /api/projects/role round-trip.
  const { data: resolved, isLoading: resolving } = useResolveProject(
    user && approved ? slugOrId : undefined
  )
  const projectId = resolved?.id
  const role = resolved?.viewer_role ?? null

  const claimProject = useClaimProject()

  useEffect(() => {
    if (!authLoading && !isAuthenticated) router.push('/auth/login')
  }, [authLoading, isAuthenticated, router])

  useEffect(() => {
    if (!approvalLoading && approved === false && isAuthenticated) router.push('/not-approved')
  }, [approvalLoading, approved, isAuthenticated, router])

  // Auto-claim on mount
  useEffect(() => {
    if (user && approved && projectId) {
      claimProject.mutate(projectId)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, user, approved])

  if (authLoading || approvalLoading || !user || !approved || resolving || !projectId) {
    return (
      <div className="min-h-screen bg-brand-cream flex items-center justify-center">
        <div className="animate-pulse text-brand-slate">Loading...</div>
      </div>
    )
  }

  // builder+ (or admin) gets the read-only builder view (#120) by default,
  // and can explicitly join the conversation via ?view=chat (#110).
  const view = selectProjectView(role, searchParams.get('view'))

  if (view === 'builder') {
    return <BuilderProjectView projectId={projectId} />
  }

  return (
    <MakerProjectView
      projectId={projectId}
      userEmail={user.email || ''}
      participantView={isBuilderSideRole(role)}
    />
  )
}
