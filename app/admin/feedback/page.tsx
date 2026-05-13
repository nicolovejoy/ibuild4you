'use client'

import { useAuth } from '@/lib/hooks/useAuth'
import { useApproval } from '@/lib/hooks/useApproval'
import { useRouter } from 'next/navigation'
import { useEffect, useMemo, useState } from 'react'
import { ArrowLeft, ExternalLink, Save, Check, Github } from 'lucide-react'
import { useCurrentUser } from '@/lib/query/hooks'
import { apiFetch } from '@/lib/firebase/api-fetch'
import { useEscapeBack } from '@/lib/hooks/useEscapeBack'
import type { Feedback, FeedbackStatus, FeedbackType } from '@/lib/types'

const STATUSES: FeedbackStatus[] = ['new', 'acknowledged', 'in_progress', 'done', 'wontfix']
const TYPES: FeedbackType[] = ['bug', 'idea', 'other']

const STATUS_STYLES: Record<FeedbackStatus, string> = {
  new: 'bg-blue-100 text-blue-700',
  acknowledged: 'bg-amber-100 text-amber-700',
  in_progress: 'bg-purple-100 text-purple-700',
  done: 'bg-green-100 text-green-700',
  wontfix: 'bg-gray-200 text-gray-600',
}

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
      <header className="bg-white border-b border-gray-200 sticky top-0 z-10">
        <div className="px-4 sm:px-6 h-14 flex items-center gap-3">
          <button onClick={() => router.push('/admin')} className="p-1 hover:bg-gray-100 rounded">
            <ArrowLeft className="h-5 w-5 text-gray-600" />
          </button>
          <h1 className="font-semibold text-brand-charcoal">Feedback inbox</h1>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 py-6">
        <FeedbackList />
      </main>
    </div>
  )
}

