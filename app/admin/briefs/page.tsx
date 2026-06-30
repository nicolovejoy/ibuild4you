'use client'

import { useAuth } from '@/lib/hooks/useAuth'
import { useApproval } from '@/lib/hooks/useApproval'
import { useRouter } from 'next/navigation'
import { useState, useEffect, useMemo } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useCurrentUser } from '@/lib/query/hooks'
import { apiFetch } from '@/lib/firebase/api-fetch'
import { useEscapeBack } from '@/lib/hooks/useEscapeBack'
import { SectionHeader } from '@/components/section-header'

interface BriefListItem {
  id: string
  title?: string
  slug?: string
  requester_email?: string | null
}

interface DoctorSession {
  id: string
  status: string
  created_at: string
  message_count: number
}

interface SessionsResponse {
  project: { id: string; title: string; slug: string | null; session_count: number | null }
  sessions: DoctorSession[]
}

export default function BriefDoctorPage() {
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
      <SectionHeader backHref="/admin" title="Brief doctor" />
      <main className="max-w-4xl mx-auto px-4 py-6">
        <BriefDoctor />
      </main>
    </div>
  )
}

function BriefDoctor() {
  const [search, setSearch] = useState('')
  const [selectedId, setSelectedId] = useState<string | null>(null)

  const { data: briefs } = useQuery<BriefListItem[]>({
    queryKey: ['admin-briefs-list'],
    queryFn: async () => {
      const res = await apiFetch('/api/projects')
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const json = await res.json()
      return Array.isArray(json) ? json : (json.projects ?? [])
    },
    staleTime: 60 * 1000,
  })

  const matches = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return []
    return (briefs ?? [])
      .filter((b) =>
        [b.title, b.slug, b.requester_email].filter(Boolean).some((f) => String(f).toLowerCase().includes(q))
      )
      .slice(0, 12)
  }, [briefs, search])

  return (
    <div className="space-y-6">
      <p className="text-sm text-brand-slate">
        Inspect and repair a brief&apos;s conversations. All actions are non-destructive (archive, never
        delete) and logged to <code className="text-xs">admin_actions</code>.
      </p>

      <div>
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search a brief by title, slug, or maker email…"
          className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-brand-navy focus:border-brand-navy"
        />
        {matches.length > 0 && (
          <div className="mt-1 bg-white rounded-lg border border-gray-200 divide-y divide-gray-100">
            {matches.map((b) => (
              <button
                key={b.id}
                onClick={() => {
                  setSelectedId(b.id)
                  setSearch('')
                }}
                className="w-full text-left px-3 py-2 text-sm hover:bg-gray-50"
              >
                <span className="text-brand-charcoal">{b.title || '(no title)'}</span>
                {b.requester_email && <span className="text-gray-400"> · {b.requester_email}</span>}
              </button>
            ))}
          </div>
        )}
      </div>

      {selectedId && <BriefSessions projectId={selectedId} />}
    </div>
  )
}

