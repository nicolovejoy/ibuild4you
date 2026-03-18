'use client'

import { useAuth } from '@/lib/hooks/useAuth'
import { useRouter } from 'next/navigation'
import { useEffect } from 'react'
import { MessageSquare, ArrowRight } from 'lucide-react'
import { LoadingButton } from '@/components/ui/LoadingButton'

export default function HomePage() {
  const { user, loading, isAuthenticated } = useAuth()
  const router = useRouter()

  useEffect(() => {
    if (!loading && isAuthenticated) {
      router.push('/dashboard')
    }
  }, [loading, isAuthenticated, router])

  if (loading) {
    return (
      <div className="min-h-screen bg-brand-cream flex items-center justify-center">
        <div className="animate-pulse text-brand-slate">Loading...</div>
      </div>
    )
  }

  if (user) return null

  return (
    <div className="min-h-screen bg-brand-cream flex flex-col items-center justify-center px-4">
      <div className="max-w-lg text-center space-y-8">
        <div className="flex justify-center">
          <MessageSquare className="h-16 w-16 text-brand-navy" />
        </div>
        <h1 className="text-4xl font-bold text-brand-charcoal">iBuild4you</h1>
        <p className="text-lg text-brand-slate">
          Tell us about your idea. Our AI will guide you through the details and turn it into a
          clear project brief.
        </p>
        <LoadingButton
          variant="primary"
          size="lg"
          icon={ArrowRight}
          onClick={() => router.push('/auth/login')}
        >
          Get Started
        </LoadingButton>
      </div>
    </div>
  )
}
