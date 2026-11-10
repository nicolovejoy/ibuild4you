// The signed-out home page's palette (palette 3, "Ivory and indigo"), as fixed
// hex. The three base colours were picked by Nico on 2026-11-09; muted, hover
// and ownerTint are the mock's color-mix(in oklab, ...) shades resolved once at
// build time, so no browser has to mix them. The same values sit in
// components/public/hero/home.css as --h-* tokens; home-palette.test.ts keeps
// the two in step and checks the contrast pairs the page relies on.

export const HOME_PALETTE = {
  bg: '#fbf8f1',
  blue: '#283673',
  black: '#24211d',
  // color-mix(in oklab, blue 72%, #8a9099): secondary text and bullets.
  muted: '#414f7f',
  // color-mix(in oklab, blue 85%, white): button hover.
  hover: '#435388',
  // color-mix(in oklab, blue 10%, white): the "<Maker> decides" tag background.
  ownerTint: '#e7e9f1',
} as const

// Linear-light value of one 0-255 sRGB channel (WCAG 2.x definition).
function channel(value: number): number {
  const c = value / 255
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
}

function relativeLuminance(hex: string): number {
  const n = parseInt(hex.replace('#', ''), 16)
  return (
    0.2126 * channel((n >> 16) & 255) + 0.7152 * channel((n >> 8) & 255) + 0.0722 * channel(n & 255)
  )
}

// WCAG contrast ratio between two #rrggbb colours, 1 to 21, order-independent.
export function contrastRatio(hexA: string, hexB: string): number {
  const a = relativeLuminance(hexA)
  const b = relativeLuminance(hexB)
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)
}
