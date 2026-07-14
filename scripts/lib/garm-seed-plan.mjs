// Pure planner for Garm 2/4 (garm-seed-grants.mjs). No I/O — the script does
// the Firestore reads and the Garm POSTs; this module just computes the
// {email, role} table to seed.
//
// The one judgment call (confirmed with Nico, docs/garm-2-seed-plan.md): a
// person can hold different MemberRoles on different briefs, but Garm's
// `ibuild4you` project is app-level and needs exactly one role per email.
// Rule: highest active brief role wins, mapped down to Garm's 3 tiers; system
// admins always resolve to owner regardless of brief role.

export const normalizeEmail = (email) => (email ?? '').trim().toLowerCase()

// Highest → lowest. Index doubles as rank (lower index = higher rank).
const MEMBER_ROLE_RANK = ['owner', 'builder', 'apprentice', 'maker']

const MEMBER_TO_GARM_ROLE = {
  owner: 'owner',
  builder: 'collaborator',
  apprentice: 'viewer',
  maker: 'viewer',
}

function highestMemberRole(roles) {
  return roles.reduce((best, r) =>
    MEMBER_ROLE_RANK.indexOf(r) < MEMBER_ROLE_RANK.indexOf(best) ? r : best
  )
}

// members: [{ email, role, removed_at }]. approvedEmails/adminEmails/systemAdminEmails: string[].
// Returns [{ email, role }] sorted by email, one entry per normalized email.
export function buildGrantPlan({ approvedEmails, members, adminEmails, systemAdminEmails }) {
  const admins = new Set([...adminEmails, ...systemAdminEmails].map(normalizeEmail))

  const activeRolesByEmail = new Map()
  for (const m of members) {
    if (m.removed_at) continue
    const email = normalizeEmail(m.email)
    const roles = activeRolesByEmail.get(email) ?? []
    roles.push(m.role)
    activeRolesByEmail.set(email, roles)
  }

  const subjects = new Set([
    ...approvedEmails.map(normalizeEmail),
    ...activeRolesByEmail.keys(),
    ...admins,
  ])

  const plan = []
  for (const email of subjects) {
    if (!email) continue
    let role
    if (admins.has(email)) {
      role = 'owner'
    } else {
      const activeRoles = activeRolesByEmail.get(email)
      role = activeRoles?.length ? MEMBER_TO_GARM_ROLE[highestMemberRole(activeRoles)] : 'viewer'
    }
    plan.push({ email, role })
  }

  return plan.sort((a, b) => a.email.localeCompare(b.email))
}
