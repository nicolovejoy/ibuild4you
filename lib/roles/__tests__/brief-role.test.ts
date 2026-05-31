import { describe, it, expect } from 'vitest'
import {
  BRIEF_ROLES,
  isBriefRole,
  defaultBriefRole,
  resolveBriefRole,
} from '../brief-role'

describe('isBriefRole', () => {
  it('accepts the three valid brief roles', () => {
    for (const r of BRIEF_ROLES) expect(isBriefRole(r)).toBe(true)
  })

  it('rejects access-tier roles and junk', () => {
    expect(isBriefRole('maker')).toBe(false)
    expect(isBriefRole('owner')).toBe(false)
    expect(isBriefRole('')).toBe(false)
    expect(isBriefRole(undefined)).toBe(false)
    expect(isBriefRole(null)).toBe(false)
    expect(isBriefRole(42)).toBe(false)
  })
})

describe('defaultBriefRole', () => {
  it('maps each access tier to its implied brief role', () => {
    expect(defaultBriefRole('maker')).toBe('originator')
    expect(defaultBriefRole('builder')).toBe('reviewer')
    expect(defaultBriefRole('apprentice')).toBe('contributor')
    expect(defaultBriefRole('owner')).toBe(null)
  })
})

describe('resolveBriefRole', () => {
  it('honors an explicitly-supplied valid brief role', () => {
    expect(resolveBriefRole('reviewer', 'maker')).toBe('reviewer')
    expect(resolveBriefRole('contributor', 'owner')).toBe('contributor')
  })

  it('falls back to the access-tier default for invalid/missing input', () => {
    expect(resolveBriefRole(undefined, 'maker')).toBe('originator')
    expect(resolveBriefRole(null, 'builder')).toBe('reviewer')
    expect(resolveBriefRole('nonsense', 'apprentice')).toBe('contributor')
    expect(resolveBriefRole('owner', 'owner')).toBe(null)
  })
})
