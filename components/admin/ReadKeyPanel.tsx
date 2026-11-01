'use client'

import { useState } from 'react'
import { useAppReadKey, useMintAppReadKey, useRevokeAppReadKey } from '@/lib/query/hooks'
import { copy } from '@/lib/copy'

const t = copy.adminApps

const dateFmt = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Los_Angeles' })

const button =
  'px-3 py-1.5 text-sm border border-gray-200 rounded text-brand-charcoal hover:border-brand-navy hover:text-brand-navy disabled:opacity-30 disabled:cursor-not-allowed transition-colors'

// The app's read key, for its server to read its own feedback. The key is
// shown once, right after minting; it lives only in this component's state
// and is dropped on revoke or when the panel unmounts.
export function ReadKeyPanel({ slug }: { slug: string }) {
  const { data: status, isLoading } = useAppReadKey(slug)
  const mint = useMintAppReadKey(slug)
  const revoke = useRevokeAppReadKey(slug)
  const [revealed, setRevealed] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const exists = !!status?.exists

  const onMint = async () => {
    if (exists && !window.confirm(t.readKeyConfirmRotate)) return
    setError(null)
    setCopied(false)
    try {
      const res = await mint.mutateAsync()
      setRevealed(res.key)
    } catch {
      setError(t.readKeyError)
    }
  }

  const onRevoke = async () => {
    if (!window.confirm(t.readKeyConfirmRevoke)) return
    setError(null)
    try {
      await revoke.mutateAsync()
      setRevealed(null)
    } catch {
      setError(t.readKeyError)
    }
  }

  const onCopy = async () => {
    if (!revealed) return
    try {
      await navigator.clipboard.writeText(revealed)
      setCopied(true)
    } catch {
      setCopied(false)
    }
  }

  return (
    <section className="bg-white rounded-lg border border-gray-200 p-4 space-y-3">
      <div>
        <h2 className="text-sm font-medium text-brand-charcoal">{t.readKeyHeading}</h2>
        <p className="text-xs text-gray-500">{t.readKeyNote}</p>
      </div>

      {isLoading && <div className="text-gray-400 text-sm">{copy.loading}</div>}
      {status && (
        <p className="text-sm text-brand-charcoal">
          {exists && status.created_at
            ? `${t.readKeyMinted} ${dateFmt.format(new Date(status.created_at))} · ${
                status.last_used_at
                  ? `${t.readKeyLastUsed} ${dateFmt.format(new Date(status.last_used_at))}`
                  : t.readKeyNeverUsed
              }`
            : t.readKeyNone}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={onMint}
          disabled={mint.isPending || revoke.isPending || isLoading}
          className={button}
        >
          {exists ? t.readKeyRotate : t.readKeyMint}
        </button>
        {exists && (
          <button
            type="button"
            onClick={onRevoke}
            disabled={mint.isPending || revoke.isPending}
            className="text-xs text-red-500 hover:underline disabled:opacity-30"
          >
            {t.readKeyRevoke}
          </button>
        )}
      </div>

      {revealed && (
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <input
              readOnly
              aria-label={t.readKeyHeading}
              value={revealed}
              onFocus={(e) => e.currentTarget.select()}
              className="flex-1 px-2 py-1 text-sm font-mono border border-gray-200 rounded"
            />
            <button type="button" onClick={onCopy} className={button}>
              {copied ? t.readKeyCopied : t.readKeyCopy}
            </button>
          </div>
          <p className="text-xs text-gray-500">{t.readKeyRevealNote}</p>
        </div>
      )}

      {error && (
        <p role="alert" className="text-xs text-red-500">
          {error}
        </p>
      )}
    </section>
  )
}
