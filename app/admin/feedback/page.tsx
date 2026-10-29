'use client'

import { useAuth } from '@/lib/hooks/useAuth'
import { useApproval } from '@/lib/hooks/useApproval'
import { useRouter } from 'next/navigation'
import { Suspense, useEffect } from 'react'
import { useCurrentUser } from '@/lib/query/hooks'
import { useEscapeBack } from '@/lib/hooks/useEscapeBack'
import { SectionHeader } from '@/components/section-header'
import { FeedbackInbox } from '@/components/admin/FeedbackInbox'

export default function FeedbackAdminPage() {
  const { user, loading: authLoading, isAuthenticated } = useAuth()
  const { approved, loading: approvalLoading } = useApproval()
  const { data: currentUser, isLoading: roleLoading } = useCurrentUser()
  const router = useRouter()
  useEscapeBack('/admin')

  useEffect(() => {
    if (!authLoading && !isAuthenticated) router.push('/auth/login')
  }, [authLoading, isAuthenticated, router])

  useEffect(() => {
    if (!approvalLoading && approved === false && isAuthenticated) router.push('/not-approved')
  }, [approvalLoading, approved, isAuthenticated, router])

  if (authLoading || approvalLoading || roleLoading) {
    return (
      <div className="min-h-screen bg-brand-cream flex items-center justify-center">
        <div className="animate-pulse text-brand-slate">Loading...</div>
      </div>
    )
  }

  if (!user || !approved) return null

  const isAdmin = currentUser?.system_roles?.includes('admin') ?? false
  if (!isAdmin) {
    router.push('/dashboard')
    return null
  }

  return (
    <div className="min-h-screen bg-brand-cream">
      <SectionHeader backHref="/admin" title="Feedback inbox" />

      <main className="max-w-5xl mx-auto px-4 py-6">
        <Suspense fallback={<div className="text-center text-gray-400 py-12">Loading…</div>}>
          <FeedbackInbox />
        </Suspense>
      </main>
    </div>
  )
}

