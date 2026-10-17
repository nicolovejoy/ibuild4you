'use client'

import React, { useState } from 'react'
import { Upload, ClipboardCopy, Check, ChevronRight, ChevronDown } from 'lucide-react'
import { LoadingButton } from '@/components/ui/LoadingButton'
import { StatusMessage } from '@/components/ui/StatusMessage'
import { copy } from '@/lib/copy'
import type { FerryStamp, FerryStamps } from '@/lib/builder/ferry-stamps'

// The Brief tab's "ferry desk": copy the prep out, paste the payload back,
// Import. Purely presentational — BriefTab owns data, mutations and the
// clipboard; this component only lays it out and reports clicks.

type FerryDeskProps = {
  stamps: FerryStamps
  briefVersion: number | null
  sessionCount: number
  pasteValue: string
  onPasteChange: (v: string) => void
  pasteError: string | null
  importing: boolean
  onImport: () => void
  copyingPrep: boolean
  prepCopied: boolean // 2s "Copied!" flash state owned by parent
  onCopyPrep: () => void
  copyPrepDisabled?: boolean // e.g. while the project is still loading (#215)
  onEscapeEmpty: () => void // parent navigates to /dashboard
  textareaRef?: React.Ref<HTMLTextAreaElement>
  notices?: React.ReactNode // post-import notes, shown right under the actions
  children: React.ReactNode // Details body
}

function StampCard({
  testId,
  label,
  stamp,
  subLine,
  hot = false,
}: {
  testId: string
  label: string
  stamp: FerryStamp
  subLine?: string
  hot?: boolean
}) {
  return (
    <div
      data-testid={testId}
      className={`rounded-lg border bg-white px-3 py-2 ${hot ? 'border-brand-navy' : 'border-gray-200'}`}
    >
      <div className="text-xs text-gray-500">{label}</div>
      <div className="text-sm font-medium text-brand-navy">
        {stamp.absolute || copy.brief.never}
      </div>
      {subLine && (
        <div className={`text-xs ${hot ? 'text-brand-navy' : 'text-gray-500'}`}>{subLine}</div>
      )}
    </div>
  )
}

export function FerryDesk({
  stamps,
  briefVersion,
  sessionCount,
  pasteValue,
  onPasteChange,
  pasteError,
  importing,
  onImport,
  copyingPrep,
  prepCopied,
  onCopyPrep,
  copyPrepDisabled = false,
  onEscapeEmpty,
  textareaRef,
  notices,
  children,
}: FerryDeskProps) {
  // Collapsed by default: the ferry loop is the page; the brief, history,
  // regen and attachments are one labelled click away.
  const [detailsOpen, setDetailsOpen] = useState(false)

  const { copied, pasted, maker } = stamps
  const pastedSub = [pasted.relative, pasted.version != null ? copy.brief.pastedVersion(pasted.version) : '']
    .filter(Boolean)
    .join(' · ')
  const makerSub = [
    maker.who,
    maker.relative,
    maker.newerThanPaste ? copy.brief.newerThanPaste : '',
  ]
    .filter(Boolean)
    .join(' · ')

  // The page-level useEscapeBack ignores keydowns inside a textarea, so the
  // paste box handles Escape itself: empty box → leave, filled box → blur
  // (so a stray Esc never throws away a pasted payload). stopPropagation
  // keeps any outer Escape listener from firing a second time.
  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key !== 'Escape') return
    e.stopPropagation()
    if (pasteValue.trim() === '') onEscapeEmpty()
    else (e.target as HTMLTextAreaElement).blur()
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <kbd className="rounded border border-gray-300 px-1.5 py-0.5 font-sans text-xs text-gray-400">
          {copy.brief.escHint}
        </kbd>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <StampCard
          testId="stamp-copied"
          label={copy.brief.stampCopied}
          stamp={copied}
          subLine={copied.relative}
        />
        <StampCard
          testId="stamp-pasted"
          label={copy.brief.stampPasted}
          stamp={pasted}
          subLine={pastedSub}
        />
        <StampCard
          testId="stamp-maker"
          label={copy.brief.stampMaker}
          stamp={maker}
          subLine={makerSub}
          hot={maker.newerThanPaste}
        />
      </div>

      <textarea
        ref={textareaRef}
        value={pasteValue}
        onChange={(e) => onPasteChange(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder={copy.brief.pastePlaceholder}
        className="w-full min-h-[55vh] rounded-lg border border-gray-300 bg-white p-3 font-mono text-sm focus:border-brand-navy focus:outline-none"
      />

      {pasteError && <StatusMessage type="error" message={pasteError} />}

      <div className="flex flex-wrap items-center gap-3">
        <LoadingButton
          variant="primary"
          icon={Upload}
          loading={importing}
          disabled={pasteValue.trim() === ''}
          onClick={onImport}
        >
          {copy.brief.importButton}
        </LoadingButton>
        <LoadingButton
          variant="secondary"
          icon={prepCopied ? Check : ClipboardCopy}
          loading={copyingPrep}
          disabled={copyPrepDisabled}
          onClick={onCopyPrep}
        >
          {prepCopied ? copy.brief.copied : copy.brief.copyPrep}
        </LoadingButton>
        <span className="ml-auto text-sm text-gray-400">
          {copy.brief.versionLine(briefVersion, sessionCount)}
        </span>
      </div>

      {/* Next to the Import button on purpose: after an import with ignored
          fields the box clears, and this is where the builder is looking. */}
      {notices && <div className="space-y-2">{notices}</div>}

      <div className="border-t border-gray-200 pt-3">
        <div className="flex items-baseline gap-3">
          <button
            type="button"
            onClick={() => setDetailsOpen((open) => !open)}
            aria-expanded={detailsOpen}
            className="flex items-center gap-1 self-center text-sm font-medium text-brand-navy"
          >
            {detailsOpen ? (
              <ChevronDown className="h-4 w-4" />
            ) : (
              <ChevronRight className="h-4 w-4" />
            )}
            {copy.brief.details}
          </button>
          {!detailsOpen && <span className="text-xs text-gray-400">{copy.brief.detailsHint}</span>}
        </div>
        {detailsOpen && <div className="mt-3">{children}</div>}
      </div>
    </div>
  )
}
