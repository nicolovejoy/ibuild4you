import { copy } from '@/lib/copy'
import type { BriefRole, MemberRole } from '@/lib/types'
import { defaultBriefRole } from './brief-role'

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
 * The brief role to display for a viewer when we only know their access tier
 * (chrome badges don't load the stored brief_role). Owner/admin operate the
 * builder console in a reviewing capacity, so they fall back to 'reviewer'.
 */
export function viewerBriefRole(accessTier?: MemberRole | 'admin' | null): BriefRole {
  if (accessTier && accessTier !== 'admin') {
    const implied = defaultBriefRole(accessTier)
    if (implied) return implied
  }
  return 'reviewer'
}
