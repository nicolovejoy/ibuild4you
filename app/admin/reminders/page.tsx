'use client'

import { useAuth } from '@/lib/hooks/useAuth'
import { useApproval } from '@/lib/hooks/useApproval'
import { useRouter } from 'next/navigation'
import { useState, useEffect } from 'react'
import { RefreshCw } from 'lucide-react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useCurrentUser } from '@/lib/query/hooks'
import { apiFetch } from '@/lib/firebase/api-fetch'
import { useEscapeBack } from '@/lib/hooks/useEscapeBack'
import { SectionHeader } from '@/components/section-header'

interface ReminderDecision {
  id: string
  project_id: string
  project_title?: string | null
  maker_email?: string | null
  decision: 'sent' | 'would_send' | 'skipped' | 'error'
  reason?: string | null
  reminder_number?: number | null
  days_since_last_touch?: number | null
  dry_run?: boolean
  decided_at?: string
}

interface RemindersResponse {
  rows: ReminderDecision[]
  truncated: boolean
}

interface ReminderProject {
  id: string
  title: string
  requester_email?: string | null
  auto_reminders_enabled: boolean
  reminders_sent_count: number
  last_reminder_sent_at?: string | null
}

const DECISION_FILTERS = ['all', 'sent', 'would_send', 'skipped', 'error'] as const
type DecisionFilter = (typeof DECISION_FILTERS)[number]

const DECISION_STYLES: Record<ReminderDecision['decision'], string> = {
  sent: 'bg-green-100 text-green-800',
  would_send: 'bg-blue-100 text-blue-800',
  skipped: 'bg-gray-100 text-gray-600',
  error: 'bg-red-100 text-red-700',
}

export default function RemindersPage() {
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
      <SectionHeader backHref="/admin" title="Maker reminders" />
      <main className="max-w-5xl mx-auto px-4 py-6">
        <RemindersDashboard />
      </main>
    </div>
  )
}

