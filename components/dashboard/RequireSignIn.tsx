'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/lib/hooks/useAuth'
import { useApproval } from '@/lib/hooks/useApproval'
import { useMakerCopy } from '@/components/locale-context'

// Client-side sign-in gate for builder-facing pages under /dashboard that are
// otherwise static (the payload reference docs). Same redirects as the
// dashboard page itself: signed out → /auth/login, signed in but not approved
// → /not-approved. Renders nothing until both checks have settled.
export function RequireSignIn({ children }: { children: React.ReactNode }) {
  const { user, loading: authLoading, isAuthenticated } = useAuth()
  const { approved, loading: approvalLoading } = useApproval()
  const router = useRouter()
  const m = useMakerCopy()

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
        <div className="animate-pulse text-brand-slate">{m.common.loading}</div>
      </div>
    )
  }

  if (!user || !approved) return null

  return <>{children}</>
}
