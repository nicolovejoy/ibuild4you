'use client'

import { useId, useState } from 'react'
import { ChevronRight } from 'lucide-react'
import { Card } from '@/components/ui/Card'

// A card whose heading folds it. The heading row always shows a one-line
// summary, so a folded section still says what is inside. Used by the builder
// Settings tab and the Conversations tab's "Next round" panel.
export function CollapsibleSection({
  title,
  summary,
  defaultOpen = true,
  children,
}: {
  title: string
  summary?: string
  defaultOpen?: boolean
  children: React.ReactNode
}) {
  const [open, setOpen] = useState(defaultOpen)
  const bodyId = useId()

  return (
    <Card hover={false}>
      <h2>
        <button
          type="button"
          aria-expanded={open}
          aria-controls={bodyId}
          onClick={() => setOpen(!open)}
          className="w-full flex items-center gap-3 min-h-14 px-5 py-2 text-left"
        >
          <ChevronRight
            aria-hidden
            className={`h-4 w-4 shrink-0 text-brand-ink-soft transition-transform ${open ? 'rotate-90' : ''}`}
          />
          <span className="font-heading text-[15px] font-semibold text-brand-charcoal">
            {title}
          </span>
          {summary && (
            <span className="ml-auto min-w-0 truncate text-[13px] text-brand-ink-soft">{summary}</span>
          )}
        </button>
      </h2>
      {open && (
        <div id={bodyId} className="px-5 pb-4 sm:pl-12">
          {children}
        </div>
      )}
    </Card>
  )
}