function FeedbackList() {
  const [items, setItems] = useState<Feedback[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [projectId, setProjectId] = useState('')
  const [status, setStatus] = useState<FeedbackStatus | ''>('')
  const [type, setType] = useState<FeedbackType | ''>('')

  const queryString = useMemo(() => {
    const params = new URLSearchParams()
    if (projectId.trim()) params.set('projectId', projectId.trim())
    if (status) params.set('status', status)
    if (type) params.set('type', type)
    const s = params.toString()
    return s ? `?${s}` : ''
  }, [projectId, status, type])

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    ;(async () => {
      try {
        const res = await apiFetch(`/api/admin/feedback${queryString}`)
        if (!res.ok) throw new Error('Failed to load feedback')
        const data = (await res.json()) as Feedback[]
        if (!cancelled) setItems(data)
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load')
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [queryString])

  const handleUpdated = (updated: Feedback) => {
    setItems((prev) => prev.map((f) => (f.id === updated.id ? updated : f)))
  }

  return (
    <div className="space-y-4">
      <div className="bg-white rounded-lg border border-gray-200 p-3 flex flex-wrap gap-3 items-end">
        <label className="flex flex-col text-xs text-brand-slate">
          <span className="mb-1 uppercase tracking-wide">Project slug</span>
          <input
            type="text"
            value={projectId}
            onChange={(e) => setProjectId(e.target.value)}
            placeholder="e.g. bakery-louise"
            className="px-2 py-1 text-sm border border-gray-200 rounded focus:outline-none focus:ring-1 focus:ring-brand-navy"
          />
        </label>
        <label className="flex flex-col text-xs text-brand-slate">
          <span className="mb-1 uppercase tracking-wide">Status</span>
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value as FeedbackStatus | '')}
            className="px-2 py-1 text-sm border border-gray-200 rounded focus:outline-none focus:ring-1 focus:ring-brand-navy"
          >
            <option value="">all</option>
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col text-xs text-brand-slate">
          <span className="mb-1 uppercase tracking-wide">Type</span>
          <select
            value={type}
            onChange={(e) => setType(e.target.value as FeedbackType | '')}
            className="px-2 py-1 text-sm border border-gray-200 rounded focus:outline-none focus:ring-1 focus:ring-brand-navy"
          >
            <option value="">all</option>
            {TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </label>
        <div className="ml-auto text-xs text-gray-400 self-center">
          {loading ? 'Loading...' : `${items.length} item${items.length === 1 ? '' : 's'}`}
        </div>
      </div>

      {error && <div className="text-center text-red-500 py-6">{error}</div>}

      {!loading && !error && items.length === 0 && (
        <div className="text-center text-gray-400 py-12 bg-white rounded-lg border border-gray-200">
          No feedback yet.
        </div>
      )}

      <div className="space-y-3">
        {items.map((item) => (
          <FeedbackRow key={item.id} item={item} onUpdated={handleUpdated} />
        ))}
      </div>
    </div>
  )
}

function FeedbackRow({ item, onUpdated }: { item: Feedback; onUpdated: (f: Feedback) => void }) {
  const [status, setStatus] = useState<FeedbackStatus>(item.status)
  const [notes, setNotes] = useState<string>(item.internal_notes ?? '')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [convertingGh, setConvertingGh] = useState(false)
  const [ghErr, setGhErr] = useState<string | null>(null)

  const handleConvertToGithub = async () => {
    setConvertingGh(true)
    setGhErr(null)
    try {
      const res = await apiFetch(`/api/admin/feedback/${item.id}/to-github`, { method: 'POST' })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || 'GitHub conversion failed')
      }
      const updated = (await res.json()) as Feedback
      onUpdated(updated)
    } catch (e) {
      setGhErr(e instanceof Error ? e.message : 'GitHub conversion failed')
    } finally {
      setConvertingGh(false)
    }
  }

  const isDirty = status !== item.status || (notes || '') !== (item.internal_notes ?? '')

  const handleSave = async () => {
    setSaving(true)
    setErr(null)
    try {
      const res = await apiFetch(`/api/admin/feedback/${item.id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          status,
          internal_notes: notes.trim() ? notes : null,
        }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || 'Save failed')
      }
      const updated = (await res.json()) as Feedback
      onUpdated(updated)
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="bg-white rounded-lg border border-gray-200 p-4 space-y-3">
      <div className="flex items-baseline justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2 text-xs">
          <span
            className={`px-2 py-0.5 rounded-full font-medium ${STATUS_STYLES[item.status]}`}
            title="Current saved status"
          >
            {item.status}
          </span>
          <span className="text-gray-500 uppercase tracking-wide">{item.type}</span>
          <span className="text-gray-400">·</span>
          <span className="text-gray-500 font-mono">{item.project_id}</span>
        </div>
        <div className="text-xs text-gray-500">{formatDate(item.created_at)}</div>
      </div>

      <p className="text-sm text-brand-charcoal whitespace-pre-wrap">{item.body}</p>

      <div className="text-xs text-gray-500 flex flex-wrap gap-x-4 gap-y-1">
        <span>{item.submitter_email || 'anonymous'}</span>
        {item.page_url && (
          <a
            href={item.page_url}
            target="_blank"
            rel="noreferrer noopener"
            className="text-brand-navy hover:underline inline-flex items-center gap-1"
          >
            <ExternalLink className="h-3 w-3" />
            {truncate(item.page_url, 60)}
          </a>
        )}
        {item.viewport && <span>{item.viewport}</span>}
      </div>

      <div className="grid sm:grid-cols-[auto,1fr,auto] gap-2 items-start pt-2 border-t border-gray-100">
        <select
          value={status}
          onChange={(e) => setStatus(e.target.value as FeedbackStatus)}
          className="px-2 py-1 text-sm border border-gray-200 rounded focus:outline-none focus:ring-1 focus:ring-brand-navy"
        >
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Internal notes (not shown to submitter)"
          rows={2}
          className="px-2 py-1 text-sm border border-gray-200 rounded focus:outline-none focus:ring-1 focus:ring-brand-navy resize-y"
        />
        <div className="flex items-center gap-2 self-stretch">
          {saved ? (
            <Check className="h-4 w-4 text-green-500" />
          ) : (
            <button
              onClick={handleSave}
              disabled={!isDirty || saving}
              className="inline-flex items-center gap-1 px-3 py-1.5 text-sm border border-gray-200 rounded text-brand-charcoal hover:border-brand-navy hover:text-brand-navy disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
              title="Save changes"
            >
              <Save className="h-4 w-4" />
              Save
            </button>
          )}
        </div>
      </div>
      <div className="flex items-center gap-2 pt-2 border-t border-gray-100">
        {item.github_issue_url ? (
          <a
            href={item.github_issue_url}
            target="_blank"
            rel="noreferrer noopener"
            className="inline-flex items-center gap-1 text-xs text-brand-navy hover:underline"
          >
            <Github className="h-3 w-3" />
            Open GitHub issue
          </a>
        ) : (
          <button
            type="button"
            onClick={handleConvertToGithub}
            disabled={convertingGh}
            className="inline-flex items-center gap-1 px-2 py-1 text-xs border border-gray-200 rounded text-brand-charcoal hover:border-brand-navy hover:text-brand-navy disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
            title="Create a GitHub issue from this feedback"
          >
            <Github className="h-3 w-3" />
            {convertingGh ? 'Creating…' : 'Convert to GitHub issue'}
          </button>
        )}
        {ghErr && <span className="text-xs text-red-500">{ghErr}</span>}
      </div>
      {err && <p className="text-xs text-red-500">{err}</p>}
    </div>
  )
}

function truncate(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max - 1)}…` : s
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
