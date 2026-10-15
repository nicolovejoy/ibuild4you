'use client'

import { useState } from 'react'
import { History, ChevronDown, ChevronRight } from 'lucide-react'
import { useBriefVersions, useUpdateBrief } from '@/lib/query/hooks'
import { formatPacific } from '@/lib/email/format'
import { copy } from '@/lib/copy'

// #194: archived versions of the brief, under the read view. Collapsed by
// default and fetched only when opened. Restore re-submits an archived version
// through the normal PUT (source 'restore'), so locks and provenance behave as
// a paste and the version being replaced is itself archived.
export function BriefHistory({ projectId }: { projectId: string }) {
  const c = copy.brief
  const [open, setOpen] = useState(false)
  const [confirming, setConfirming] = useState<number | null>(null)
  const { data: versions, isLoading } = useBriefVersions(projectId, open)
  const updateBrief = useUpdateBrief()

  const restore = (content: unknown) => {
    updateBrief.mutate({ project_id: projectId, content, source: 'restore' })
    setConfirming(null)
  }

  return (
    <div className="mt-4 pt-3 border-t border-gray-100">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 text-xs text-gray-500 hover:text-brand-navy"
      >
        {open ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
        <History className="h-3.5 w-3.5" /> {c.history}
      </button>

      {open && (
        <div className="mt-2 space-y-1.5">
          {isLoading && <p className="text-xs text-gray-400">{c.historyLoading}</p>}
          {!isLoading && versions && versions.length === 0 && (
            <p className="text-xs text-gray-400">{c.historyEmpty}</p>
          )}
          {versions?.map((v) => (
            <div key={v.version} className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-gray-600">
              <span className="font-medium text-gray-800">v{v.version}</span>
              <span>{formatPacific(v.updated_at)}</span>
              <span className="text-gray-400">{c.sourceLabel(v.source)}</span>
              {confirming === v.version ? (
                <span className="flex items-center gap-2">
                  <span className="text-gray-700">{c.confirmRestore(v.version)}</span>
                  <button
                    onClick={() => restore(v.content)}
                    disabled={updateBrief.isPending}
                    className="font-medium text-brand-navy hover:underline disabled:opacity-40"
                  >
                    {c.confirmRestoreButton}
                  </button>
                  <button onClick={() => setConfirming(null)} className="text-gray-500 hover:underline">
                    {c.cancelRestore}
                  </button>
                </span>
              ) : (
                <button
                  onClick={() => setConfirming(v.version)}
                  disabled={updateBrief.isPending}
                  className="text-brand-navy hover:underline disabled:opacity-40"
                >
                  {c.restore}
                </button>
              )}
            </div>
          ))}
          {updateBrief.error && <p className="text-xs text-red-500">{updateBrief.error.message}</p>}
        </div>
      )}
    </div>
  )
}
