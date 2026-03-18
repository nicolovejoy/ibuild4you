'use client'

import { useAuth } from '@/lib/hooks/useAuth'
import { useRouter } from 'next/navigation'
import { useEffect } from 'react'
import { UserMenu } from '@/components/user-menu'
import { MessageSquare } from 'lucide-react'

export default function DashboardPage() {
  const { user, loading, isAuthenticated } = useAuth()
  const router = useRouter()

  useEffect(() => {
    if (!loading && !isAuthenticated) {
      router.push('/auth/login')
    }
  }, [loading, isAuthenticated, router])

  if (loading) {
    return (
      <div className="min-h-screen bg-brand-cream flex items-center justify-center">
        <div className="animate-pulse text-brand-slate">Loading...</div>
      </div>
    )
  }

  if (!user) return null

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

      <main className="max-w-4xl mx-auto px-4 py-12">
        <div className="text-center space-y-4">
          <h2 className="text-2xl font-semibold text-gray-900">Welcome, {user.email}</h2>
          <p className="text-gray-600">
            Your projects will appear here. This is the starting point — ready to build.
          </p>
        </div>
      </main>
    </div>
  )
}
