import crypto from 'crypto'
import { getAdminAuth } from '@/lib/firebase/admin'
import { normalizeEmail } from '@/lib/email/normalize'
import { rewriteActionLink } from '@/lib/auth/rewrite-action-link'

// Mints a Firebase password-reset link for an account that ALREADY EXISTS.
//
// Sibling of ensureInviteResetLink (lib/auth/ensure-invite-account.ts), with
// one deliberate difference: this one never calls createUser. The invite helper
// is only ever reached for an email a builder has already approved, so
// get-or-create is correct there. This one is reached from the PUBLIC
// unauthenticated reset endpoint, where creating an account for whatever
// address was typed into the form would be an open-signup hole in an
// invite-only app.
//
// Never throws. An unknown address, an Auth outage, and a malformed input all
// return null, and the caller answers the request identically either way — the
// response must not reveal whether an account exists.
export async function mintResetLinkForExistingAccount(rawEmail: string): Promise<string | null> {
  const email = normalizeEmail(rawEmail)
  if (!email) return null

  const adminAuth = getAdminAuth()

  try {
    const user = await adminAuth.getUserByEmail(email)

    // generatePasswordResetLink needs the password provider to be attached.
    // Passcode-era accounts have no providers at all, and a Google-only account
    // has just google.com — in both cases attach a throwaway password so the
    // link is guaranteed to work. updateUser only ADDS the credential; any
    // existing Google sign-in stays intact.
    const hasPasswordProvider = user.providerData.some(
      (p: { providerId: string }) => p.providerId === 'password'
    )
    if (!hasPasswordProvider) {
      await adminAuth.updateUser(user.uid, { password: randomPassword() })
    }

    // continueUrl: Firebase's hosted "Password changed" page links back to
    // sign-in instead of dead-ending. Always prod (same rule as
    // getServerShareLink) — outbound mail must never point at a preview host.
    const base = process.env.NEXT_PUBLIC_APP_URL || 'https://ibuild4you.com'
    const link = await adminAuth.generatePasswordResetLink(email, {
      url: `${base}/auth/login`,
    })
    // Re-point at our own handler so the password is typed on ibuild4you.com
    // and password managers file it against the right domain.
    return rewriteActionLink(link, base)
  } catch (err) {
    const code = (err as { code?: string })?.code
    // An unknown address is the expected case on a public endpoint, not an
    // error worth logging — logging it would build a list of probed addresses.
    if (code !== 'auth/user-not-found') {
      console.error(
        JSON.stringify({
          event: 'mint_reset_link_failed',
          code: code || null,
          error: err instanceof Error ? err.message : String(err),
        })
      )
    }
    return null
  }
}

// 32 random URL-safe characters — never persisted or logged. The account only
// needs *a* password on file so the reset-link flow is available.
function randomPassword(): string {
  return crypto.randomBytes(24).toString('base64url')
}
