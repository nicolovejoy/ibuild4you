// Pure planner for scripts/audit-auth-providers.mjs (Garm PR B). No I/O —
// the script does the Firestore + Firebase Auth reads; this module just
// derives the distinct active member email list and formats provider flags.

export const normalizeEmail = (email) => (email ?? '').trim().toLowerCase()

/**
 * Distinct, sorted, normalized emails of every active (non-removed) member
 * across all briefs. members: [{ email, removed_at }].
 */
export function activeMemberEmails(members) {
  const emails = new Set()
  for (const m of members) {
    if (m.removed_at) continue
    const email = normalizeEmail(m.email)
    if (email) emails.add(email)
  }
  return [...emails].sort()
}

/**
 * Given a Firebase Auth user's providerData (array of {providerId}) — or
 * null if no Auth user exists for the email at all — return the flags the
 * audit table displays.
 */
export function providerFlags(providerData) {
  if (providerData === null) {
    return { password: false, google: false, none: true, status: 'no auth account' }
  }
  const ids = providerData.map((p) => p.providerId)
  const password = ids.includes('password')
  const google = ids.includes('google.com')
  const none = !password && !google
  let status
  if (password && google) status = 'password + google'
  else if (password) status = 'password'
  else if (google) status = 'google'
  else status = 'passcode-only'
  return { password, google, none, status }
}
