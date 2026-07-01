// Pure planners for the multi-human membership lifecycle (#106).
//
// No Firestore here: each planner takes the current member rows (as the route
// has already loaded them) plus a `now` timestamp, and returns the write to
// apply — { patch } — or an { error } the route surfaces as a 400.
//
// Guarantees:
//   - NON-DESTRUCTIVE: removal sets removed_at/removed_by; the row is never
//     deleted, and restore clears removed_at (see planRemoveMember / planRestore
//     added in P2).
//   - OWNERSHIP INTEGRITY: the last ACTIVE owner can't be demoted (or, in P2,
//     removed). A removed owner doesn't count toward the guard.

import type { MemberRole } from '@/lib/types'
import { isMemberRole } from '@/lib/roles/member-role'

export interface MemberRow {
  id: string
  email: string
  role: MemberRole
  removed_at?: string | null
}

export type LifecyclePlan = { patch: Record<string, unknown> } | { error: string }

/** A member is active until they've been moved out (removed_at set). */
export function isActiveMember(m: { removed_at?: string | null }): boolean {
  return !m.removed_at
}

const activeOwners = (members: MemberRow[]) =>
  members.filter((m) => isActiveMember(m) && m.role === 'owner')

/**
 * Change a member's access tier. Refuses an unknown target, an invalid role, a
 * removed member (restore first), and demoting the last active owner.
 */
export function planAccessTierChange({
  members,
  memberId,
  newRole,
  now,
}: {
  members: MemberRow[]
  memberId: string
  newRole: unknown
  now: string
}): LifecyclePlan {
  const target = members.find((m) => m.id === memberId)
  if (!target) return { error: `Member ${memberId} not found on this brief.` }
  if (!isMemberRole(newRole)) return { error: 'role must be one of: owner, builder, apprentice, maker.' }
  if (!isActiveMember(target)) return { error: 'This member has been removed. Restore them before changing their access tier.' }

  const demotingOwner = target.role === 'owner' && newRole !== 'owner'
  if (demotingOwner && activeOwners(members).length <= 1) {
    return { error: "Can't change the last owner's access tier — promote another owner first." }
  }

  return { patch: { role: newRole, updated_at: now } }
}
