'use client'

import { useAuth } from '@/lib/hooks/useAuth'
import { useApproval } from '@/lib/hooks/useApproval'
import { useParams, useRouter } from 'next/navigation'
import { Suspense, useEffect, useState } from 'react'
import { HttpError, useApp, useUpdateApp } from '@/lib/query/hooks'
import { useEscapeBack } from '@/lib/hooks/useEscapeBack'
import { SectionHeader } from '@/components/section-header'
import { FeedbackInbox } from '@/components/admin/FeedbackInbox'
import { ManageAdmins } from '@/components/admin/ManageAdmins'
import { copy } from '@/lib/copy'
import type { App } from '@/lib/types'

const t = copy.adminApps

// One Loop app: settings (admins), its feedback (anyone with access) and its
// admin list (owners). The API decides access; a 403 sends the caller home, a 503 says Garm is down.
// `?id=<feedbackId>` deep-links to one item in the list.
export default function AppAdminPage() {
  const { slug } = useParams<{ slug: string }>()
  const { user, loading: authLoading, isAuthenticated } = useAuth()
  const { approved, loading: approvalLoading } = useApproval()
  const router = useRouter()
  useEscapeBack('/admin/apps')

  useEffect(() => {
    if (!authLoading && !isAuthenticated) router.push('/auth/login')
  }, [authLoading, isAuthenticated, router])

  useEffect(() => {
    if (!approvalLoading && approved === false && isAuthenticated) router.push('/not-approved')
  }, [approvalLoading, approved, isAuthenticated, router])

  if (authLoading || approvalLoading) {
    return (
      <div className="min-h-screen bg-brand-cream flex items-center justify-center">
        <div className="animate-pulse text-brand-slate">{copy.loading}</div>
      </div>
    )
  }

  if (!user || !approved) return null

  return <AppBody slug={slug} />
}

function AppBody({ slug }: { slug: string }) {
  const { data: app, isLoading, error } = useApp(slug)
  const router = useRouter()
  const forbidden = error instanceof HttpError && error.status === 403
  // Garm down: say so and stay put (no redirect, it is not a refusal).
  const garmDown = error instanceof HttpError && error.status === 503

  useEffect(() => {
    if (forbidden) router.push('/dashboard')
  }, [forbidden, router])

  return (
    <div className="min-h-screen bg-brand-cream">
      <SectionHeader backHref="/admin/apps" title={app?.name ?? slug} />
      <main className="max-w-5xl mx-auto px-4 py-6 space-y-6">
        {isLoading && <div className="text-center text-gray-400 py-6">{copy.loading}</div>}
        {garmDown && (
          <div role="alert" className="text-center text-red-500 py-6">
            {t.errorGarmDown}
          </div>
        )}
        {error && !forbidden && !garmDown && (
          <div className="text-center text-red-500 py-6">{t.notFound}</div>
        )}
        {app && (
          <>
            {app.access === 'admin' && <SettingsForm app={app} />}
            {(app.access === 'admin' || app.access === 'owner') && <ManageAdmins slug={app.slug} />}
            <section className="space-y-3">
              <h2 className="text-sm font-medium text-brand-charcoal">{t.feedbackHeading}</h2>
              <Suspense fallback={<div className="text-center text-gray-400 py-12">{copy.loading}</div>}>
                <FeedbackInbox projectId={app.slug} />
              </Suspense>
            </section>
          </>
        )}
      </main>
    </div>
  )
}

function SettingsForm({ app }: { app: App }) {
  const update = useUpdateApp()
  const [name, setName] = useState(app.name)
  const [repo, setRepo] = useState(app.github_repo ?? '')
  const [identity, setIdentity] = useState(!!app.feedback_requires_identity)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setSaved(false)
    try {
      // "" clears github_repo on the server.
      await update.mutateAsync({
        slug: app.slug,
        name,
        github_repo: repo.trim(),
        feedback_requires_identity: identity,
      })
      setSaved(true)
    } catch (err) {
      setError(err instanceof Error && err.message ? err.message : t.saveFailed)
    }
  }

  const input =
    'px-2 py-1 text-sm border border-gray-200 rounded focus:outline-none focus:ring-1 focus:ring-brand-navy'

  return (
    <form onSubmit={submit} className="bg-white rounded-lg border border-gray-200 p-4 space-y-3">
      <h2 className="text-sm font-medium text-brand-charcoal">{t.settings}</h2>
      <p className="text-xs text-gray-500">
        {t.slugLabel}: <span className="font-mono">{app.slug}</span>
        {(app.legacy_slugs ?? []).length > 0 && (
          <>
            {' · '}
            {t.colLegacy}: <span className="font-mono">{app.legacy_slugs!.join(', ')}</span>
          </>
        )}
      </p>
      <div className="grid sm:grid-cols-2 gap-3">
        <label className="flex flex-col text-xs text-brand-slate">
          <span className="mb-1 uppercase tracking-wide">{t.nameLabel}</span>
          <input value={name} onChange={(e) => setName(e.target.value)} className={input} />
        </label>
        <label className="flex flex-col text-xs text-brand-slate">
          <span className="mb-1 uppercase tracking-wide">{t.repoLabel}</span>
          <input
            value={repo}
            onChange={(e) => setRepo(e.target.value)}
            placeholder="owner/name"
            className={input}
          />
        </label>
      </div>
      <label className="flex items-center gap-2 text-sm text-brand-charcoal">
        <input type="checkbox" checked={identity} onChange={(e) => setIdentity(e.target.checked)} />
        {t.requiresIdentity}
      </label>
      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={update.isPending || !name.trim()}
          className="px-3 py-1.5 text-sm border border-gray-200 rounded text-brand-charcoal hover:border-brand-navy hover:text-brand-navy disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
        >
          {update.isPending ? t.saving : t.save}
        </button>
        {saved && <span className="text-xs text-green-600">{t.saved}</span>}
        {error && (
          <p role="alert" className="text-xs text-red-500">
            {error}
          </p>
        )}
      </div>
    </form>
  )
}
