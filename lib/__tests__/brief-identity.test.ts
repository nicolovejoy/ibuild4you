import { describe, it, expect } from 'vitest'
import { briefIdentity, GLYPH_KEYS } from '../brief-identity'

// A brief's identity (color + code + glyph) is a stable, PII-free visual handle
// derived purely from its immutable Firestore doc id. These tests lock the two
// properties everything else depends on: it's deterministic (same id → same
// identity, forever, across renames) and it spreads (different ids look
// different).

describe('briefIdentity', () => {
  it('is deterministic — same id always yields the same identity', () => {
    const a = briefIdentity('abc123')
    const b = briefIdentity('abc123')
    expect(a).toEqual(b)
  })

  it('does not depend on title/slug — only the id passed in', () => {
    // Renaming a brief changes its title/slug but never its doc id, so identity
    // must be a pure function of the id alone. (Documented by construction: the
    // signature only accepts the id.)
    const before = briefIdentity('doc-xyz')
    const after = briefIdentity('doc-xyz')
    expect(after).toEqual(before)
  })

  it('produces a valid hue in [0, 360)', () => {
    for (const id of ['a', 'bb', 'ccc', 'project-1', 'Zk9Qw']) {
      const { hue } = briefIdentity(id)
      expect(hue).toBeGreaterThanOrEqual(0)
      expect(hue).toBeLessThan(360)
      expect(Number.isInteger(hue)).toBe(true)
    }
  })

  it('emits an hsl() color string usable in inline styles and next/og', () => {
    const { color } = briefIdentity('abc123')
    expect(color).toMatch(/^hsl\(\d{1,3}, \d{1,3}%, \d{1,3}%\)$/)
  })

  it('emits a 4-char uppercase hex code', () => {
    const { code } = briefIdentity('abc123')
    expect(code).toMatch(/^[0-9A-F]{4}$/)
  })

  it('picks a glyph from the known set', () => {
    const { glyphKey } = briefIdentity('abc123')
    expect(GLYPH_KEYS).toContain(glyphKey)
  })

  it('spreads hue across the wheel for distinct ids (not all clustered)', () => {
    const ids = Array.from({ length: 200 }, (_, i) => `firestore-doc-id-${i}`)
    const hues = ids.map((id) => briefIdentity(id).hue)
    // Expect coverage across the wheel: at least one hue in each quadrant.
    const quadrants = new Set(hues.map((h) => Math.floor(h / 90)))
    expect(quadrants.size).toBe(4)
  })

  it('spreads glyphs roughly evenly across the set (not all one shape)', () => {
    const counts = new Map<string, number>()
    for (let i = 0; i < 2000; i++) {
      const { glyphKey } = briefIdentity(`firestore-doc-id-${i}`)
      counts.set(glyphKey, (counts.get(glyphKey) ?? 0) + 1)
    }
    // Every glyph should appear, and none should dominate (~250 expected each).
    expect(counts.size).toBe(GLYPH_KEYS.length)
    for (const n of counts.values()) {
      expect(n).toBeGreaterThan(150)
      expect(n).toBeLessThan(400)
    }
  })

  it('rarely collides on the full identity for distinct ids', () => {
    const ids = Array.from({ length: 300 }, (_, i) => `id-${i}-${i * 7}`)
    const fingerprints = new Set(
      ids.map((id) => {
        const { hue, code, glyphKey } = briefIdentity(id)
        return `${hue}|${code}|${glyphKey}`
      }),
    )
    // Code alone is 16 bits; combined with hue+glyph, collisions should be near
    // zero across a few hundred briefs.
    expect(fingerprints.size).toBeGreaterThan(295)
  })
})
