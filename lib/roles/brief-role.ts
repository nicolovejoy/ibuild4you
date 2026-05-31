import type { BriefRole, MemberRole } from '@/lib/types'

// The three brief roles, as a runtime-checkable list.
export const BRIEF_ROLES: BriefRole[] = ['originator', 'contributor', 'reviewer']

export function isBriefRole(value: unknown): value is BriefRole {
  return typeof value === 'string' && (BRIEF_ROLES as string[]).includes(value)
}

/**
 * Default brief role implied by an access tier, for backfill and for new
 * memberships when the caller doesn't specify one. Owner maps to null —
 * ownership is an access concern, not a brief-participation role.
 */
export function defaultBriefRole(role: MemberRole): BriefRole | null {
  switch (role) {
    case 'maker':
      return 'originator'
    case 'builder':
      return 'reviewer'
    case 'apprentice':
      return 'contributor'
    case 'owner':
      return null
  }
}

/**
 * Resolve the brief role to persist on a write: an explicitly-supplied valid
 * value wins; otherwise fall back to the default implied by the access tier.
 */
export function resolveBriefRole(
  supplied: unknown,
  memberRole: MemberRole
): BriefRole | null {
  if (isBriefRole(supplied)) return supplied
  return defaultBriefRole(memberRole)
}
