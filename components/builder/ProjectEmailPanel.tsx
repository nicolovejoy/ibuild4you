'use client'

import { useState } from 'react'
import { useCreateProjectEmailIn, useProjectEmailIn } from '@/lib/query/hooks'
import { copy } from '@/lib/copy'
import { CopyField } from '@/components/ui/CopyField'

const t = copy.projectEmail

// A calendar day shown to a person is Pacific (UTC at rest, Pacific on display).
const dayFmt = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/Los_Angeles',
  month: 'long',
  day: 'numeric',
})

const button =
  'px-3 py-1.5 text-sm border border-gray-200 rounded text-brand-charcoal hover:border-brand-navy hover:text-brand-navy disabled:opacity-30 disabled:cursor-not-allowed transition-colors'

// Who the GET accepts: an owner or builder on the project, or a system admin
// (an implicit owner on every project; their viewer_role can be a membership
// role or 'admin'). The mount checks this before the panel, so the hook never
// fires for a viewer the server would refuse.
export function canSeeProjectEmail(
  viewerRole: string | null | undefined,
  isSystemAdmin: boolean
): boolean {
  return isSystemAdmin || viewerRole === 'owner' || viewerRole === 'builder' || viewerRole === 'admin'
}

// The project's email address: the builder keeps it on CC, and mail from
// members becomes brief notes. Shows the address (or offers to create it), the
// newest emails received (who, when, subject; never the text), and what was
// ignored and why.
export function ProjectEmailPanel({ projectId }: { projectId: string }) {
  const { data, isLoading, error: loadError } = useProjectEmailIn(projectId)
  const create = useCreateProjectEmailIn(projectId)
  const [error, setError] = useState<string | null>(null)

  const onCreate = async () => {
    setError(null)
    try {
      await create.mutateAsync()
    } catch {
      setError(t.error)
    }
  }

  const dropped = data?.dropped
  const droppedLines: string[] = []
  if (dropped) {
    if (dropped.not_member > 0) droppedLines.push(t.droppedNotMember(dropped.not_member))
    if (dropped.auth_failed > 0) {
      droppedLines.push(t.droppedAuthFailed(dropped.auth_failed, dropped.last_auth_failed_from ?? ''))
    }
    if (dropped.over_limit > 0) droppedLines.push(t.droppedOverLimit(dropped.over_limit))
  }
  // When the latest drop was, said once under the lines. Skipped when the
  // stored time does not parse (format would throw on an invalid date).
  const lastDropMs = dropped?.last_at ? Date.parse(dropped.last_at) : NaN
  const lastDropLine =
    droppedLines.length > 0 && !Number.isNaN(lastDropMs) ? t.droppedLastAt(dayFmt.format(new Date(lastDropMs))) : null

  return (
    <section className="bg-white rounded-lg border border-gray-200 p-4 space-y-3">
      <h2 className="text-sm font-medium text-brand-charcoal">{t.heading}</h2>

      {isLoading && <div className="text-gray-400 text-sm">{t.loading}</div>}

      {data && !data.address && (
        <>
          <p className="text-sm text-brand-charcoal">{t.none}</p>
          <button type="button" onClick={onCreate} disabled={create.isPending} className={button}>
            {t.create}
          </button>
        </>
      )}

      {data?.address && (
        <>
          <div className="space-y-1">
            <CopyField
              id={`project-email-${projectId}`}
              label={t.addressLabel}
              value={data.address}
              copyLabel={t.copy}
              copiedLabel={t.copied}
            />
            <p className="text-xs text-gray-500">{t.howTo}</p>
          </div>

          <div className="space-y-1">
            <h3 className="text-xs font-medium text-gray-500">{t.recentHeading}</h3>
            {data.recent.length === 0 ? (
              <p className="text-sm text-gray-500">{t.noneReceived}</p>
            ) : (
              <ul className="space-y-0.5">
                {data.recent.map((e, i) => (
                  <li key={`${e.received_at}-${i}`} className="text-sm text-brand-charcoal">
                    {t.recentRow(
                      dayFmt.format(new Date(e.received_at)),
                      e.from_name,
                      t.roles[e.from_role],
                      e.subject || t.noSubject
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>

          {droppedLines.length > 0 && (
            <div className="space-y-1">
              {droppedLines.map((line) => (
                <p key={line} className="text-xs text-amber-700">
                  {line}
                </p>
              ))}
              {lastDropLine && <p className="text-xs text-gray-500">{lastDropLine}</p>}
            </div>
          )}
        </>
      )}

      {(error || loadError) && (
        <p role="alert" className="text-xs text-red-500">
          {error ?? t.loadError}
        </p>
      )}
    </section>
  )
}
