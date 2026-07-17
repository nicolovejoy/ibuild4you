import crypto from 'crypto'
import { getAdminAuth } from '@/lib/firebase/admin'
import { normalizeEmail } from '@/lib/email/normalize'

// Garm consumer plan Phase 1 / PR A (docs/garm-consumer-plan.md): invites move
// from "here's your passcode" to "here's a link to set your password" — and
// since PR D the link (or Google) is the ONLY way in. Does NOT touch closed
// signup: it only ever runs for an email the caller has already approved as an
// invitee (share/route.ts, the maker-email invite path), never for arbitrary
// input.
//
// Firebase's generatePasswordResetLink() requires the target Auth account to
// already exist. Some invitees only have an account because the retired
// passcode route get-or-created one by email (no password ever set) — so before
// minting the link we ensure the account exists AND has the password
// provider attached. That's the plan's own "guaranteed to work" construction;
// we did not gamble on the unverified optimization of skipping this for
// already-provider-less accounts (see PR write-up — blocked from confirming
// that empirically this session).
//
// Never throws: any Auth failure is logged and swallowed, returning null so
// the invite still sends — the email copy's own "Forgot password?" fallback
// line covers a null link the same way it covers an expired one.
export async function ensureInviteResetLink(rawEmail: string): Promise<string | null> {
  const email = normalizeEmail(rawEmail)
  if (!email) return null

  const adminAuth = getAdminAuth()

  try {
    let user: { uid: string; providerData: Array<{ providerId: string }> } | null = null
    try {
      user = await adminAuth.getUserByEmail(email)
    } catch (err) {
      if ((err as { code?: string })?.code !== 'auth/user-not-found') throw err
      user = null
    }

    if (!user) {
      await adminAuth.createUser({ email, password: randomPassword() })
    } else {
      const hasPasswordProvider = user.providerData.some((p) => p.providerId === 'password')
      if (!hasPasswordProvider) {
        await adminAuth.updateUser(user.uid, { password: randomPassword() })
      }
    }

    return await adminAuth.generatePasswordResetLink(email)
  } catch (err) {
    console.error(
      JSON.stringify({
        event: 'ensure_invite_reset_link_failed',
        email,
        error: err instanceof Error ? err.message : String(err),
      })
    )
    return null
  }
}

// 32 random URL-safe characters — never persisted or logged; the account only
// needs *a* password on file so the reset-link flow is available.
function randomPassword(): string {
  return crypto.randomBytes(24).toString('base64url')
}
