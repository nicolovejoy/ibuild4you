import { describe, it, expect } from 'vitest'
import { BRIEF_ROLES } from '../brief-role'
import { ROLE_GLYPHS, resolveMode } from '../mode'
import type { BriefRole } from '@/lib/types'

describe('ROLE_GLYPHS', () => {
  it('has a distinct glyph for every brief role', () => {
    const glyphs = BRIEF_ROLES.map((r) => ROLE_GLYPHS[r])
    expect(glyphs.every(Boolean)).toBe(true)
    expect(new Set(glyphs).size).toBe(BRIEF_ROLES.length)
  })
})

describe('resolveMode', () => {
  it('puts originator and contributor in conversation', () => {
    expect(resolveMode('originator')).toBe('conversation')
    expect(resolveMode('contributor')).toBe('conversation')
  })

  it('puts reviewer in console', () => {
    expect(resolveMode('reviewer')).toBe('console')
  })

  it('returns a valid chrome mode for every role', () => {
    for (const role of BRIEF_ROLES as BriefRole[]) {
      expect(['conversation', 'console']).toContain(resolveMode(role))
    }
  })
})
