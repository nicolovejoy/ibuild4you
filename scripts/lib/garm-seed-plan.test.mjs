import { describe, it, expect } from 'vitest'
import { buildGrantPlan } from './garm-seed-plan.mjs'

function member(overrides) {
  return { removed_at: null, ...overrides }
}

describe('buildGrantPlan', () => {
  it('maps each MemberRole to the locked Garm role', () => {
    const plan = buildGrantPlan({
      approvedEmails: [],
      members: [
        member({ email: 'owner@x.com', role: 'owner' }),
        member({ email: 'builder@x.com', role: 'builder' }),
        member({ email: 'apprentice@x.com', role: 'apprentice' }),
        member({ email: 'maker@x.com', role: 'maker' }),
      ],
      adminEmails: [],
      systemAdminEmails: [],
    })
    expect(plan).toEqual([
      { email: 'apprentice@x.com', role: 'viewer' },
      { email: 'builder@x.com', role: 'collaborator' },
      { email: 'maker@x.com', role: 'viewer' },
      { email: 'owner@x.com', role: 'owner' },
    ])
  })

  it('highest role wins across multiple active memberships for the same person', () => {
    const plan = buildGrantPlan({
      approvedEmails: [],
      members: [
        member({ email: 'sam@x.com', role: 'maker' }),
        member({ email: 'sam@x.com', role: 'builder' }),
        member({ email: 'sam@x.com', role: 'apprentice' }),
      ],
      adminEmails: [],
      systemAdminEmails: [],
    })
    expect(plan).toEqual([{ email: 'sam@x.com', role: 'collaborator' }])
  })

  it('excludes removed rows from the highest-role computation', () => {
    const plan = buildGrantPlan({
      approvedEmails: [],
      members: [
        member({ email: 'sam@x.com', role: 'owner', removed_at: '2026-01-01T00:00:00.000Z' }),
        member({ email: 'sam@x.com', role: 'maker' }),
      ],
      adminEmails: [],
      systemAdminEmails: [],
    })
    expect(plan).toEqual([{ email: 'sam@x.com', role: 'viewer' }])
  })

  it('drops a person whose only rows are all removed', () => {
    const plan = buildGrantPlan({
      approvedEmails: [],
      members: [member({ email: 'gone@x.com', role: 'owner', removed_at: '2026-01-01T00:00:00.000Z' })],
      adminEmails: [],
      systemAdminEmails: [],
    })
    expect(plan).toEqual([])
  })

  it('admin override beats a low brief role', () => {
    const plan = buildGrantPlan({
      approvedEmails: [],
      members: [member({ email: 'admin@x.com', role: 'maker' })],
      adminEmails: ['admin@x.com'],
      systemAdminEmails: [],
    })
    expect(plan).toEqual([{ email: 'admin@x.com', role: 'owner' }])
  })

  it('system-role admin override also beats a low brief role', () => {
    const plan = buildGrantPlan({
      approvedEmails: [],
      members: [member({ email: 'sysadmin@x.com', role: 'maker' })],
      adminEmails: [],
      systemAdminEmails: ['sysadmin@x.com'],
    })
    expect(plan).toEqual([{ email: 'sysadmin@x.com', role: 'owner' }])
  })

  it('admin with no member rows still gets owner', () => {
    const plan = buildGrantPlan({
      approvedEmails: [],
      members: [],
      adminEmails: ['admin@x.com'],
      systemAdminEmails: [],
    })
    expect(plan).toEqual([{ email: 'admin@x.com', role: 'owner' }])
  })

  it('approved-but-inactive email (no active member row) maps to viewer', () => {
    const plan = buildGrantPlan({
      approvedEmails: ['invited@x.com'],
      members: [],
      adminEmails: [],
      systemAdminEmails: [],
    })
    expect(plan).toEqual([{ email: 'invited@x.com', role: 'viewer' }])
  })

  it('approved email is not double-counted when also an active member', () => {
    const plan = buildGrantPlan({
      approvedEmails: ['sam@x.com'],
      members: [member({ email: 'sam@x.com', role: 'builder' })],
      adminEmails: [],
      systemAdminEmails: [],
    })
    expect(plan).toEqual([{ email: 'sam@x.com', role: 'collaborator' }])
  })

  it('normalizes and dedupes case/whitespace email variants into one entry', () => {
    const plan = buildGrantPlan({
      approvedEmails: [],
      members: [
        member({ email: '  Sam@X.com ', role: 'maker' }),
        member({ email: 'sam@x.com', role: 'owner' }),
      ],
      adminEmails: [],
      systemAdminEmails: [],
    })
    expect(plan).toEqual([{ email: 'sam@x.com', role: 'owner' }])
  })

  it('sorts the result by email for stable dry-run diffs', () => {
    const plan = buildGrantPlan({
      approvedEmails: [],
      members: [
        member({ email: 'zed@x.com', role: 'maker' }),
        member({ email: 'anna@x.com', role: 'maker' }),
      ],
      adminEmails: [],
      systemAdminEmails: [],
    })
    expect(plan.map((g) => g.email)).toEqual(['anna@x.com', 'zed@x.com'])
  })

  it('returns an empty array for empty inputs', () => {
    const plan = buildGrantPlan({ approvedEmails: [], members: [], adminEmails: [], systemAdminEmails: [] })
    expect(plan).toEqual([])
  })
})
