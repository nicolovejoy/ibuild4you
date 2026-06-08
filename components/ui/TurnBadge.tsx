'use client'

import { useState } from 'react'
import { Info, ArrowRight } from 'lucide-react'
import { copy } from '@/lib/copy'
import type { getTurnIndicator } from '@/lib/turn-indicator'

type Turn = NonNullable<ReturnType<typeof getTurnIndicator>>

/**
 * Renders a turn-state badge. For most states it's a plain pill. For
 * "Needs setup" — which is opaque to a builder seeing it for the first time —
 * it becomes an interactive chip: hover or click reveals what the state means
 * and the next action to take. Click-to-pin (with stopPropagation) so it works
 * inside the click-to-navigate dashboard cards and on touch.
 */
export function TurnBadge({ turn, className }: { turn: Turn; className: string }) {
  const [pinned, setPinned] = useState(false)

  if (turn.label !== copy.glossary.needsSetup.term) {
    return <span className={className}>{turn.label}</span>
  }

  const g = copy.glossary.needsSetup

  return (
    <span className="relative group inline-flex">
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation()
          setPinned((p) => !p)
        }}
        className={`inline-flex items-center gap-1 cursor-help ${className}`}
        aria-label={`${turn.label} — ${g.short}`}
      >
        {turn.label}
        <Info className="h-3 w-3 opacity-70" />
      </button>
      <span
        className={`absolute top-full left-0 mt-1 z-30 w-64 rounded-lg border border-gray-200 bg-white p-3 text-left shadow-lg ${
          pinned ? 'block' : 'hidden'
        } group-hover:block`}
        // Keep clicks inside the popover from bubbling to a parent card.
        onClick={(e) => e.stopPropagation()}
      >
        <span className="block text-xs font-semibold text-brand-charcoal normal-case">{g.term}</span>
        <span className="mt-1 block text-xs leading-relaxed text-brand-slate normal-case">{g.detail}</span>
        <span className="mt-2 flex items-start gap-1.5 text-xs font-medium text-brand-navy normal-case">
          <ArrowRight className="h-3.5 w-3.5 mt-0.5 shrink-0" />
          <span>{g.todo}</span>
        </span>
      </span>
    </span>
  )
}
