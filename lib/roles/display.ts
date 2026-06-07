import { copy } from '@/lib/copy'
import type { BriefRole, MemberRole } from '@/lib/types'
import { defaultBriefRole, isBriefRole } from './brief-role'

// Display helpers for brief roles (RAAC vocab). The persisted/semantic side
// lives in brief-role.ts; this module is the user-facing label layer.

/** Human-facing label for a brief role, e.g. 'Originator'. */
export function briefRoleLabel(role: BriefRole): string {
  return copy.glossary[role].term
}

/** One-line description for tooltips, sourced from the glossary. */
export function briefRoleShort(role: BriefRole): string {
  return copy.glossary[role].short
}

/**
 * The brief role to display for a viewer. Prefers their explicitly-stored
 * brief_role (e.g. a Contributor whose access tier is `maker`); falls back to
 * the role implied by the access tier when no stored role is known. Owner/admin
 * operate the builder console in a reviewing capacity, so they fall back to
 * 'reviewer'.
 */
export function viewerBriefRole(
  accessTier?: MemberRole | 'admin' | null,
  storedBriefRole?: BriefRole | null,
): BriefRole {
  if (isBriefRole(storedBriefRole)) return storedBriefRole
  if (accessTier && accessTier !== 'admin') {
    const implied = defaultBriefRole(accessTier)
    if (implied) return implied
  }
  return 'reviewer'
}
