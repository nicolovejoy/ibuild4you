'use client'

import { useAuth } from '@/lib/hooks/useAuth'
import { useRouter } from 'next/navigation'
import { useEffect } from 'react'
import { Clock } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { useMakerCopy } from '@/components/locale-context'

export default function NotApprovedPage() {
  const { user, loading, isAuthenticated, signOut } = useAuth()
  const router = useRouter()
  const { common, notApproved: t } = useMakerCopy()

  useEffect(() => {
    if (!loading && !isAuthenticated) {
      router.push('/auth/login')
    }
  }, [loading, isAuthenticated, router])

  if (loading || !user) {
    return (
      <div className="min-h-screen bg-brand-cream flex items-center justify-center">
        <div className="animate-pulse text-brand-slate">{common.loading}</div>
      </div>
    )
  }

  const unverified = !user.emailVerified

  const handleSignOut = async () => {
    await signOut()
    router.push('/auth/login')
  }

  return (
    <div className="min-h-screen bg-brand-cream flex items-center justify-center px-4">
      <div className="max-w-md text-center space-y-6">
        <Clock className="h-16 w-16 text-brand-slate mx-auto" />
        {/* An unconfirmed address is refused by every API route (403
            email_unverified), which lands here; say what fixes it instead of
            "not approved yet". */}
        <h1 className="text-2xl font-bold text-brand-charcoal">
          {unverified ? t.unverifiedTitle : t.title}
        </h1>
        <p className="text-brand-slate">
          {unverified ? t.unverifiedMessage(user.email ?? '') : t.message(user.email ?? '')}
        </p>
        <p className="text-sm text-brand-slate">{t.wrongAccount}</p>
        <div className="flex items-center justify-center gap-3">
          <Button variant="primary" onClick={handleSignOut}>
            {common.signOut}
          </Button>
          <Button variant="ghost" onClick={() => router.push(common.homeHref)}>
            {common.backToHome}
          </Button>
        </div>
      </div>
    </div>
  )
}
