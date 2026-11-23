'use client'

import { useState } from 'react'
import {
  useCreateProjectEmailIn,
  useProjectEmailIn,
  useProjectEmailMessage,
  type ProjectEmailMessage,
} from '@/lib/query/hooks'
import { copy } from '@/lib/copy'
import { CopyField } from '@/components/ui/CopyField'
import { Modal } from '@/components/ui/Modal'

const t = copy.projectEmail

// A calendar day shown to a person is Pacific (UTC at rest, Pacific on display).
const dayFmt = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/Los_Angeles',
  month: 'long',
  day: 'numeric',
})

const button =
  'px-3 py-1.5 text-sm border border-brand-line rounded text-brand-charcoal hover:border-brand-navy hover:text-brand-navy disabled:opacity-30 disabled:cursor-not-allowed transition-colors'

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

type ReadLine = ProjectEmailMessage['quotes'][number]['lines'][number]

// Consecutive lines of one kind (and, inside a quote, one writer) form a group.
// A blank line belongs to the group it sits in and never starts one, so a gap in
// a quote does not split it; a blank before any group is dropped.
function groupLines(lines: ReadLine[]): { kind: ReadLine['kind']; by: string | null; lines: ReadLine[] }[] {
  const groups: { kind: ReadLine['kind']; by: string | null; lines: ReadLine[] }[] = []
  for (const line of lines) {
    const last = groups[groups.length - 1]
    if (line.text === '') {
      if (last) last.lines.push(line)
    } else if (last && last.kind === line.kind && last.by === line.by) {
      last.lines.push(line)
    } else {
      groups.push({ kind: line.kind, by: line.by, lines: [line] })
    }
  }
  return groups
}

// The body of the modal: one stored email as the note writer read it.
function EmailMessage({ message }: { message: ProjectEmailMessage }) {
  const nothingNew = !message.repeat && message.typed === '' && message.quotes.length === 0
  return (
    <div className="space-y-3 text-sm text-brand-charcoal">
      <p className="text-xs text-brand-ink-soft">
        {t.openFrom(dayFmt.format(new Date(message.received_at)), message.from_name, t.roles[message.from_role])}
      </p>
      <p className="text-xs text-brand-ink-soft">{t.openIntro}</p>
      {message.repeat && <p>{t.openRepeat}</p>}
      {nothingNew && <p>{t.openNothingNew}</p>}
      {message.truncated && <p>{t.openTruncated}</p>}

      {message.typed !== '' && (
        <div className="space-y-1">
          <h4 className="text-xs font-medium text-brand-ink-soft">{t.openTyped}</h4>
          <p className="whitespace-pre-wrap break-words">{message.typed}</p>
        </div>
      )}

      {message.quotes.map((quote, qi) => (
        <div key={qi} className="space-y-1">
          <h4 className="text-xs font-medium text-brand-ink-soft">{t.openQuoted(quote.label)}</h4>
          {quote.header && <p className="text-xs text-brand-ink-soft whitespace-pre-wrap break-words">{quote.header}</p>}
          {groupLines(quote.lines).map((group, gi) => (
            <div
              key={gi}
              className={
                group.kind === 'context'
                  ? 'text-brand-ink-soft'
                  : group.kind === 'inside'
                    ? 'border-l-2 border-brand-line pl-3'
                    : ''
              }
            >
              {group.kind === 'context' && <p className="text-xs">{t.openContext}</p>}
              {group.kind === 'inside' && <p className="text-xs text-brand-ink-soft">{t.openInside(group.by ?? '')}</p>}
              {group.lines.map((line, li) => (
                // An empty div would collapse, so a blank line keeps a line's height.
                <div key={li} className="min-h-5 break-words">
                  {line.text}
                </div>
              ))}
            </div>
          ))}
        </div>
      ))}
    </div>
  )
}

// The project's email address: the builder keeps it on CC, and mail from
// members becomes brief notes. Shows the address (or offers to create it), the
// newest emails received (who, when, subject; never the text), and what was
// ignored and why.
export function ProjectEmailPanel({ projectId }: { projectId: string }) {
  const { data, isLoading, error: loadError } = useProjectEmailIn(projectId)
  const create = useCreateProjectEmailIn(projectId)
  const [error, setError] = useState<string | null>(null)
  // The received email that is open in the modal; closing clears it.
  const [opened, setOpened] = useState<{ id: string; subject: string } | null>(null)
  const message = useProjectEmailMessage(projectId, opened?.id ?? null)

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
    <section className="bg-white rounded-lg border border-brand-line p-4 space-y-3">
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
            <p className="text-xs text-brand-ink-soft">{t.howTo}</p>
          </div>

          <div className="space-y-1">
            <h3 className="text-xs font-medium text-brand-ink-soft">{t.recentHeading}</h3>
            {data.recent.length === 0 ? (
              <p className="text-sm text-brand-ink-soft">{t.noneReceived}</p>
            ) : (
              <ul className="space-y-0.5">
                {data.recent.map((e) => (
                  <li key={e.id} className="text-sm text-brand-charcoal">
                    {/* Looks like the plain row it was; the text is the button's name. */}
                    <button
                      type="button"
                      onClick={() => setOpened({ id: e.id, subject: e.subject })}
                      className="text-left break-words hover:underline focus-visible:outline-2 focus-visible:outline-brand-navy rounded-sm"
                    >
                      {t.recentRow(
                        dayFmt.format(new Date(e.received_at)),
                        e.from_name,
                        t.roles[e.from_role],
                        e.subject || t.noSubject
                      )}
                    </button>
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
              {lastDropLine && <p className="text-xs text-brand-ink-soft">{lastDropLine}</p>}
            </div>
          )}
        </>
      )}

      <Modal isOpen={opened !== null} onClose={() => setOpened(null)} title={opened?.subject || t.noSubject} size="lg">
        {message.isLoading && <div className="text-gray-400 text-sm">{t.loading}</div>}
        {message.error && (
          <p role="alert" className="text-xs text-red-500">
            {t.openError}
          </p>
        )}
        {message.data && <EmailMessage message={message.data} />}
      </Modal>

      {(error || loadError) && (
        <p role="alert" className="text-xs text-red-500">
          {error ?? t.loadError}
        </p>
      )}
    </section>
  )
}