function RemindersDashboard() {
  const [filter, setFilter] = useState<DecisionFilter>('all')

  const { data, isLoading, isFetching, error, refetch } = useQuery<RemindersResponse>({
    queryKey: ['admin-reminders', filter],
    queryFn: async () => {
      const qs = filter === 'all' ? '' : `?decision=${filter}`
      const res = await apiFetch(`/api/admin/reminders${qs}`)
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body.error || `HTTP ${res.status}`)
      }
      return res.json()
    },
    staleTime: 60 * 1000,
  })

  return (
    <div className="space-y-6">
      <AutoReminderToggles />

      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-2">
          <span className="text-sm text-brand-slate">Decision:</span>
          <div className="flex rounded-lg border border-gray-200 bg-white overflow-hidden">
            {DECISION_FILTERS.map((f) => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={`px-3 py-1.5 text-sm transition-colors ${
                  filter === f
                    ? 'bg-brand-navy text-white'
                    : 'text-brand-charcoal hover:bg-gray-50'
                }`}
              >
                {f === 'would_send' ? 'would-send' : f}
              </button>
            ))}
          </div>
        </div>
        <button
          onClick={() => refetch()}
          disabled={isFetching}
          className="inline-flex items-center gap-2 px-3 py-1.5 text-sm bg-white border border-gray-200 rounded-lg hover:border-brand-navy text-brand-charcoal disabled:opacity-50"
        >
          <RefreshCw className={`h-4 w-4 ${isFetching ? 'animate-spin' : ''}`} />
          Refresh
        </button>
      </div>

      <p className="text-xs text-brand-slate">
        Every daily cron decision is logged here. <span className="font-medium">would-send</span> rows
        are dry-run previews (only when REMINDER_DRY_RUN is set) — no email was sent and the cadence
        counter was not advanced.
      </p>

      {isLoading && (
        <div className="text-center text-gray-400 py-12 animate-pulse">Loading decisions…</div>
      )}

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm">
          {error instanceof Error ? error.message : 'Failed to load reminders'}
        </div>
      )}

      {data && data.rows.length === 0 && !isLoading && (
        <div className="text-center text-gray-400 py-12">No reminder decisions yet.</div>
      )}

      {data && data.rows.length > 0 && (
        <div className="bg-white rounded-lg border border-gray-200 divide-y divide-gray-100">
          {data.rows.map((row) => (
            <DecisionRow key={row.id} row={row} />
          ))}
          {data.truncated && (
            <div className="px-4 py-2 text-xs text-gray-400 text-center">
              Showing the most recent decisions only.
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function AutoReminderToggles() {
  const queryClient = useQueryClient()
  const [pendingId, setPendingId] = useState<string | null>(null)

  const { data, isLoading, error } = useQuery<{ projects: ReminderProject[] }>({
    queryKey: ['admin-reminder-projects'],
    queryFn: async () => {
      const res = await apiFetch('/api/admin/reminders/projects')
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body.error || `HTTP ${res.status}`)
      }
      return res.json()
    },
    staleTime: 60 * 1000,
  })

  const toggle = async (p: ReminderProject) => {
    setPendingId(p.id)
    try {
      const res = await apiFetch('/api/projects', {
        method: 'PATCH',
        body: JSON.stringify({ project_id: p.id, auto_reminders_enabled: !p.auto_reminders_enabled }),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      // Refresh both the toggle list and the decision log (a flip changes what
      // the next cron tick will do).
      await queryClient.invalidateQueries({ queryKey: ['admin-reminder-projects'] })
      await queryClient.invalidateQueries({ queryKey: ['admin-reminders'] })
    } catch {
      // Re-fetch to snap the switch back to the true server state on failure.
      await queryClient.invalidateQueries({ queryKey: ['admin-reminder-projects'] })
    } finally {
      setPendingId(null)
    }
  }

  return (
    <div className="bg-white rounded-lg border border-gray-200">
      <div className="px-4 py-3 border-b border-gray-100">
        <h2 className="text-sm font-semibold text-brand-charcoal">Auto-reminders</h2>
        <p className="text-xs text-brand-slate mt-0.5">
          Toggle the daily reminder cron per brief. On = the maker gets nudged on the 2 / 5 / 10-day
          cadence (max 3) until they reply.
        </p>
      </div>

      {isLoading && <div className="px-4 py-6 text-sm text-gray-400 animate-pulse">Loading…</div>}

      {error && (
        <div className="px-4 py-3 text-sm text-red-700">
          {error instanceof Error ? error.message : 'Failed to load projects'}
        </div>
      )}

      {data && data.projects.length === 0 && !isLoading && (
        <div className="px-4 py-6 text-sm text-gray-400">No briefs with a maker email yet.</div>
      )}

      {data && data.projects.length > 0 && (
        <div className="divide-y divide-gray-100">
          {data.projects.map((p) => (
            <div key={p.id} className="flex items-center gap-3 px-4 py-3 text-sm">
              <div className="flex-1 min-w-0">
                <p className="text-brand-charcoal truncate">{p.title}</p>
                <p className="text-xs text-gray-400 truncate">
                  {p.requester_email}
                  {p.reminders_sent_count > 0 ? ` · ${p.reminders_sent_count} sent` : ''}
                </p>
              </div>
              <span className={`text-xs ${p.auto_reminders_enabled ? 'text-brand-navy' : 'text-gray-400'}`}>
                {p.auto_reminders_enabled ? 'On' : 'Off'}
              </span>
              <Switch
                on={p.auto_reminders_enabled}
                disabled={pendingId === p.id}
                onClick={() => toggle(p)}
              />
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function Switch({ on, disabled, onClick }: { on: boolean; disabled?: boolean; onClick: () => void }) {
  return (
    <button
      role="switch"
      aria-checked={on}
      disabled={disabled}
      onClick={onClick}
      className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors disabled:opacity-50 disabled:cursor-wait ${
        on ? 'bg-brand-navy' : 'bg-gray-300'
      }`}
    >
      <span
        className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
          on ? 'translate-x-6' : 'translate-x-1'
        }`}
      />
    </button>
  )
}

function DecisionRow({ row }: { row: ReminderDecision }) {
  return (
    <div className="flex items-center gap-3 px-4 py-3 text-sm">
      <span
        className={`inline-flex shrink-0 px-2 py-0.5 rounded text-xs font-medium ${DECISION_STYLES[row.decision]}`}
      >
        {row.decision === 'would_send' ? 'would-send' : row.decision}
      </span>
      <div className="flex-1 min-w-0">
        <p className="text-brand-charcoal truncate">
          {row.project_title || row.project_id}
          {row.reminder_number ? <span className="text-gray-400"> · reminder #{row.reminder_number}</span> : null}
        </p>
        <p className="text-xs text-gray-400 truncate">
          {row.reason ? `${row.reason} · ` : ''}
          {row.days_since_last_touch != null ? `${row.days_since_last_touch.toFixed(1)}d since touch · ` : ''}
          {row.maker_email || '(no email)'}
        </p>
      </div>
      <span className="shrink-0 text-xs text-gray-400 tabular-nums">{formatTs(row.decided_at)}</span>
    </div>
  )
}

function formatTs(iso?: string): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}
