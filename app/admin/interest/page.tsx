'use client'

import { useAuth } from '@/lib/hooks/useAuth'
import { useApproval } from '@/lib/hooks/useApproval'
import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import { ArrowLeft, Mail } from 'lucide-react'
import { useCurrentUser } from '@/lib/query/hooks'
import { apiFetch } from '@/lib/firebase/api-fetch'
import { useEscapeBack } from '@/lib/hooks/useEscapeBack'

interface InterestSubmission {
  id: string
  name: string
  email: string
  how_found: string
  want_to_try: boolean
  what_for: string
  created_at: string
}

export default function InterestAdminPage() {
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
      <header className="bg-white border-b border-gray-200 sticky top-0 z-10">
        <div className="px-4 sm:px-6 h-14 flex items-center gap-3">
          <button onClick={() => router.push('/admin')} className="p-1 hover:bg-gray-100 rounded">
            <ArrowLeft className="h-5 w-5 text-gray-600" />
          </button>
          <h1 className="font-semibold text-brand-charcoal">Interest submissions</h1>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-4 py-6">
        <SubmissionsList />
      </main>
    </div>
  )
}

function SubmissionsList() {
  const [submissions, setSubmissions] = useState<InterestSubmission[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    (async () => {
      try {
        const res = await apiFetch('/api/admin/interest')
        if (!res.ok) throw new Error('Failed to load submissions')
        setSubmissions(await res.json())
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load')
      } finally {
        setLoading(false)
      }
    })()
  }, [])

  if (loading) return <div className="text-center text-gray-400 py-12">Loading submissions...</div>
  if (error) return <div className="text-center text-red-500 py-12">{error}</div>

  if (submissions.length === 0) {
    return <div className="text-center text-gray-400 py-12">No submissions yet.</div>
  }

  return (
    <div className="space-y-3">
      <h2 className="text-sm font-semibold text-brand-slate uppercase tracking-wide">
        {submissions.length} submission{submissions.length === 1 ? '' : 's'}
      </h2>
      <div className="bg-white rounded-lg border border-gray-200 divide-y divide-gray-100">
        {submissions.map((s) => (
          <SubmissionRow key={s.id} submission={s} />
        ))}
      </div>
    </div>
  )
}

function SubmissionRow({ submission }: { submission: InterestSubmission }) {
  return (
    <div className="px-4 py-3 space-y-2">
      <div className="flex items-baseline justify-between gap-3">
        <div className="min-w-0">
          <p className="font-medium text-brand-charcoal truncate">{submission.name}</p>
          <a
            href={`mailto:${submission.email}`}
            className="text-sm text-brand-navy hover:underline inline-flex items-center gap-1"
          >
            <Mail className="h-3 w-3" />
            {submission.email}
          </a>
        </div>
        <div className="text-right flex-shrink-0">
          <p className="text-xs text-gray-500">{formatDate(submission.created_at)}</p>
          {submission.want_to_try && (
            <span className="inline-block mt-1 text-[10px] bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full font-medium">
              Wants to try
            </span>
          )}
        </div>
      </div>
      {submission.what_for && (
        <p className="text-sm text-gray-700">
          <span className="text-xs text-gray-400 uppercase tracking-wide mr-2">What for</span>
          {submission.what_for}
        </p>
      )}
      {submission.how_found && (
        <p className="text-sm text-gray-600">
          <span className="text-xs text-gray-400 uppercase tracking-wide mr-2">How found</span>
          {submission.how_found}
        </p>
      )}
    </div>
  )
}

function formatDate(iso: string): string {
  try {
    const d = new Date(iso)
    return d.toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    })
  } catch {
    return iso
  }
}
