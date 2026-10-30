import { normalizeEmail } from '@/lib/email/normalize'
import { hasAnyAppAccess } from '@/lib/api/app-access'

// =============================================================================
// Sign-in admission for Loop app owners and collaborators. The cache below holds
// a yes/no about one person's own sign-in for 60 s, not an admin list; a revoke
// in Garm takes effect within 60 s, the same as garmCheck. Only "yes" is cached,
// so a newly granted person gets in on the next try.
// =============================================================================

const TTL_MS = 60_000
const yesUntil = new Map<string, number>()

/** True when Garm says this email holds owner/collaborator on any Loop app. Errors deny. */
export async function appAdmitted(email: string): Promise<boolean> {
  const key = normalizeEmail(email)
  const until = yesUntil.get(key)
  if (until && until > Date.now()) return true
  try {
    if (await hasAnyAppAccess(email)) {
      yesUntil.set(key, Date.now() + TTL_MS)
      return true
    }
  } catch {
    // Fail closed: any Garm trouble means not admitted.
  }
  return false
}

/** Test-only: forget cached answers. */
export function _resetAppAdmitCache(): void {
  yesUntil.clear()
}
