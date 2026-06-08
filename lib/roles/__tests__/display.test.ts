import { describe, it, expect } from 'vitest'
import { briefRoleLabel, briefRoleShort, viewerBriefRole } from '../display'
import { copy } from '@/lib/copy'

describe('briefRoleLabel', () => {
  it('returns the human-facing term for each brief role', () => {
    expect(briefRoleLabel('originator')).toBe('Originator')
    expect(briefRoleLabel('contributor')).toBe('Contributor')
    expect(briefRoleLabel('reviewer')).toBe('Reviewer')
  })
})

describe('briefRoleShort', () => {
  it('sources the tooltip text from the glossary', () => {
    expect(briefRoleShort('originator')).toBe(copy.glossary.originator.short)
    expect(briefRoleShort('reviewer')).toBe(copy.glossary.reviewer.short)
  })
})

describe('viewerBriefRole', () => {
  it('maps access tiers to the implied brief role', () => {
    expect(viewerBriefRole('maker')).toBe('originator')
    expect(viewerBriefRole('apprentice')).toBe('contributor')
    expect(viewerBriefRole('builder')).toBe('reviewer')
  })

  it('falls back to reviewer for console operators without an implied role', () => {
    // Owner/admin operate the builder console in a reviewing capacity.
    expect(viewerBriefRole('owner')).toBe('reviewer')
    expect(viewerBriefRole('admin')).toBe('reviewer')
    expect(viewerBriefRole(null)).toBe('reviewer')
    expect(viewerBriefRole(undefined)).toBe('reviewer')
  })

  it('prefers an explicit stored brief_role over the access-tier default', () => {
    // The bug 1d surfaced: a Contributor (access tier `maker`) was shown as
    // Originator because the badge used the tier default. The stored role wins.
    expect(viewerBriefRole('maker', 'contributor')).toBe('contributor')
    expect(viewerBriefRole('maker', 'reviewer')).toBe('reviewer')
    expect(viewerBriefRole('owner', 'originator')).toBe('originator')
  })

  it('ignores a null/invalid stored brief_role and uses the tier default', () => {
    expect(viewerBriefRole('maker', null)).toBe('originator')
    expect(viewerBriefRole('builder', undefined)).toBe('reviewer')
    // owner's own brief_role is null by design → fall back to tier default
    expect(viewerBriefRole('owner', null)).toBe('reviewer')
  })
})
