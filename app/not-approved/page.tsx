'use client'

import { useAuth } from '@/lib/hooks/useAuth'
import { useRouter } from 'next/navigation'
import { useEffect } from 'react'
import { Clock } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { copy } from '@/lib/copy'

export default function NotApprovedPage() {
  const { user, loading, isAuthenticated, signOut } = useAuth()
  const router = useRouter()

  useEffect(() => {
    if (!loading && !isAuthenticated) {
      router.push('/auth/login')
    }
  }, [loading, isAuthenticated, router])

  if (loading || !user) {
    return (
      <div className="min-h-screen bg-brand-cream flex items-center justify-center">
        <div className="animate-pulse text-brand-slate">Loading...</div>
      </div>
    )
  }

  const handleSignOut = async () => {
    await signOut()
    router.push('/auth/login')
  }

  return (
    <div className="min-h-screen bg-brand-cream flex items-center justify-center px-4">
      <div className="max-w-md text-center space-y-6">
        <Clock className="h-16 w-16 text-brand-slate mx-auto" />
        <h1 className="text-2xl font-bold text-brand-charcoal">{copy.auth.notApprovedTitle}</h1>
        <p className="text-brand-slate">{copy.auth.notApprovedMessage(user.email ?? '')}</p>
        <p className="text-sm text-brand-slate">{copy.auth.notApprovedWrongAccount}</p>
        <div className="flex items-center justify-center gap-3">
          <Button variant="primary" onClick={handleSignOut}>
            {copy.auth.signOut}
          </Button>
          <Button variant="ghost" onClick={() => router.push('/')}>
            Back to home
          </Button>
        </div>
      </div>
    </div>
  )
}
