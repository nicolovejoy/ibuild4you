'use client'

import { useAuth } from '@/lib/hooks/useAuth'
import { useApproval } from '@/lib/hooks/useApproval'
import { useRouter, useParams } from 'next/navigation'
import { useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { apiFetch } from '@/lib/firebase/api-fetch'
import { ArrowLeft, FileText } from 'lucide-react'
import { Card, CardBody } from '@/components/ui/Card'
import { EmptyState } from '@/components/ui/EmptyState'
import { Skeleton } from '@/components/ui/Skeleton'
import { StatusMessage } from '@/components/ui/StatusMessage'
import type { Brief, BriefContent } from '@/lib/types'

export default function BriefPage() {
  const { user, loading: authLoading, isAuthenticated } = useAuth()
  const { approved, loading: approvalLoading } = useApproval()
  const router = useRouter()
  const params = useParams()
  const projectId = params.id as string

  useEffect(() => {
    if (!authLoading && !isAuthenticated) router.push('/auth/login')
  }, [authLoading, isAuthenticated, router])

  useEffect(() => {
    if (!approvalLoading && approved === false && isAuthenticated) router.push('/not-approved')
  }, [approvalLoading, approved, isAuthenticated, router])

  const {
    data: brief,
    isLoading,
    error,
  } = useQuery<Brief | null>({
    queryKey: ['brief', projectId],
    queryFn: async () => {
      const res = await apiFetch(`/api/briefs?project_id=${projectId}`)
      if (!res.ok) throw new Error('Failed to load brief')
      return res.json()
    },
    enabled: !!projectId && !!user && !!approved,
  })

  if (authLoading || approvalLoading || !user || !approved) {
    return (
      <div className="min-h-screen bg-brand-cream flex items-center justify-center">
        <div className="animate-pulse text-brand-slate">Loading...</div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-brand-cream">
      <header className="bg-white border-b border-gray-200">
        <div className="px-4 sm:px-6 h-14 flex items-center gap-3">
          <button
            onClick={() => router.push(`/projects/${projectId}`)}
            className="p-1 hover:bg-gray-100 rounded"
          >
            <ArrowLeft className="h-5 w-5 text-gray-600" />
          </button>
          <FileText className="h-5 w-5 text-brand-navy" />
          <span className="font-semibold text-brand-charcoal">Project brief</span>
          {brief && (
            <span className="text-xs text-brand-slate ml-2">v{brief.version}</span>
          )}
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-4 py-8">
        {isLoading ? (
          <div className="space-y-4">
            <Skeleton className="h-8 w-48 rounded" />
            <Skeleton className="h-24 w-full rounded-lg" />
            <Skeleton className="h-24 w-full rounded-lg" />
          </div>
        ) : error ? (
          <StatusMessage type="error" message="Failed to load brief." />
        ) : !brief ? (
          <EmptyState
            icon={FileText}
            title="No brief yet"
            description="Chat with the agent for a bit and a brief will be generated automatically."
          />
        ) : (
          <BriefView content={brief.content as unknown as BriefContent} />
        )}
      </main>
    </div>
  )
}

function BriefView({ content }: { content: BriefContent }) {
  const sections = [
    { label: 'Problem', value: content.problem },
    { label: 'Target users', value: content.target_users },
    {
      label: 'Features',
      value:
        content.features?.length > 0
          ? content.features
          : null,
    },
    { label: 'Constraints', value: content.constraints },
    { label: 'Additional context', value: content.additional_context },
  ]

  const hasContent = sections.some((s) =>
    Array.isArray(s.value) ? s.value.length > 0 : !!s.value
  )

  if (!hasContent) {
    return (
      <EmptyState
        icon={FileText}
        title="Brief is empty"
        description="Keep chatting — the brief fills in as the agent learns about your project."
      />
    )
  }

  return (
    <div className="space-y-4">
      {sections.map((section) => {
        if (!section.value || (Array.isArray(section.value) && section.value.length === 0)) {
          return null
        }

        return (
          <Card key={section.label} hover={false}>
            <CardBody>
              <h3 className="text-sm font-semibold text-brand-slate uppercase tracking-wide mb-2">
                {section.label}
              </h3>
              {Array.isArray(section.value) ? (
                <ul className="list-disc list-inside space-y-1">
                  {section.value.map((item, i) => (
                    <li key={i} className="text-gray-800 text-sm">
                      {item}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-gray-800 text-sm leading-relaxed">{section.value}</p>
              )}
            </CardBody>
          </Card>
        )
      })}
    </div>
  )
}
