'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { ChevronDown, Check } from 'lucide-react'
import { useProjects } from '@/lib/query/hooks'
import { BriefBadge } from '@/components/ui/BriefBadge'
import { RoleGlyph } from '@/components/ui/RoleGlyph'
import { viewerBriefRole } from '@/lib/roles/display'

// Lets a maker jump between their briefs from inside one, using the per-brief
// identity chips — so someone juggling several conversations doesn't have to
// route back through the dashboard to switch. Collapses to a plain title when
// the maker only has one brief.
export function BriefSwitcher({
  currentId,
  currentTitle,
  loading,
  compact = false,
}: {
  currentId: string | undefined
  currentTitle: string | undefined
  loading: boolean
  // compact: badge-only trigger (no title) — for the builder header, whose title
  // is a click-to-rename button we don't want to absorb into the switcher.
  compact?: boolean
}) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const { data: projects } = useProjects()

  const others = (projects ?? []).filter((p) => p.id !== currentId)
  const hasSwitcher = others.length > 0

  const label = compact ? (
    currentId && <BriefBadge id={currentId} size={16} />
  ) : (
    <>
      {currentId && <BriefBadge id={currentId} size={16} />}
      <span className="font-semibold text-brand-charcoal truncate">
        {loading ? '...' : currentTitle}
      </span>
    </>
  )

  if (!hasSwitcher) {
    if (compact) return currentId ? <BriefBadge id={currentId} size={16} /> : null
    return <div className="flex items-center gap-2 min-w-0">{label}</div>
  }

  return (
    <div className="relative min-w-0 shrink-0">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 min-w-0 hover:opacity-80"
        title="Switch brief"
      >
        {label}
        <ChevronDown className="h-4 w-4 text-gray-400 shrink-0" />
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute left-0 mt-2 w-72 max-h-80 overflow-auto bg-white rounded-lg shadow-lg border border-gray-200 py-1 z-20">
            <div className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-gray-400">
              Your briefs
            </div>
            {(projects ?? []).map((p) => {
              const isCurrent = p.id === currentId
              return (
                <button
                  key={p.id}
                  onClick={() => {
                    setOpen(false)
                    if (!isCurrent) router.push(`/projects/${p.slug || p.id}`)
                  }}
                  className="w-full text-left px-3 py-2 text-sm hover:bg-gray-50 flex items-center gap-2"
                >
                  <BriefBadge id={p.id} size={15} />
                  <span className="truncate flex-1 text-brand-charcoal">{p.title}</span>
                  {p.viewer_role && (
                    <RoleGlyph role={viewerBriefRole(p.viewer_role, p.viewer_brief_role)} size={14} />
                  )}
                  {isCurrent && <Check className="h-4 w-4 text-brand-navy shrink-0" />}
                </button>
              )
            })}
          </div>
        </>
      )}
    </div>
  )
}
