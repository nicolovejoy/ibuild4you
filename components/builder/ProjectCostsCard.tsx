'use client'

import { useState } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'
import { Card } from '@/components/ui/Card'
import { useProjectUsage } from '@/lib/query/hooks'
import { PROJECT_USAGE_MAX_ROWS } from '@/lib/api/project-usage'
import { formatCostUsd } from '@/lib/observability/session-cost'

// Admin-only: what this brief has cost in Anthropic API calls, by route and
// by conversation (#185). Collapsed by default — it's operator telemetry, not
// reading material (#120). Data comes from GET /api/projects/[id]/usage.
// The caller mounts this only for admins, so the hook is always enabled here.

// Dates for humans are Pacific, with the zone named.
const pacific = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/Los_Angeles',
  month: 'short',
  day: 'numeric',
  year: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
  timeZoneName: 'short',
})

function plural(n: number): string {
  return `${n} ${n === 1 ? 'call' : 'calls'}`
}

function fmtDate(iso: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '' : pacific.format(d)
}

export function ProjectCostsCard({ projectId }: { projectId: string }) {
  const [open, setOpen] = useState(false)
  const { data, isLoading, error } = useProjectUsage(projectId, true)

  const total = data ? `~${formatCostUsd(data.total_cost)}` : isLoading ? '…' : '—'

  return (
    <Card hover={false}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="w-full flex items-center justify-between px-4 py-3 text-left"
      >
        <span className="text-sm font-semibold text-brand-slate uppercase tracking-wide flex items-center gap-2">
          {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
          API costs
        </span>
        <span className="text-sm text-gray-600 tabular-nums">{total}</span>
      </button>

      {open && (
        <div className="px-4 pb-4 space-y-4 text-sm">
          {error && <p className="text-red-600">Couldn&apos;t load usage.</p>}
          {data && data.total_calls === 0 && (
            <p className="text-gray-500">No API calls yet for this brief.</p>
          )}
          {data && data.total_calls > 0 && (
            <>
              <section>
                <h3 className="text-xs font-medium text-gray-500 mb-1">By conversation</h3>
                <table className="w-full">
                  <tbody>
                    {data.by_session.map((s) => (
                      <tr key={s.key} className="border-t border-gray-100">
                        <td className="py-1.5 pr-2">
                          <div className="text-gray-900">{s.label}</div>
                          {s.session_created_at ? (
                            <div className="text-xs text-gray-400">{fmtDate(s.session_created_at)}</div>
                          ) : (
                            s.first_call_at && (
                              <div className="text-xs text-gray-400">first call {fmtDate(s.first_call_at)}</div>
                            )
                          )}
                        </td>
                        <td className="py-1.5 pr-2 text-right text-gray-500 tabular-nums">{plural(s.calls)}</td>
                        <td className="py-1.5 text-right text-gray-900 tabular-nums">~{formatCostUsd(s.cost)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </section>

              <section>
                <h3 className="text-xs font-medium text-gray-500 mb-1">By route</h3>
                <table className="w-full">
                  <tbody>
                    {data.by_route.map((g) => (
                      <tr key={g.key} className="border-t border-gray-100">
                        <td className="py-1.5 pr-2 text-gray-900 font-mono text-xs">{g.key}</td>
                        <td className="py-1.5 pr-2 text-right text-gray-500 tabular-nums">{plural(g.calls)}</td>
                        <td className="py-1.5 text-right text-gray-900 tabular-nums">~{formatCostUsd(g.cost)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </section>

              <p className="text-xs text-gray-400">
                List-price estimate from logged token counts, {plural(data.total_calls)} total.
                Conversations with no API calls are not listed. Conversation figures come from the
                call log and may exceed the per-conversation badge on conversations older than
                2026-06-20 (when the badge started counting).
                {data.truncated &&
                  ` Only ${PROJECT_USAGE_MAX_ROWS.toLocaleString('en-US')} of this brief's calls were read, so every figure here is an undercount.`}
              </p>
            </>
          )}
        </div>
      )}
    </Card>
  )
}
