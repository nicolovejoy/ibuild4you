'use client'

import { useAuth } from '@/lib/hooks/useAuth'
import { useApproval } from '@/lib/hooks/useApproval'
import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useApps, useCreateApp, useCurrentUser } from '@/lib/query/hooks'
import { useEscapeBack } from '@/lib/hooks/useEscapeBack'
import { SectionHeader } from '@/components/section-header'
import { copy } from '@/lib/copy'

const t = copy.adminApps

// Loop apps: host sites that embed the feedback widget. Admins see every app
// and can create them; app owners and collaborators see only their own.
export default function AppsAdminPage() {
  const { user, loading: authLoading, isAuthenticated } = useAuth()
  const { approved, loading: approvalLoading } = useApproval()
  const { data: currentUser, isLoading: roleLoading } = useCurrentUser()
  const router = useRouter()
  useEscapeBack(currentUser?.system_roles?.includes('admin') ? '/admin' : '/dashboard')

  useEffect(() => {
    if (!authLoading && !isAuthenticated) router.push('/auth/login')
  }, [authLoading, isAuthenticated, router])

  useEffect(() => {
    if (!approvalLoading && approved === false && isAuthenticated) router.push('/not-approved')
  }, [approvalLoading, approved, isAuthenticated, router])

  if (authLoading || approvalLoading || roleLoading) {
    return (
      <div className="min-h-screen bg-brand-cream flex items-center justify-center">
        <div className="animate-pulse text-brand-slate">{copy.loading}</div>
      </div>
    )
  }

  if (!user || !approved) return null

  const isAdmin = currentUser?.system_roles?.includes('admin') ?? false

  return (
    <div className="min-h-screen bg-brand-cream">
      <SectionHeader
        backHref={isAdmin ? '/admin' : '/dashboard'}
        title={isAdmin ? t.pageTitle : t.yourApps}
      />
      <main className="max-w-5xl mx-auto px-4 py-6 space-y-6">
        {isAdmin && <NewAppForm />}
        {isAdmin ? <AppsTable /> : <MyApps />}
      </main>
    </div>
  )
}

function NewAppForm() {
  const create = useCreateApp()
  const [slug, setSlug] = useState('')
  const [name, setName] = useState('')
  const [repo, setRepo] = useState('')
  const [error, setError] = useState<string | null>(null)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    try {
      // The slug goes to the server exactly as typed; it validates, not us.
      await create.mutateAsync({
        slug,
        name,
        ...(repo.trim() ? { github_repo: repo.trim() } : {}),
      })
      setSlug('')
      setName('')
      setRepo('')
    } catch (err) {
      const msg = err instanceof Error ? err.message : ''
      if (msg === 'Invalid slug') setError(t.errorInvalidSlug)
      else if (msg === 'Slug already in use') setError(t.errorSlugTaken)
      else setError(msg || t.errorGeneric)
    }
  }

  const input =
    'px-2 py-1 text-sm border border-gray-200 rounded focus:outline-none focus:ring-1 focus:ring-brand-navy'

  return (
    <form onSubmit={submit} className="bg-white rounded-lg border border-gray-200 p-4 space-y-3">
      <h2 className="text-sm font-medium text-brand-charcoal">{t.newApp}</h2>
      <div className="grid sm:grid-cols-3 gap-3">
        <label className="flex flex-col text-xs text-brand-slate">
          <span className="mb-1 uppercase tracking-wide">{t.slugLabel}</span>
          <input
            aria-label={t.slugLabel}
            value={slug}
            onChange={(e) => setSlug(e.target.value)}
            className={input}
          />
          <span className="mt-1 text-gray-400">{t.slugHint}</span>
        </label>
        <label className="flex flex-col text-xs text-brand-slate">
          <span className="mb-1 uppercase tracking-wide">{t.nameLabel}</span>
          <input
            aria-label={t.nameLabel}
            value={name}
            onChange={(e) => setName(e.target.value)}
            className={input}
          />
        </label>
        <label className="flex flex-col text-xs text-brand-slate">
          <span className="mb-1 uppercase tracking-wide">{t.repoLabel}</span>
          <input
            aria-label={t.repoLabel}
            value={repo}
            onChange={(e) => setRepo(e.target.value)}
            placeholder="owner/name"
            className={input}
          />
          <span className="mt-1 text-gray-400">{t.repoHint}</span>
        </label>
      </div>
      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={create.isPending || !slug || !name.trim()}
          className="px-3 py-1.5 text-sm border border-gray-200 rounded text-brand-charcoal hover:border-brand-navy hover:text-brand-navy disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
        >
          {create.isPending ? t.creating : t.create}
        </button>
        {error && (
          <p role="alert" className="text-xs text-red-500">
            {error}
          </p>
        )}
      </div>
    </form>
  )
}

