'use client'

import { copy } from '@/lib/copy'
import { nextRound } from '@/lib/builder/next-round'
import { pacificDay } from '@/lib/builder/settings-view'
import { CollapsibleSection } from './CollapsibleSection'
import type { Project, Session } from '@/lib/types'

const t = copy.nextRound

// What the next conversation will open with: the opening message, the mode,
// the questions or directives, and the nudge. Read only: these fields arrive
// with each paste and are not edited by hand. Starts folded so the transcript
// stays the first thing on the Conversations tab.
export function NextRoundPanel({
  project,
  sessions,
  unusedSessionId,
  onOpenImport,
}: {
  project: Project
  sessions: Session[]
  // The open conversation when the maker has not spoken in it (see nextRound).
  unusedSessionId: string | null
  onOpenImport?: () => void
}) {
  const round = nextRound({ project, sessions, unusedSessionId })
  const summary = round.pastedAt
    ? t.pasted(pacificDay(round.pastedAt), round.pastedVersion)
    : t.neverPasted

  return (
    <CollapsibleSection title={t.heading} summary={summary} defaultOpen={false}>
      <dl className="divide-y divide-brand-line-soft text-sm">
        <Row label={t.opening}>
          {round.opening.kind === 'welcome' ? (
            <p className="whitespace-pre-wrap text-gray-800">{round.opening.text}</p>
          ) : (
            <p className="text-brand-ink-soft">
              {round.opening.kind === 'default'
                ? t.openingDefault
                : round.opening.kind === 'nothing_queued'
                  ? t.openingNothingQueued
                  : t.openingKickoff}
            </p>
          )}
        </Row>
        <Row label={t.mode}>
          <p className="text-gray-800">
            {t.modes[round.mode]} <span className="text-brand-ink-soft">· {t.modeHelp[round.mode]}</span>
          </p>
        </Row>
        <Row label={t.points[round.mode]}>
          {round.points.length > 0 ? (
            <ol className="list-decimal pl-5 space-y-1 text-gray-800">
              {round.points.map((point, i) => (
                <li key={i}>{point}</li>
              ))}
            </ol>
          ) : (
            <p className="text-brand-ink-soft">{t.noPoints}</p>
          )}
        </Row>
        <Row label={t.nudge}>
          {round.nudge ? (
            <p className="whitespace-pre-wrap text-gray-800">{round.nudge}</p>
          ) : (
            <p className="text-brand-ink-soft">{t.nudgeDrafted}</p>
          )}
        </Row>
      </dl>
      <p className="mt-3 text-xs text-brand-ink-soft">
        {t.readOnly}{' '}
        {onOpenImport && (
          <button
            type="button"
            onClick={onOpenImport}
            className="font-medium text-brand-navy hover:underline"
          >
            {t.pasteLink}
          </button>
        )}
      </p>
    </CollapsibleSection>
  )
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="py-2.5 sm:grid sm:grid-cols-[9rem_1fr] sm:gap-4">
      <dt className="font-medium text-gray-700">{label}</dt>
      <dd className="mt-1 sm:mt-0 min-w-0">{children}</dd>
    </div>
  )
}