function BriefSessions({ projectId }: { projectId: string }) {
  const queryClient = useQueryClient()
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const { data, isLoading } = useQuery<SessionsResponse>({
    queryKey: ['admin-brief-sessions', projectId],
    queryFn: async () => {
      const res = await apiFetch(`/api/admin/sessions?project_id=${projectId}`)
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body.error || `HTTP ${res.status}`)
      }
      return res.json()
    },
  })

  const runOp = async (op: string, args: Record<string, unknown>) => {
    setBusy(true)
    setError(null)
    try {
      const res = await apiFetch('/api/admin/sessions', {
        method: 'POST',
        body: JSON.stringify({ project_id: projectId, op, ...args }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`)
      await queryClient.invalidateQueries({ queryKey: ['admin-brief-sessions', projectId] })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Operation failed')
    } finally {
      setBusy(false)
    }
  }

  if (isLoading) return <div className="text-gray-400 py-8 animate-pulse">Loading conversations…</div>
  if (!data) return null

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-brand-charcoal">
          {data.project.title}
          <span className="text-gray-400 font-normal"> · {data.sessions.length} conversations</span>
        </h2>
        <ResetButton disabled={busy} onConfirm={() => runOp('reset_to_fresh', {})} />
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-2 rounded-lg text-sm">{error}</div>
      )}

      <div className="bg-white rounded-lg border border-gray-200 divide-y divide-gray-100">
        {data.sessions.map((s, i) => (
          <SessionRow
            key={s.id}
            session={s}
            index={i + 1}
            briefTitle={data.project.title}
            busy={busy}
            runOp={runOp}
          />
        ))}
        {data.sessions.length === 0 && (
          <div className="px-4 py-6 text-sm text-gray-400">No conversations.</div>
        )}
      </div>
    </div>
  )
}

const STATUS_STYLES: Record<string, string> = {
  active: 'bg-green-100 text-green-800',
  completed: 'bg-blue-100 text-blue-800',
  archived: 'bg-gray-100 text-gray-500',
}

function SessionRow({
  session,
  index,
  briefTitle,
  busy,
  runOp,
}: {
  session: DoctorSession
  index: number
  briefTitle: string
  busy: boolean
  runOp: (op: string, args: Record<string, unknown>) => void
}) {
  const [confirming, setConfirming] = useState<null | 'archive' | 'message'>(null)
  const [typed, setTyped] = useState('')
  const [msg, setMsg] = useState('')
  const [role, setRole] = useState<'user' | 'agent'>('user')

  const isArchived = session.status === 'archived'
  const hasMessages = session.message_count > 0

  return (
    <div className="px-4 py-3 text-sm">
      <div className="flex items-center gap-3">
        <span className={`inline-flex shrink-0 px-2 py-0.5 rounded text-xs font-medium ${STATUS_STYLES[session.status] ?? 'bg-gray-100 text-gray-500'}`}>
          {session.status}
        </span>
        <div className="flex-1 min-w-0">
          <p className="text-brand-charcoal">
            Conversation #{index}
            <span className="text-gray-400"> · {session.message_count} messages</span>
          </p>
          <p className="text-xs text-gray-400 truncate">{formatTs(session.created_at)}</p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {isArchived ? (
            <button
              disabled={busy}
              onClick={() => runOp('reopen_conversation', { reopen_id: session.id })}
              className="px-2 py-1 text-xs border border-gray-200 rounded hover:border-brand-navy text-brand-charcoal disabled:opacity-50"
            >
              Reactivate
            </button>
          ) : (
            <button
              disabled={busy}
              onClick={() => (hasMessages ? setConfirming('archive') : runOp('archive_conversation', { session_id: session.id }))}
              className="px-2 py-1 text-xs border border-gray-200 rounded hover:border-red-400 text-brand-charcoal disabled:opacity-50"
            >
              Archive
            </button>
          )}
          <button
            disabled={busy}
            onClick={() => setConfirming(confirming === 'message' ? null : 'message')}
            className="px-2 py-1 text-xs border border-gray-200 rounded hover:border-brand-navy text-brand-charcoal disabled:opacity-50"
          >
            Add test msg
          </button>
        </div>
      </div>

      {confirming === 'archive' && (
        <div className="mt-2 bg-amber-50 border border-amber-200 rounded p-3 space-y-2">
          <p className="text-xs text-amber-800">
            This conversation has {session.message_count} messages. Type the brief title{' '}
            <span className="font-medium">“{briefTitle}”</span> to confirm archiving.
          </p>
          <div className="flex items-center gap-2">
            <input
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              placeholder={briefTitle}
              className="flex-1 px-2 py-1 text-sm border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-brand-navy"
            />
            <button
              disabled={busy || typed !== briefTitle}
              onClick={() => {
                runOp('archive_conversation', { session_id: session.id, confirm_title: typed })
                setConfirming(null)
                setTyped('')
              }}
              className="px-3 py-1 text-xs bg-red-600 text-white rounded disabled:opacity-40"
            >
              Archive
            </button>
            <button onClick={() => setConfirming(null)} className="px-3 py-1 text-xs text-gray-500">
              Cancel
            </button>
          </div>
        </div>
      )}

      {confirming === 'message' && (
        <div className="mt-2 bg-gray-50 border border-gray-200 rounded p-3 space-y-2">
          <div className="flex items-center gap-2">
            <select
              value={role}
              onChange={(e) => setRole(e.target.value as 'user' | 'agent')}
              className="px-2 py-1 text-sm border border-gray-300 rounded"
            >
              <option value="user">maker</option>
              <option value="agent">agent</option>
            </select>
            <input
              value={msg}
              onChange={(e) => setMsg(e.target.value)}
              placeholder="Synthetic message text (flips turn-state)"
              className="flex-1 px-2 py-1 text-sm border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-brand-navy"
            />
            <button
              disabled={busy || !msg.trim()}
              onClick={() => {
                runOp('add_synthetic_message', { session_id: session.id, role, content: msg })
                setConfirming(null)
                setMsg('')
              }}
              className="px-3 py-1 text-xs bg-brand-navy text-white rounded disabled:opacity-40"
            >
              Add
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

function ResetButton({ disabled, onConfirm }: { disabled: boolean; onConfirm: () => void }) {
  const [confirming, setConfirming] = useState(false)
  if (!confirming) {
    return (
      <button
        disabled={disabled}
        onClick={() => setConfirming(true)}
        className="px-2 py-1 text-xs border border-gray-200 rounded hover:border-amber-400 text-brand-charcoal disabled:opacity-50"
      >
        Reset to fresh
      </button>
    )
  }
  return (
    <div className="flex items-center gap-2">
      <span className="text-xs text-amber-700">Archive all conversations?</span>
      <button
        disabled={disabled}
        onClick={() => {
          onConfirm()
          setConfirming(false)
        }}
        className="px-2 py-1 text-xs bg-amber-600 text-white rounded disabled:opacity-50"
      >
        Yes, reset
      </button>
      <button onClick={() => setConfirming(false)} className="px-2 py-1 text-xs text-gray-500">
        Cancel
      </button>
    </div>
  )
}

function formatTs(iso?: string): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
}