function AppsTable() {
  const { data: apps, isLoading, error } = useApps()

  if (isLoading) return <div className="text-center text-gray-400 py-6">{copy.loading}</div>
  if (error) return <div className="text-center text-red-500 py-6">{error.message}</div>
  if (!apps || apps.length === 0) {
    return (
      <div className="text-center text-gray-400 py-12 bg-white rounded-lg border border-gray-200">
        {t.noApps}
      </div>
    )
  }

  return (
    <div className="bg-white rounded-lg border border-gray-200 overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs uppercase tracking-wide text-brand-slate border-b border-gray-100">
            <th className="px-3 py-2">{t.colName}</th>
            <th className="px-3 py-2">{t.colSlug}</th>
            <th className="px-3 py-2">{t.colLegacy}</th>
            <th className="px-3 py-2">{t.colRepo}</th>
            <th className="px-3 py-2">{t.colIdentity}</th>
            <th className="px-3 py-2" />
          </tr>
        </thead>
        <tbody>
          {apps.map((a) => (
            <tr key={a.slug} data-app-slug={a.slug} className="border-b border-gray-50 last:border-0">
              <td className="px-3 py-2 text-brand-charcoal">{a.name}</td>
              <td className="px-3 py-2 font-mono text-xs">{a.slug}</td>
              <td className="px-3 py-2 font-mono text-xs text-gray-500">
                {(a.legacy_slugs ?? []).join(', ') || '—'}
              </td>
              <td className="px-3 py-2 text-xs">{a.github_repo || '—'}</td>
              <td className="px-3 py-2 text-xs">{a.feedback_requires_identity ? t.yes : t.no}</td>
              <td className="px-3 py-2 text-right">
                <Link href={`/admin/apps/${a.slug}`} className="text-brand-navy hover:underline">
                  {t.open}
                </Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// Non-admin view: just the apps the caller owns or collaborates on.
function MyApps() {
  const { data: apps, isLoading, error } = useApps()

  if (isLoading) return <div className="text-center text-gray-400 py-6">{copy.loading}</div>
  if (error) return <div className="text-center text-red-500 py-6">{error.message}</div>
  if (!apps || apps.length === 0) {
    return (
      <div className="text-center text-gray-400 py-12 bg-white rounded-lg border border-gray-200">
        {t.noAccessApps}
      </div>
    )
  }

  return (
    <div className="bg-white rounded-lg border border-gray-200 overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs uppercase tracking-wide text-brand-slate border-b border-gray-100">
            <th className="px-3 py-2">{t.colName}</th>
            <th className="px-3 py-2">{t.colSlug}</th>
            <th className="px-3 py-2">{t.accessLabel}</th>
            <th className="px-3 py-2" />
          </tr>
        </thead>
        <tbody>
          {apps.map((a) => (
            <tr key={a.slug} data-app-slug={a.slug} className="border-b border-gray-50 last:border-0">
              <td className="px-3 py-2 text-brand-charcoal">{a.name}</td>
              <td className="px-3 py-2 font-mono text-xs">{a.slug}</td>
              <td className="px-3 py-2 text-xs">
                {a.access === 'collaborator' ? t.accessCollaborator : t.accessOwner}
              </td>
              <td className="px-3 py-2 text-right">
                <Link href={`/admin/apps/${a.slug}`} className="text-brand-navy hover:underline">
                  {t.open}
                </Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
