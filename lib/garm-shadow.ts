import { after } from 'next/server'
import { garmCheck } from '@/lib/garm'

// =============================================================================
// Garm shadow mode — the remaining piece of consumer-plan Phase 4 (PR F).
// See docs/garm-consumer-plan.md "Phase 4 — Garm shadow mode".
//
// THE ONE RULE: this module changes NO security decision. It fires garmCheck()
// alongside the app's existing local answer (approved_emails / ADMIN_EMAILS)
// and logs ONLY on disagreement. The local answer is returned unconditionally
// by isApprovedEmail() — Garm's answer here is observed, never acted on. That
// wiring is Phase 5 / PR G, gated on passcode retirement (Phases 1–3).
//
// PII: never log the email. A mismatch line records the fact of a
// disagreement + role (display-only) — not who. Vercel runtime logs are not a
// safe place for raw emails; if a mismatch turns out to be undiagnosable
// without identity, that's a call for Nico, not something to solve by quietly
// logging PII.
//
// Kill switch: GARM_SHADOW must be exactly 'on'. Default (unset, or any other
// value including 'off') is OFF — this fires on every sign-in, so shipping it
// live is a deliberate flip, not a side effect of merging this PR.
// =============================================================================

export const GARM_SHADOW_PROJECT = 'ibuild4you'

function shadowEnabled(): boolean {
  return process.env.GARM_SHADOW === 'on'
}

/**
 * Compare the local sign-in-gate answer against Garm's. Silent on agreement
 * (the expected case — a log line per successful sign-in would bury the
 * signal); logs one line on disagreement. Never throws — garmCheck() already
 * fails closed internally, so this always resolves.
 *
 * Exported (not just called via scheduleGarmShadowCheck) so tests can await it
 * directly instead of racing a fire-and-forget promise.
 */
export async function shadowCheckApprovedEmail(email: string, localAllowed: boolean): Promise<void> {
  const { allowed, role } = await garmCheck(email, GARM_SHADOW_PROJECT, 'viewer')
  if (allowed === localAllowed) return

  console.warn(
    `[garm-shadow] mismatch: local=${localAllowed} garm=${allowed} role=${role ?? 'null'} route=isApprovedEmail`
  )
}

/**
 * Fire `run` without making the caller (isApprovedEmail, on the sign-in hot
 * path) wait for it or its 2s garmCheck timeout. No-ops entirely when the kill
 * switch is off — `run` (and therefore garmCheck / any fetch) is never called.
 *
 * Prefers Next's `after()`: on Vercel this keeps the serverless invocation
 * alive until `run` settles even though the response already went out, so an
 * observation-only check can't be silently dropped mid-flight when the
 * function freezes post-response — exactly the failure mode the Garm repo's
 * own denial-log write hit when it relied on a bare un-awaited promise.
 * `after()` throws when called outside a request scope (e.g. this function
 * invoked directly from a script or a unit test, not through a route
 * handler) — falls back to a plain fire-and-forget in that case, which is
 * fine there since nothing freezes a normal Node process mid-request.
 */
export function scheduleGarmShadowCheck(run: () => Promise<void>): void {
  if (!shadowEnabled()) return
  try {
    after(run)
  } catch {
    void run().catch((err) => {
      console.warn('[garm-shadow] shadow check failed:', err instanceof Error ? err.message : err)
    })
  }
}
