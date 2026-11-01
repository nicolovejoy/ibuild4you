import type { MemberRole } from '@/lib/types'

// The four access tiers, as a runtime-checkable list (highest → lowest).
export const MEMBER_ROLES: MemberRole[] = ['owner', 'builder', 'apprentice', 'maker']

// Builder-side = the people who run the brief rather than bring the idea
// (system admins resolve to owner). Their chat messages are guidance for Sam
// and the note writer, never the maker's own words (#245).
export function isBuilderSideRole(role: unknown): boolean {
  return role === 'owner' || role === 'builder'
}

export function isMemberRole(value: unknown): value is MemberRole {
  return typeof value === 'string' && (MEMBER_ROLES as string[]).includes(value)
}

// User-facing label for an access tier (the permission level, distinct from the
// brief_role labels in lib/roles/display.ts).
const MEMBER_ROLE_LABELS: Record<MemberRole, string> = {
  owner: 'Owner',
  builder: 'Builder',
  apprentice: 'Apprentice',
  maker: 'Maker',
}

export function memberRoleLabel(role: MemberRole): string {
  return MEMBER_ROLE_LABELS[role]
}
