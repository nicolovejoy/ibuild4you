import { NextResponse } from 'next/server'
import { mintResetLinkForExistingAccount } from '@/lib/auth/reset-link'
import { sendMakerEmail } from '@/lib/email/send-maker-email'
import { checkRateLimit, getClientIp } from '@/lib/api/rate-limit'
import { normalizeEmail } from '@/lib/email/normalize'
import { copy } from '@/lib/copy'

// Public, unauthenticated: the "Forgot password?" path.
//
// Why this exists at all, rather than the client calling Firebase's
// sendPasswordResetEmail(): Firebase sends from its own
// <project>.firebaseapp.com sender, which has no relationship to the domain
// our other mail comes from. A maker's reset email went to spam and sat there
// until the link expired. Routing it through Resend puts every email we send
// on one warmed, DKIM/SPF/DMARC-aligned domain, and lets us control the copy.
//
// The alternative was Firebase's "customize domain" feature, which would have
// required merging Firebase's SPF include into our existing record — and
// there can only be one v=spf1 TXT record per domain. Not worth the risk with
// a DMARC p=quarantine flip pending.
//
// SECURITY: three invariants, all pinned by tests.
//   1. The response never reveals whether an account exists — same status,
//      same body, whether we sent mail or not. Errors don't leak either.
//   2. No account is ever created here (mintResetLinkForExistingAccount, not
//      the invite flow's get-or-create helper). Signup stays closed.
//   3. Rate-limited on BOTH axes: per IP (one attacker, many addresses) and
//      per address (many IPs, one victim getting mailbombed).

const ONE_HOUR_MS = 60 * 60 * 1000
// Per-IP is the anti-spray control, and it has to share a budget with everyone
// behind the same NAT — a household or small office is one IP to us. Kept
// loose enough that co-located makers can't lock each other out.
const MAX_PER_IP_PER_HOUR = 10
// Per-address is the anti-mailbomb control and the one that actually protects
// a person, so it stays tight: nobody needs their own reset mailed 4× an hour.
const MAX_PER_EMAIL_PER_HOUR = 3

// Identical success envelope for every non-rate-limited outcome. Kept as one
// constant so a future edit can't accidentally make the branches distinguishable.
const OK = { ok: true } as const

export async function POST(request: Request) {
  const ip = getClientIp(request)

  const ipLimit = checkRateLimit(`password-reset:ip:${ip}`, MAX_PER_IP_PER_HOUR, ONE_HOUR_MS)
  if (!ipLimit.ok) {
    return NextResponse.json(
      { error: 'Too many reset requests. Try again later.' },
      { status: 429, headers: { 'Retry-After': String(ipLimit.retryAfterSeconds) } }
    )
  }

  let email = ''
  try {
    const body = await request.json()
    email = normalizeEmail(typeof body?.email === 'string' ? body.email : '')
  } catch {
    // Malformed JSON — answer like every other no-op so it isn't an oracle.
    return NextResponse.json(OK)
  }

  // Shape check only. An address that doesn't exist is indistinguishable from
  // one that does, so this branch just avoids pointless Auth calls.
  if (!email || !email.includes('@') || !email.includes('.')) {
    return NextResponse.json(OK)
  }

  const emailLimit = checkRateLimit(
    `password-reset:email:${email}`,
    MAX_PER_EMAIL_PER_HOUR,
    ONE_HOUR_MS
  )
  if (!emailLimit.ok) {
    return NextResponse.json(
      { error: 'Too many reset requests. Try again later.' },
      { status: 429, headers: { 'Retry-After': String(emailLimit.retryAfterSeconds) } }
    )
  }

  try {
    const resetLink = await mintResetLinkForExistingAccount(email)
    // No account for this address — send nothing, say the same thing anyway.
    if (resetLink) {
      await sendMakerEmail({
        to: email,
        subject: copy.email.subject.passwordReset,
        text: copy.passwordResetEmail({ resetLink }),
      })
    }
  } catch (err) {
    // A Resend outage must not become an oracle either, so this is logged and
    // swallowed. The user sees the same confirmation and can retry.
    console.error(
      JSON.stringify({
        event: 'password_reset_send_failed',
        error: err instanceof Error ? err.message : String(err),
      })
    )
  }

  return NextResponse.json(OK)
}
