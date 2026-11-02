'use client'

import { useEffect, useRef, useState } from 'react'
import { useAppReadKey, useMintAppReadKey, useRevokeAppReadKey } from '@/lib/query/hooks'
import { copy } from '@/lib/copy'

const t = copy.adminApps

const dateFmt = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Los_Angeles' })

const button =
  'px-3 py-1.5 text-sm border border-gray-200 rounded text-brand-charcoal hover:border-brand-navy hover:text-brand-navy disabled:opacity-30 disabled:cursor-not-allowed transition-colors'

// The app's read key, for its server to read its own feedback. The key is
// shown once, right after minting; the panel holds it in its own state (the
// mint mutation is not kept in the query cache) and drops it on revoke or
// when the panel unmounts.
export function ReadKeyPanel({ slug }: { slug: string }) {
  const { data: status, isLoading, error: loadError } = useAppReadKey(slug)
  const mint = useMintAppReadKey(slug)
  const revoke = useRevokeAppReadKey(slug)
  const [revealed, setRevealed] = useState<string | null>(null)
  // Editable copies shown in the reveal form. Copy reads `revealed`, never these.
  const [keyField, setKeyField] = useState('')
  const [usernameField, setUsernameField] = useState('')
  const [copied, setCopied] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const exists = !!status?.exists
  const copiedTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Clear the "Copied" reset timer when the panel goes away.
  useEffect(
    () => () => {
      if (copiedTimer.current) clearTimeout(copiedTimer.current)
    },
    []
  )

  const onMint = async () => {
    if (exists && !window.confirm(t.readKeyConfirmRotate)) return
    setError(null)
    setCopied(false)
    try {
      const res = await mint.mutateAsync()
      setRevealed(res.key)
      setKeyField(res.key)
      setUsernameField(`loop-read-key-${slug}`)
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
      setKeyField('')
      setUsernameField('')
    } catch {
      setError(t.readKeyError)
    }
  }

  const onCopy = async () => {
    if (!revealed) return
    try {
      await navigator.clipboard.writeText(revealed)
      setCopied(true)
      if (copiedTimer.current) clearTimeout(copiedTimer.current)
      copiedTimer.current = setTimeout(() => setCopied(false), 2000)
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

      {isLoading && <div className="text-gray-400 text-sm">{t.readKeyLoading}</div>}
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

      {status && (
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={onMint}
            disabled={mint.isPending || revoke.isPending}
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
      )}

      {revealed && (
        // This is a form only so a password manager (e.g. 1Password) offers to
        // save the key: it looks for a username + new-password pair and a submit.
        // It never submits anywhere: no action, preventDefault, and nothing here
        // sends the key over the network.
        <form onSubmit={(e) => e.preventDefault()} className="space-y-2">
          <div className="flex items-center gap-2">
            <input
              type="text"
              name="username"
              autoComplete="username"
              aria-label={t.readKeyUsernameLabel}
              value={usernameField}
              onChange={(e) => setUsernameField(e.target.value)}
              className="flex-1 px-2 py-1 text-sm font-mono border border-gray-200 rounded"
            />
          </div>
          <div className="flex items-center gap-2">
            <input
              type="password"
              name="password"
              autoComplete="new-password"
              aria-label={t.readKeyHeading}
              value={keyField}
              onChange={(e) => setKeyField(e.target.value)}
              onFocus={(e) => e.currentTarget.select()}
              className="flex-1 px-2 py-1 text-sm font-mono border border-gray-200 rounded"
            />
            <button type="button" onClick={onCopy} className={button}>
              {copied ? t.readKeyCopied : t.readKeyCopy}
            </button>
          </div>
          <div className="flex items-center gap-2">
            <button type="submit" className={button}>
              {t.readKeySave}
            </button>
          </div>
          <p className="text-xs text-gray-500">{t.readKeyRevealNote}</p>
          <p className="text-xs text-gray-500">{t.readKeySaveNote}</p>
        </form>
      )}

      {(error || loadError) && (
        <p role="alert" className="text-xs text-red-500">
          {error ?? t.readKeyLoadError}
        </p>
      )}
    </section>
  )
}
