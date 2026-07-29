import { after } from 'next/server'
import { normalizeEmail } from '@/lib/email/normalize'
import { ADMIN_EMAILS } from '@/lib/constants'
import { getAdminDb } from '@/lib/api/firebase-server-helpers'

// =============================================================================
// Garm dual-write — the deferred piece of consumer-plan Phase 4.
// See docs/garm-consumer-plan.md "Phase 4 — Garm shadow mode" (dual-write bullet).
//
// THE ONE RULE: local Firestore stays the source of truth in this phase. This
// module only mirrors the outcome of a local membership/approval write into a
// Garm grant, fire-and-forget. It never gates access and a failure here never
// blocks or unwinds the local write that triggered it.
//
// Role-collapse logic mirrors scripts/lib/garm-seed-plan.mjs exactly (same
// rule, confirmed with Nico): a person can hold different MemberRoles across
// briefs; Garm's project grain is app-level, so the highest active brief role
// wins, mapped down to Garm's 3 tiers. System admins always resolve to owner.
//
// PII: never log the email — only booleans/role, matching lib/garm-shadow.ts.
//
// Kill switch: GARM_DUAL_WRITE must be exactly 'on'. Default (unset, or any
// other value) is OFF, and syncGarmGrantForEmail is then a silent no-op (one
// debug log) — never an error, never a thrown exception.
// =============================================================================

export const GARM_DUAL_WRITE_PROJECT = 'ibuild4you'
const TIMEOUT_MS = 2_000

export type GarmGrantRole = 'owner' | 'collaborator' | 'viewer'

// Highest → lowest. Index doubles as rank (lower index = higher rank). Mirrors
// scripts/lib/garm-seed-plan.mjs MEMBER_ROLE_RANK.
const MEMBER_ROLE_RANK = ['owner', 'builder', 'apprentice', 'maker'] as const

const MEMBER_TO_GARM_ROLE: Record<string, GarmGrantRole> = {
  owner: 'owner',
  builder: 'collaborator',
  apprentice: 'viewer',
  maker: 'viewer',
}

function highestMemberRole(roles: string[]): string {
  return roles.reduce((best, r) =>
    MEMBER_ROLE_RANK.indexOf(r as (typeof MEMBER_ROLE_RANK)[number]) <
    MEMBER_ROLE_RANK.indexOf(best as (typeof MEMBER_ROLE_RANK)[number])
      ? r
      : best
  )
}

export interface MemberRowForSync {
  role: string
  removed_at?: string | null
}

export type GrantDecision = { action: 'upsert'; role: GarmGrantRole } | { action: 'revoke' }

/**
 * Pure role-collapse + upsert/revoke decision — no I/O. `members` should
 * already be filtered to this one (normalized) email; only active rows
 * (no removed_at) count toward the role. Mirrors buildGrantPlan in
 * scripts/lib/garm-seed-plan.mjs, but per-email rather than whole-roster.
 */
export function computeGrantDecision({
  isAdmin,
  members,
  isApproved,
}: {
  isAdmin: boolean
  members: MemberRowForSync[]
  isApproved: boolean
}): GrantDecision {
  if (isAdmin) return { action: 'upsert', role: 'owner' }

  const active = members.filter((m) => !m.removed_at)
  if (active.length > 0) {
    const role = MEMBER_TO_GARM_ROLE[highestMemberRole(active.map((m) => m.role))] ?? 'viewer'
    return { action: 'upsert', role }
  }

  // No active membership anywhere. Still approved (e.g. an admin-approved
  // email with no brief yet) → viewer. Otherwise nothing left to grant.
  if (isApproved) return { action: 'upsert', role: 'viewer' }

  return { action: 'revoke' }
}

function dualWriteEnabled(): boolean {
  return process.env.GARM_DUAL_WRITE === 'on'
}

async function postGrant(email: string, role: GarmGrantRole): Promise<void> {
  const url = process.env.GARM_URL
  const key = process.env.GARM_ADMIN_KEY
  if (!url || !key) {
    console.warn('[garm-dual-write] GARM_URL/GARM_ADMIN_KEY not set — skipping sync')
    return
  }
  const res = await fetch(`${url}/api/grants`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
    body: JSON.stringify({
      email,
      project: GARM_DUAL_WRITE_PROJECT,
      role,
      actor: 'ibuild4you-dual-write',
    }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  })
  if (!res.ok) throw new Error(`POST /api/grants ${res.status}`)
}

async function revokeGrant(email: string): Promise<void> {
  const url = process.env.GARM_URL
  const key = process.env.GARM_ADMIN_KEY
  if (!url || !key) {
    console.warn('[garm-dual-write] GARM_URL/GARM_ADMIN_KEY not set — skipping sync')
    return
  }
  const res = await fetch(`${url}/api/grants`, {
    method: 'DELETE',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
    body: JSON.stringify({
      email,
      project: GARM_DUAL_WRITE_PROJECT,
      actor: 'ibuild4you-dual-write',
    }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  })
  if (!res.ok) throw new Error(`DELETE /api/grants ${res.status}`)
}

/**
 * Recompute `email`'s app-level Garm role from current Firestore state and
 * upsert (or revoke) its grant to match. Call this after any write that could
 * change a person's membership/approval standing — see call sites in
 * app/api/projects/route.ts, share/route.ts, and the member lifecycle route.
 *
 * Never throws: a Firestore read failure or a Garm request failure both log
 * one line (booleans/role only, never the email) and return. Local Firestore
 * remains the source of truth regardless of what happens here.
 */
export async function syncGarmGrantForEmail(rawEmail: string): Promise<void> {
  if (!dualWriteEnabled()) return

  const email = normalizeEmail(rawEmail)
  if (!email) return

  try {
    const isAdmin = ADMIN_EMAILS.includes(email)
    const db = getAdminDb()

    const [memberSnap, approvedDoc] = await Promise.all([
      db.collection('project_members').where('email', '==', email).get(),
      db.collection('approved_emails').doc(email).get(),
    ])

    const members: MemberRowForSync[] = memberSnap.docs.map((d) => ({
      role: d.data().role as string,
      removed_at: (d.data().removed_at as string | null | undefined) ?? null,
    }))

    // A revoked approved_emails row still exists (non-destructive flag, #163)
    // but must not count as approved for grant purposes.
    const isApproved = approvedDoc.exists && !approvedDoc.data()?.revoked_at
    const decision = computeGrantDecision({ isAdmin, members, isApproved })

    if (decision.action === 'upsert') {
      await postGrant(email, decision.role)
    } else {
      await revokeGrant(email)
    }
  } catch (err) {
    console.warn(
      `[garm-dual-write] sync failed: ${err instanceof Error ? err.message : String(err)}`
    )
  }
}

/**
 * Fire-and-forget wrapper for use from request handlers: schedules the sync
 * via Next's `after()` so it isn't dropped if the function freezes right
 * after the response goes out (same reasoning as lib/garm-shadow.ts's
 * scheduleGarmShadowCheck). No-ops entirely when the kill switch is off.
 */
export function scheduleGarmGrantSync(email: string): void {
  if (!dualWriteEnabled()) return
  try {
    after(() => syncGarmGrantForEmail(email))
  } catch {
    void syncGarmGrantForEmail(email)
  }
}
