import { createHash } from 'crypto'
import { after } from 'next/server'
import { getAdminDb } from '@/lib/firebase/admin'
import { normalizeEmail } from '@/lib/email/normalize'

// =============================================================================
// Garm denial recorder (follow-on to PR #175; see
// docs/superpowers/plans/2026-08-22-garm-denial-detector-and-await-invite-grant.md).
//
// A denial names the principal that was PRESENTED, not the person. The 2026-08-22
// lockout was a maker signing in with an address our store had never seen — the
// reconcile diff was clean because nothing was missing. Two classes, two alerts:
//
//   unknown-principal  no membership, no approved row → aliasing (#169) or a
//                      stranger. Not a mirror bug. Warn.
//   known-member       we know them, Garm said no → grant missing/wrong; the
//                      reconcile cron heals within the hour. Error.
//
// PII: docs are keyed by sha256(normalized email) and store NO address. Log lines
// carry the kind + booleans only.
// =============================================================================

export type GarmDenialKind = 'unknown-principal' | 'known-member'

export function classifyGarmDenial(input: { hasMembership: boolean; hasApproved: boolean }): GarmDenialKind {
  return input.hasMembership || input.hasApproved ? 'known-member' : 'unknown-principal'
}

export function hashPrincipal(normalizedEmail: string): string {
  return createHash('sha256').update(normalizedEmail).digest('hex')
}

/** Best-effort. Never throws; never changes the sign-in answer. */
export async function recordGarmDenial(rawEmail: string): Promise<void> {
  const email = normalizeEmail(rawEmail)
  if (!email) return
  try {
    const db = getAdminDb()
    const [memberSnap, approvedDoc] = await Promise.all([
      db.collection('project_members').where('email', '==', email).get(),
      db.collection('approved_emails').doc(email).get(),
    ])
    const hasMembership = memberSnap.docs.some((d) => !d.data().removed_at)
    const hasApproved = approvedDoc.exists && !approvedDoc.data()?.revoked_at
    const kind = classifyGarmDenial({ hasMembership, hasApproved })

    const ref = db.collection('garm_denials').doc(hashPrincipal(email))
    const prior = await ref.get()
    const priorData = prior.exists ? (prior.data() as { count?: number; first_seen?: string } | undefined) : undefined
    const now = new Date().toISOString()
    const count = (priorData?.count ?? 0) + 1
    await ref.set({
      kind,
      has_membership: hasMembership,
      has_approved: hasApproved,
      count,
      first_seen: priorData?.first_seen ?? now,
      last_seen: now,
    })

    const line = `[garm-denial] ${kind} has_membership=${hasMembership} has_approved=${hasApproved} count=${count}`
    if (kind === 'known-member') console.error(line)
    else console.warn(line)
  } catch (err) {
    console.warn(`[garm-denial] record failed: ${err instanceof Error ? err.message : String(err)}`)
  }
}

/** Denials seen since `sinceIso`, by kind. Zeros on any error — a reporting helper must never take down its caller. */
export async function countRecentGarmDenials(
  db: FirebaseFirestore.Firestore,
  sinceIso: string
): Promise<{ unknownPrincipal: number; knownMember: number }> {
  try {
    const snap = await db.collection('garm_denials').where('last_seen', '>=', sinceIso).get()
    let unknownPrincipal = 0
    let knownMember = 0
    for (const d of snap.docs) {
      if (d.data().kind === 'known-member') knownMember++
      else unknownPrincipal++
    }
    return { unknownPrincipal, knownMember }
  } catch {
    return { unknownPrincipal: 0, knownMember: 0 }
  }
}

/** Off the sign-in hot path, same after()-with-fallback shape as lib/garm-shadow.ts. */
export function scheduleGarmDenialRecord(email: string): void {
  try {
    after(() => recordGarmDenial(email))
  } catch {
    void recordGarmDenial(email)
  }
}
