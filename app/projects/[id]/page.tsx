'use client'

import { useAuth } from '@/lib/hooks/useAuth'
import { useApproval } from '@/lib/hooks/useApproval'
import { useClaimProject } from '@/lib/query/hooks'
import { useRouter, useParams } from 'next/navigation'
import { useEffect } from 'react'
import { isAdminEmail } from '@/lib/constants'
import { BuilderProjectView } from '@/components/builder/BuilderProjectView'
import { MakerProjectView } from '@/components/maker/MakerProjectView'

export default function ProjectPage() {
  const { user, loading: authLoading, isAuthenticated } = useAuth()
  const { approved, loading: approvalLoading } = useApproval()
  const router = useRouter()
  const params = useParams()
  const projectId = params.id as string
  const claimProject = useClaimProject()

  useEffect(() => {
    if (!authLoading && !isAuthenticated) router.push('/auth/login')
  }, [authLoading, isAuthenticated, router])

  useEffect(() => {
    if (!approvalLoading && approved === false && isAuthenticated) router.push('/not-approved')
  }, [approvalLoading, approved, isAuthenticated, router])

  // Auto-claim on mount
  useEffect(() => {
    if (user && approved) {
      claimProject.mutate(projectId)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, user, approved])

  if (authLoading || approvalLoading || !user || !approved) {
    return (
      <div className="min-h-screen bg-brand-cream flex items-center justify-center">
        <div className="animate-pulse text-brand-slate">Loading...</div>
      </div>
    )
  }

  const userEmail = user.email || ''
  const isAdmin = isAdminEmail(userEmail)

  if (isAdmin) {
    return <BuilderProjectView projectId={projectId} userEmail={userEmail} />
  }

  return <MakerProjectView projectId={projectId} userEmail={userEmail} />
}
