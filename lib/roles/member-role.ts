import type { MemberRole } from '@/lib/types'

// The four access tiers, as a runtime-checkable list (highest → lowest).
export const MEMBER_ROLES: MemberRole[] = ['owner', 'builder', 'apprentice', 'maker']

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
