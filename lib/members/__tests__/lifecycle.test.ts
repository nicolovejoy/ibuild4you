import { describe, it, expect } from 'vitest'
import {
  isActiveMember,
  planAccessTierChange,
  planRemoveMember,
  planRestoreMember,
  type MemberRow,
} from '../lifecycle'

const NOW = '2026-07-01T00:00:00.000Z'

function rows(...members: Array<Partial<MemberRow> & { id: string }>): MemberRow[] {
  return members.map((m) => ({ email: `${m.id}@x.com`, role: 'maker', removed_at: null, ...m }))
}

describe('isActiveMember', () => {
  it('is active when removed_at is missing or null', () => {
    expect(isActiveMember({})).toBe(true)
    expect(isActiveMember({ removed_at: null })).toBe(true)
  })
  it('is inactive once removed_at is set', () => {
    expect(isActiveMember({ removed_at: NOW })).toBe(false)
  })
})

describe('planAccessTierChange', () => {
  it('returns a role patch for a valid change', () => {
    const members = rows({ id: 'owner1', role: 'owner' }, { id: 'm', role: 'maker' })
    const plan = planAccessTierChange({ members, memberId: 'm', newRole: 'builder', now: NOW })
    expect(plan).toEqual({ patch: { role: 'builder', updated_at: NOW } })
  })

  it('errors when the target member is not found', () => {
    const plan = planAccessTierChange({ members: rows({ id: 'a' }), memberId: 'ghost', newRole: 'builder', now: NOW })
    expect(plan).toHaveProperty('error')
  })

  it('errors on an invalid role', () => {
    const plan = planAccessTierChange({ members: rows({ id: 'a' }), memberId: 'a', newRole: 'wizard', now: NOW })
    expect(plan).toHaveProperty('error')
  })

  it('refuses to change a removed member (restore first)', () => {
    const members = rows({ id: 'owner1', role: 'owner' }, { id: 'm', role: 'maker', removed_at: NOW })
    const plan = planAccessTierChange({ members, memberId: 'm', newRole: 'builder', now: NOW })
    expect(plan).toHaveProperty('error')
  })

  it('refuses to demote the last active owner', () => {
    const members = rows({ id: 'owner1', role: 'owner' }, { id: 'm', role: 'maker' })
    const plan = planAccessTierChange({ members, memberId: 'owner1', newRole: 'builder', now: NOW })
    expect(plan).toHaveProperty('error')
  })

  it('allows demoting an owner when another active owner remains', () => {
    const members = rows({ id: 'owner1', role: 'owner' }, { id: 'owner2', role: 'owner' })
    const plan = planAccessTierChange({ members, memberId: 'owner1', newRole: 'builder', now: NOW })
    expect(plan).toEqual({ patch: { role: 'builder', updated_at: NOW } })
  })

  it('does not count a removed owner toward the last-owner guard', () => {
    const members = rows(
      { id: 'owner1', role: 'owner' },
      { id: 'owner2', role: 'owner', removed_at: NOW }
    )
    // owner1 is the only ACTIVE owner → demotion refused
    const plan = planAccessTierChange({ members, memberId: 'owner1', newRole: 'maker', now: NOW })
    expect(plan).toHaveProperty('error')
  })

  it('promoting a non-owner to owner is always allowed', () => {
    const members = rows({ id: 'owner1', role: 'owner' }, { id: 'm', role: 'maker' })
    const plan = planAccessTierChange({ members, memberId: 'm', newRole: 'owner', now: NOW })
    expect(plan).toEqual({ patch: { role: 'owner', updated_at: NOW } })
  })
})

describe('planRemoveMember', () => {
  it('marks a member removed with who/when', () => {
    const members = rows({ id: 'owner1', role: 'owner' }, { id: 'm', role: 'maker' })
    const plan = planRemoveMember({ members, memberId: 'm', actorEmail: 'op@x.com', now: NOW })
    expect(plan).toEqual({ patch: { removed_at: NOW, removed_by: 'op@x.com', updated_at: NOW } })
  })

  it('errors when the target is not found', () => {
    const plan = planRemoveMember({ members: rows({ id: 'a' }), memberId: 'ghost', actorEmail: 'op@x.com', now: NOW })
    expect(plan).toHaveProperty('error')
  })

  it('errors when the member is already removed', () => {
    const members = rows({ id: 'owner1', role: 'owner' }, { id: 'm', role: 'maker', removed_at: NOW })
    const plan = planRemoveMember({ members, memberId: 'm', actorEmail: 'op@x.com', now: NOW })
    expect(plan).toHaveProperty('error')
  })

  it('refuses to remove the last active owner', () => {
    const members = rows({ id: 'owner1', role: 'owner' }, { id: 'm', role: 'maker' })
    const plan = planRemoveMember({ members, memberId: 'owner1', actorEmail: 'op@x.com', now: NOW })
    expect(plan).toHaveProperty('error')
  })

  it('removes an owner when another active owner remains', () => {
    const members = rows({ id: 'owner1', role: 'owner' }, { id: 'owner2', role: 'owner' })
    const plan = planRemoveMember({ members, memberId: 'owner1', actorEmail: 'op@x.com', now: NOW })
    expect(plan).toEqual({ patch: { removed_at: NOW, removed_by: 'op@x.com', updated_at: NOW } })
  })
})

describe('planRestoreMember', () => {
  it('clears removal fields for a removed member', () => {
    const members = rows({ id: 'm', role: 'maker', removed_at: '2026-06-01T00:00:00.000Z' })
    const plan = planRestoreMember({ members, memberId: 'm', now: NOW })
    expect(plan).toEqual({ patch: { removed_at: null, removed_by: null, updated_at: NOW } })
  })

  it('errors when the target is not found', () => {
    const plan = planRestoreMember({ members: rows({ id: 'a' }), memberId: 'ghost', now: NOW })
    expect(plan).toHaveProperty('error')
  })

  it('errors when the member is already active', () => {
    const members = rows({ id: 'm', role: 'maker' })
    const plan = planRestoreMember({ members, memberId: 'm', now: NOW })
    expect(plan).toHaveProperty('error')
  })
})
