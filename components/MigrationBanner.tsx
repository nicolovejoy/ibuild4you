'use client'

import { useEffect, useState } from 'react'
import { GoogleAuthProvider, linkWithPopup } from 'firebase/auth'
import type { User } from 'firebase/auth'
import { X } from 'lucide-react'
import { auth } from '@/lib/firebase/client'
import { SetPasswordModal } from '@/components/SetPasswordModal'
import { StatusMessage } from '@/components/ui/StatusMessage'
import { authErrorMessage } from '@/lib/auth/password'
import {
  MIGRATION_BANNER_DISMISS_KEY,
  shouldShowMigrationBanner,
} from '@/lib/auth/migration-banner'
import { copy } from '@/lib/copy'

/**
 * Passcode → password/Google onramp (Garm PR B). Shown to any signed-in user
 * without a migrated credential (empty providerData — the passcode-only
 * shape). Self-contained: subscribes to auth state itself (like UserMenu), so
 * it can be dropped into any page without extra plumbing. Dismissal is
 * sessionStorage-scoped so it reappears next visit instead of nagging every
 * page load of the same session.
 */
export function MigrationBanner() {
  const [user, setUser] = useState<User | null>(null)
  const [dismissed, setDismissed] = useState(true) // start hidden until we've checked sessionStorage
  const [showSetPassword, setShowSetPassword] = useState(false)
  const [googleError, setGoogleError] = useState<string | null>(null)
  const [googleLoading, setGoogleLoading] = useState(false)

  useEffect(() => {
    const unsubscribe = auth.onAuthStateChanged((firebaseUser) => setUser(firebaseUser))
    return unsubscribe
  }, [])

  useEffect(() => {
    try {
      setDismissed(sessionStorage.getItem(MIGRATION_BANNER_DISMISS_KEY) === '1')
    } catch {
      // sessionStorage unavailable (e.g. some privacy modes) — default to showing once.
      setDismissed(false)
    }
  }, [])

  const providerIds = user?.providerData.map((p) => p.providerId) ?? []
  const visible = !!user && shouldShowMigrationBanner(providerIds, dismissed)

  const dismiss = () => {
    setDismissed(true)
    try {
      sessionStorage.setItem(MIGRATION_BANNER_DISMISS_KEY, '1')
    } catch {
      // ignore — worst case the banner reappears
    }
  }

  const handleConnectGoogle = async () => {
    if (!user) return
    setGoogleError(null)
    setGoogleLoading(true)
    try {
      await linkWithPopup(user, new GoogleAuthProvider())
      dismiss()
    } catch (err) {
      setGoogleError(authErrorMessage(err))
    } finally {
      setGoogleLoading(false)
    }
  }

  if (!visible || !user) return null

  return (
    <div className="bg-amber-50 border-b border-amber-200 px-4 py-3">
      <div className="max-w-4xl mx-auto flex flex-wrap items-center gap-3">
        <p className="text-sm text-amber-900 flex-1 min-w-[200px]">
          {copy.auth.migrationBanner.message}
        </p>
        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={() => setShowSetPassword(true)}
            className="text-sm px-3 py-1.5 rounded-md bg-brand-navy text-white hover:opacity-90"
          >
            {copy.auth.migrationBanner.setPassword}
          </button>
          <button
            onClick={handleConnectGoogle}
            disabled={googleLoading}
            className="text-sm px-3 py-1.5 rounded-md border border-amber-300 text-amber-900 hover:bg-amber-100 disabled:opacity-50"
          >
            {copy.auth.migrationBanner.connectGoogle}
          </button>
          <button
            onClick={dismiss}
            aria-label={copy.auth.migrationBanner.dismiss}
            className="p-1.5 rounded-md text-amber-700 hover:bg-amber-100"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>
      {googleError && (
        <div className="max-w-4xl mx-auto mt-2">
          <StatusMessage type="error" message={googleError} />
        </div>
      )}
      <SetPasswordModal
        isOpen={showSetPassword}
        onClose={() => {
          setShowSetPassword(false)
          dismiss()
        }}
        user={user}
      />
    </div>
  )
}
