import { describe, it, expect } from 'vitest'
import { BRIEF_ROLES } from '../brief-role'
import { ROLE_GLYPHS } from '../glyphs'

describe('ROLE_GLYPHS', () => {
  it('has a distinct glyph for every brief role', () => {
    const glyphs = BRIEF_ROLES.map((r) => ROLE_GLYPHS[r])
    expect(glyphs.every(Boolean)).toBe(true)
    expect(new Set(glyphs).size).toBe(BRIEF_ROLES.length)
  })
})
