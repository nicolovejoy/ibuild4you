'use client'

import { useState } from 'react'
import {
  useBuildStatusKey,
  useMintBuildStatusKey,
  useRevokeBuildStatusKey,
} from '@/lib/query/hooks'
import { fullRepo, normalizeGithubRepo } from '@/lib/github/repo'
import { copy } from '@/lib/copy'
import { CopyField } from '@/components/ui/CopyField'

const t = copy.buildStatusKey

const dateFmt = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Los_Angeles' })

const button =
  'px-3 py-1.5 text-sm border border-brand-line rounded text-brand-charcoal hover:border-brand-navy hover:text-brand-navy disabled:opacity-30 disabled:cursor-not-allowed transition-colors'

// The build status key for a brief's repo: lets Claude Code in the build repo
// post status reports and nothing else. System admin only. The key is shown
// once, right after minting; the panel holds it in its own state (the mint
// mutation is not kept in the query cache) and drops it on revoke.
export function BuildStatusKeyPanel({
  projectId,
  githubRepo,
  isSystemAdmin,
}: {
  projectId: string
  githubRepo: string | undefined
  isSystemAdmin: boolean
}) {
  // A key is bound to a full "owner/name"; a bare name gets a hint instead.
  const repo = normalizeGithubRepo(githubRepo)
  const hasFullRepo = fullRepo(githubRepo) !== null
  const visible = isSystemAdmin && repo !== ''

  // Only ask the server when it will not answer needs_full_repo.
  const { data: status, isLoading, error: loadError } = useBuildStatusKey(
    visible && hasFullRepo ? projectId : undefined
  )
  const mint = useMintBuildStatusKey()
  const revoke = useRevokeBuildStatusKey()
  // The shown-once key, tied to the repo it was minted for.
  const [revealed, setRevealed] = useState<{ repo: string; key: string } | null>(null)
  const [error, setError] = useState<string | null>(null)

  if (!visible) return null

  const exists = !!status?.exists
  const busy = mint.isPending || revoke.isPending
  const shownKey = revealed && revealed.repo === repo ? revealed.key : null

  const onMint = async () => {
    if (exists && !window.confirm(t.confirmMintNew)) return
    setError(null)
    try {
      const res = await mint.mutateAsync(projectId)
      setRevealed({ repo, key: res.key })
    } catch {
      setError(t.error)
    }
  }

  const onRevoke = async () => {
    if (!window.confirm(t.confirmRevoke)) return
    setError(null)
    try {
      await revoke.mutateAsync(projectId)
      setRevealed(null)
    } catch {
      setError(t.error)
    }
  }

  return (
    <section className="bg-white rounded-lg border border-brand-line p-4 space-y-3">
      <h2 className="text-sm font-medium text-brand-charcoal">{t.heading(repo)}</h2>

      {!hasFullRepo && <p className="text-sm text-brand-ink-soft">{t.needsFullRepo}</p>}

      {hasFullRepo && isLoading && <div className="text-gray-400 text-sm">{t.loading}</div>}
      {hasFullRepo && status && (
        <>
          <p className="text-sm text-brand-charcoal">
            {exists && status.created_at
              ? [
                  t.minted(dateFmt.format(new Date(status.created_at))),
                  ...(status.last_used_at
                    ? [t.lastUsed(dateFmt.format(new Date(status.last_used_at)))]
                    : []),
                ].join(' · ')
              : t.none}
          </p>
          <div className="flex flex-wrap items-center gap-3">
            <button type="button" onClick={onMint} disabled={busy} className={button}>
              {exists ? t.mintNew : t.mint}
            </button>
            {exists && (
              <button
                type="button"
                onClick={onRevoke}
                disabled={busy}
                className="text-xs text-red-500 hover:underline disabled:opacity-30"
              >
                {t.revoke}
              </button>
            )}
          </div>
        </>
      )}

      {hasFullRepo && shownKey && (
        // Deliberately NOT a login-looking form: no <form>, no username field,
        // not type="password". See CopyField.
        <div className="space-y-3">
          <div className="space-y-1">
            <CopyField
              id={`build-status-key-${projectId}`}
              label={t.keyLabel}
              value={shownKey}
              copyLabel={t.copy}
              copiedLabel={t.copied}
            />
            <p className="text-xs text-brand-ink-soft">{t.shownOnce}</p>
          </div>
          <div className="space-y-1">
            <CopyField
              id={`build-status-op-${projectId}`}
              label={t.opLabel}
              value={t.opCommand(repo)}
              copyLabel={t.copy}
              copiedLabel={t.copied}
            />
            <p className="text-xs text-brand-ink-soft">{t.opNote}</p>
          </div>
        </div>
      )}

      {(error || (hasFullRepo && loadError)) && (
        <p role="alert" className="text-xs text-red-500">
          {error ?? t.loadError}
        </p>
      )}
    </section>
  )
}
