import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { HOME_PALETTE as p, contrastRatio } from '@/lib/public/home-palette'

// Palette 3 ("Ivory and indigo") site-wide (Nico, 2026-11-10): the signed-in
// app's --brand-* tokens in app/globals.css carry the same values as the home
// page. This keeps the two in step and checks the pairings the app relies on.

const WHITE = '#ffffff'

const css = readFileSync(join(__dirname, '../../app/globals.css'), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .toLowerCase()

function token(name: string): string {
  const m = css.match(new RegExp(`--${name}:\\s*(#[0-9a-f]{6})\\s*;`))
  if (!m) throw new Error(`--${name} not found in globals.css`)
  return m[1]
}

describe('globals.css brand tokens follow the home palette', () => {
  it.each([
    ['background', p.bg],
    ['foreground', p.black],
    ['brand-cream', p.bg],
    ['brand-navy', p.blue],
    ['brand-navy-light', p.hover],
    ['brand-slate', p.muted],
    ['brand-charcoal', p.black],
  ])('--%s is %s', (name, hex) => {
    expect(token(name)).toBe(hex)
  })

  it('drops the unused --brand-navy-dark token', () => {
    expect(css).not.toContain('--brand-navy-dark')
  })
})

describe('signed-in app contrast (WCAG AA body text, 4.5:1)', () => {
  const pairs: [string, string, string][] = [
    ['charcoal text on cream', p.black, p.bg],
    ['charcoal text on white cards', p.black, WHITE],
    ['navy text on cream', p.blue, p.bg],
    ['navy text on white cards', p.blue, WHITE],
    ['slate text on cream', p.muted, p.bg],
    ['slate text on white cards', p.muted, WHITE],
    ['white text on navy buttons', WHITE, p.blue],
    ['white text on navy-light (hover)', WHITE, p.hover],
    ['cream text on navy', p.bg, p.blue],
  ]
  it.each(pairs)('%s', (_label, fg, bg) => {
    expect(contrastRatio(fg, bg)).toBeGreaterThanOrEqual(4.5)
  })
})

describe('brand assets use the palette', () => {
  const files = ['app/icon.svg', 'app/apple-icon.svg', 'lib/og/cards.tsx']
  it.each(files)('%s has no old brand hex', (file) => {
    const src = readFileSync(join(__dirname, '../..', file), 'utf8').toLowerCase()
    for (const old of ['#1a3c6b', '#f8f8f0', '#4a6e91']) expect(src).not.toContain(old)
  })
})
