import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { HOME_PALETTE as p, contrastRatio } from '@/lib/public/home-palette'

const WHITE = '#ffffff'

describe('contrastRatio', () => {
  it('matches the WCAG reference values', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 5)
    expect(contrastRatio('#ffffff', '#ffffff')).toBeCloseTo(1, 5)
    // Order does not matter.
    expect(contrastRatio('#767676', '#ffffff')).toBeCloseTo(contrastRatio('#ffffff', '#767676'), 10)
    expect(contrastRatio('#767676', '#ffffff')).toBeCloseTo(4.54, 2)
  })
})

describe('home palette contrast (WCAG AA body text, 4.5:1)', () => {
  it('muted text reads on the page background', () => {
    expect(contrastRatio(p.muted, p.bg)).toBeGreaterThanOrEqual(4.5)
  })
  it('muted text reads on white panels', () => {
    expect(contrastRatio(p.muted, WHITE)).toBeGreaterThanOrEqual(4.5)
  })
  it('faint text (conversation title, placeholder, version, provenance) reads on the page background', () => {
    expect(contrastRatio(p.faint, p.bg)).toBeGreaterThanOrEqual(4.5)
  })
  it('faint text reads on white panels', () => {
    expect(contrastRatio(p.faint, WHITE)).toBeGreaterThanOrEqual(4.5)
  })
  it('black text reads on the page background', () => {
    expect(contrastRatio(p.black, p.bg)).toBeGreaterThanOrEqual(4.5)
  })
  it('white text reads on the blue (button, maker bubble)', () => {
    expect(contrastRatio(WHITE, p.blue)).toBeGreaterThanOrEqual(4.5)
  })
  it('blue text reads on the maker tag tint', () => {
    expect(contrastRatio(p.blue, p.ownerTint)).toBeGreaterThanOrEqual(4.5)
  })
})

describe('home.css', () => {
  // Comments describe the palette in prose, so strip them: each value must
  // appear in an actual declaration, not just a comment.
  const css = readFileSync(join(__dirname, '../../components/public/hero/home.css'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .toLowerCase()

  it.each(Object.entries(p))('uses the %s constant (%s)', (_name, hex) => {
    expect(css).toContain(hex)
  })

  it('is scoped to the home root, with no bare selectors', () => {
    const selectors = css
      .replace(/\{[^}]*\}/g, '|')
      .split('|')
      .map((s) => s.trim())
      .filter(Boolean)
    for (const s of selectors) expect(s.startsWith('[data-home]')).toBe(true)
  })
})
