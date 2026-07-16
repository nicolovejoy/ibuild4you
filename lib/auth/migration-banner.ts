// Pure logic for the passcode → password/Google migration banner (Garm PR B).
// No Firebase imports — the caller reads `user.providerData` and sessionStorage
// and hands us plain values so this stays trivially unit-testable.

/**
 * A signed-in Firebase user has a "real" credential once they've linked
 * password or Google. A passcode-only account is created via
 * `adminAuth.createUser({ email })` with no provider, then signed in with a
 * custom token — so `providerData` stays empty until they migrate.
 */
export function hasMigratedCredential(providerIds: string[]): boolean {
  return providerIds.some((id) => id === 'password' || id === 'google.com')
}

/**
 * Should we show the "passcodes are going away" banner right now?
 * Shown to any signed-in user without a migrated credential, unless they
 * dismissed it already this session (sessionStorage — reappears next visit,
 * doesn't nag every page load of the same session).
 */
export function shouldShowMigrationBanner(
  providerIds: string[],
  dismissedThisSession: boolean
): boolean {
  if (dismissedThisSession) return false
  return !hasMigratedCredential(providerIds)
}

export const MIGRATION_BANNER_DISMISS_KEY = 'ib4y_migration_banner_dismissed'
