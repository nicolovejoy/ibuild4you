'use client'

// #229: the Brief tab's view of per-conversation notes. Two pieces:
//   - StalePrepNotice: shown when a paste answered 409 (stale prep). Lists the
//     notes the prep missed by Pacific day and offers Save anyway.
//   - UnfoldedNotesList: a collapsible, read-only list of notes not yet folded
//     into the brief ("New since last curation (N)"); hidden when N is 0.

import { useState } from 'react'
import { ChevronDown, ChevronRight, NotebookPen } from 'lucide-react'
import { StatusMessage } from '@/components/ui/StatusMessage'
import { LoadingButton } from '@/components/ui/LoadingButton'
import { copy } from '@/lib/copy'
import { normalizeRisks, riskOwner, riskText } from '@/lib/brief/risks'
import type { StalePrepInfo } from '@/lib/query/hooks'
import type { BriefNote } from '@/lib/types'

const c = copy.brief

// A note's calendar day, Pacific (UTC at rest, Pacific on display).
const dayFormat = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Los_Angeles', month: 'short', day: 'numeric' })
export function noteDay(iso: string): string {
  return dayFormat.format(new Date(iso))
}

export function StalePrepNotice({
  info,
  saving,
  onSaveAnyway,
}: {
  info: StalePrepInfo
  saving: boolean
  onSaveAnyway: () => void
}) {
  return (
    <div className="space-y-2">
      <StatusMessage
        type="warning"
        message={`${c.stalePrepTitle}: ${c.stalePrepNote(info.unlisted_notes.length, info.live_version, info.prep_version)}`}
      />
      {info.unlisted_notes.length > 0 && (
        <ul className="pl-4 text-xs text-gray-600 list-disc">
          {info.unlisted_notes.map((n) => (
            <li key={n.id}>{c.stalePrepMissedNote(noteDay(n.created_at))}</li>
          ))}
        </ul>
      )}
      <LoadingButton variant="secondary" size="sm" loading={saving} loadingText={c.savingAnyway} onClick={onSaveAnyway}>
        {c.saveAnyway}
      </LoadingButton>
    </div>
  )
}

// One note as plain lines: its text, then each structured entry.
function noteLines(n: BriefNote): string[] {
  const lines: string[] = []
  if (n.text?.trim()) lines.push(n.text.trim())
  for (const d of n.decisions ?? []) lines.push(c.noteDecision(d.topic, d.decision))
  for (const r of normalizeRisks(n.risks_added)) lines.push(c.noteRiskAdded(riskText(r), riskOwner(r)))
  for (const t of n.risks_resolved ?? []) lines.push(c.noteRiskResolved(t))
  for (const l of n.lock_reversals ?? []) lines.push(c.noteLockReversal(l.topic, l.proposed, l.reason))
  return lines
}

export function UnfoldedNotesList({ notes }: { notes: BriefNote[] | undefined }) {
  const [open, setOpen] = useState(false)
  if (!notes || notes.length === 0) return null
  return (
    <div className="pt-2">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex items-center gap-1.5 text-xs text-gray-500 hover:text-brand-navy"
      >
        {open ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
        <NotebookPen className="h-3.5 w-3.5" /> {c.newSinceCuration(notes.length)}
      </button>
      {open && (
        <div className="mt-2 space-y-3">
          {notes.map((n) => (
            <div key={n.id} className="text-xs text-gray-600">
              <p className="font-medium text-gray-800">{c.noteHeading(noteDay(n.created_at))}</p>
              {noteLines(n).map((line, i) => (
                <p key={i}>{line}</p>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
