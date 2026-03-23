'use client'

import { useAuth } from '@/lib/hooks/useAuth'
import { useApproval } from '@/lib/hooks/useApproval'
import { useClaimProject, useProjectRole, useResolveProject } from '@/lib/query/hooks'
import { useRouter, useParams } from 'next/navigation'
import { useEffect } from 'react'
import { BuilderProjectView } from '@/components/builder/BuilderProjectView'
import { MakerProjectView } from '@/components/maker/MakerProjectView'

export default function ProjectPage() {
  const { user, loading: authLoading, isAuthenticated } = useAuth()
  const { approved, loading: approvalLoading } = useApproval()
  const router = useRouter()
  const params = useParams()
  const slugOrId = params.id as string

  // Resolve slug or Firestore ID to a project
  const { data: resolved, isLoading: resolving } = useResolveProject(
    user && approved ? slugOrId : undefined
  )
  const projectId = resolved?.id

  const claimProject = useClaimProject()
  const { data: role, isLoading: roleLoading } = useProjectRole(
    projectId || undefined
  )

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

  if (authLoading || approvalLoading || !user || !approved || resolving || roleLoading || !projectId) {
    return (
      <div className="min-h-screen bg-brand-cream flex items-center justify-center">
        <div className="animate-pulse text-brand-slate">Loading...</div>
      </div>
    )
  }

  const userEmail = user.email || ''
  // builder+ gets the builder view, everyone else gets maker view
  const isBuilder = role === 'owner' || role === 'builder'

  if (isBuilder) {
    return <BuilderProjectView projectId={projectId} userEmail={userEmail} />
  }

  return <MakerProjectView projectId={projectId} userEmail={userEmail} />
}
