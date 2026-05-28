'use client'

import { useAuth } from '@/lib/hooks/useAuth'
import { useApproval } from '@/lib/hooks/useApproval'
import { useRouter } from 'next/navigation'
import { useState, useEffect } from 'react'
import { RefreshCw } from 'lucide-react'
import { useQuery } from '@tanstack/react-query'
import { useCurrentUser } from '@/lib/query/hooks'
import { apiFetch } from '@/lib/firebase/api-fetch'
import { useEscapeBack } from '@/lib/hooks/useEscapeBack'
import { SectionHeader } from '@/components/section-header'
import type { UsageRollup, GroupTotals } from '@/lib/api/usage-rollup'

const DAY_OPTIONS = [1, 3, 7, 14, 30] as const

export default function UsagePage() {
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
      <SectionHeader backHref="/admin" title="Anthropic API usage" />

      <main className="max-w-5xl mx-auto px-4 py-6">
        <UsageDashboard />
      </main>
    </div>
  )
}

function UsageDashboard() {
  const [days, setDays] = useState<(typeof DAY_OPTIONS)[number]>(7)

  const { data, isLoading, isFetching, error, refetch } = useQuery<UsageRollup>({
    queryKey: ['admin-usage', days],
    queryFn: async () => {
      const res = await apiFetch(`/api/admin/usage?days=${days}`)
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
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-2">
          <span className="text-sm text-brand-slate">Window:</span>
          <div className="flex rounded-lg border border-gray-200 bg-white overflow-hidden">
            {DAY_OPTIONS.map((d) => (
              <button
                key={d}
                onClick={() => setDays(d)}
                className={`px-3 py-1.5 text-sm transition-colors ${
                  days === d
                    ? 'bg-brand-navy text-white'
                    : 'text-brand-charcoal hover:bg-gray-50'
                }`}
              >
                {d}d
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

      {isLoading && (
        <div className="text-center text-gray-400 py-12 animate-pulse">Loading usage…</div>
      )}

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm">
          {error instanceof Error ? error.message : 'Failed to load usage'}
        </div>
      )}

      {data && (
        <>
          <TotalsCard data={data} />
          <RollupTable
            title="By route"
            rows={data.by_route}
            keyHeader="route"
          />
          <RollupTable
            title="By model"
            rows={data.by_model}
            keyHeader="model"
          />
          <RollupTable
            title="By day"
            rows={data.by_day}
            keyHeader="day"
          />
          <RollupTable
            title="By project (top 20 by cost)"
            rows={data.by_project.slice(0, 20)}
            keyHeader="project"
            renderKey={(row) => row.label || (row.key === '(none)' ? row.key : row.key.slice(0, 12) + '…')}
          />
          <TopCallsTable rows={data.top_calls} />
        </>
      )}
    </div>
  )
}

function TotalsCard({ data }: { data: UsageRollup }) {
  return (
    <div className="bg-white border border-gray-200 rounded-lg p-4 flex flex-wrap gap-6 text-sm">
      <div>
        <div className="text-xs uppercase tracking-wide text-brand-slate">Total cost</div>
        <div className="text-2xl font-semibold text-brand-charcoal">${data.total_cost.toFixed(2)}</div>
      </div>
      <div>
        <div className="text-xs uppercase tracking-wide text-brand-slate">Calls</div>
        <div className="text-2xl font-semibold text-brand-charcoal">{data.total_calls}</div>
      </div>
      <div>
        <div className="text-xs uppercase tracking-wide text-brand-slate">Window</div>
        <div className="text-2xl font-semibold text-brand-charcoal">{data.days}d</div>
      </div>
      <div className="text-xs text-gray-400 self-end ml-auto">
        since {data.since.slice(0, 16).replace('T', ' ')}Z
      </div>
    </div>
  )
}

function RollupTable({
  title,
  rows,
  keyHeader,
  renderKey,
}: {
  title: string
  rows: GroupTotals[]
  keyHeader: string
  renderKey?: (row: GroupTotals) => string
}) {
  if (rows.length === 0) {
    return (
      <section>
        <h2 className="text-sm font-semibold text-brand-slate uppercase tracking-wide mb-2">{title}</h2>
        <div className="text-center text-gray-400 py-6 bg-white border border-gray-200 rounded-lg">No rows</div>
      </section>
    )
  }
  return (
    <section>
      <h2 className="text-sm font-semibold text-brand-slate uppercase tracking-wide mb-2">{title}</h2>
      <div className="overflow-x-auto bg-white border border-gray-200 rounded-lg">
        <table className="min-w-full text-sm">
          <thead className="bg-gray-50 text-xs uppercase tracking-wide text-brand-slate">
            <tr>
              <th className="px-3 py-2 text-left">{keyHeader}</th>
              <th className="px-3 py-2 text-right">calls</th>
              <th className="px-3 py-2 text-right">cost</th>
              <th className="px-3 py-2 text-right">input</th>
              <th className="px-3 py-2 text-right">output</th>
              <th className="px-3 py-2 text-right">cache r</th>
              <th className="px-3 py-2 text-right">cache c</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {rows.map((r) => (
              <tr key={r.key} className="hover:bg-gray-50">
                <td className="px-3 py-2 font-mono text-xs">
                  {renderKey ? renderKey(r) : r.key}
                </td>
                <td className="px-3 py-2 text-right">{r.calls}</td>
                <td className="px-3 py-2 text-right font-mono">${r.cost.toFixed(2)}</td>
                <td className="px-3 py-2 text-right font-mono text-xs">{r.input.toLocaleString()}</td>
                <td className="px-3 py-2 text-right font-mono text-xs">{r.output.toLocaleString()}</td>
                <td className="px-3 py-2 text-right font-mono text-xs">{r.cache_read.toLocaleString()}</td>
                <td className="px-3 py-2 text-right font-mono text-xs">{r.cache_create.toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}

function TopCallsTable({
  rows,
}: {
  rows: UsageRollup['top_calls']
}) {
  if (rows.length === 0) return null
  return (
    <section>
      <h2 className="text-sm font-semibold text-brand-slate uppercase tracking-wide mb-2">
        Top 10 individual calls
      </h2>
      <div className="overflow-x-auto bg-white border border-gray-200 rounded-lg">
        <table className="min-w-full text-sm">
          <thead className="bg-gray-50 text-xs uppercase tracking-wide text-brand-slate">
            <tr>
              <th className="px-3 py-2 text-left">when</th>
              <th className="px-3 py-2 text-left">route</th>
              <th className="px-3 py-2 text-left">project</th>
              <th className="px-3 py-2 text-right">cost</th>
              <th className="px-3 py-2 text-right">in</th>
              <th className="px-3 py-2 text-right">out</th>
              <th className="px-3 py-2 text-right">cache r</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {rows.map((r, i) => (
              <tr key={i} className="hover:bg-gray-50">
                <td className="px-3 py-2 font-mono text-xs whitespace-nowrap">
                  {r.created_at.slice(0, 16).replace('T', ' ')}
                </td>
                <td className="px-3 py-2 text-xs">{r.route}</td>
                <td className="px-3 py-2 font-mono text-xs">
                  {r.project_label || r.project_id?.slice(0, 12) + '…'}
                </td>
                <td className="px-3 py-2 text-right font-mono">${r.cost_usd.toFixed(3)}</td>
                <td className="px-3 py-2 text-right font-mono text-xs">{r.input_tokens.toLocaleString()}</td>
                <td className="px-3 py-2 text-right font-mono text-xs">{r.output_tokens.toLocaleString()}</td>
                <td className="px-3 py-2 text-right font-mono text-xs">{r.cache_read_input_tokens.toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}
