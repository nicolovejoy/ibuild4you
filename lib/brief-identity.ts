// Brief identity — a stable, PII-free visual handle for a brief.
//
// Derived purely from the brief's immutable Firestore doc id (never the title,
// name, or slug), so it's safe to show on unauthenticated, scraper-cached
// surfaces (OG link-preview cards) and stable across renames. The same brief
// looks the same everywhere it appears — dashboard card, brief/chat header, OG
// card — which lets someone juggling several briefs tell them apart at a glance.
//
// NOTE: this is intentionally separate from the per-participant chat-bubble
// colors in MakerProjectView — those distinguish *people within one brief* and
// use adjacency-guaranteeing enumeration. This distinguishes *briefs from each
// other* and uses hashing. Different problems; don't merge them.

// Glyph keys map to lucide-react icons at the render site (BriefBadge / the OG
// route). Kept as plain strings here so this module stays dependency-free and
// usable from both client components and the Edge/Node OG runtime.
export const GLYPH_KEYS = [
  'circle',
  'square',
  'triangle',
  'hexagon',
  'diamond',
  'star',
  'pentagon',
  'octagon',
] as const

export type GlyphKey = (typeof GLYPH_KEYS)[number]

export interface BriefIdentity {
  hue: number // 0–359
  color: string // hsl() string, usable in inline styles and next/og
  code: string // 4-char uppercase hex handle, e.g. "A3F9"
  glyphKey: GlyphKey
}

// Fixed saturation/lightness keep accents legible and on-brand across the wheel:
// vivid enough to differentiate, muted enough to sit beside the navy palette and
// carry white text if ever used as a fill.
const SATURATION = 65
const LIGHTNESS = 45

// FNV-1a 32-bit — deterministic, no deps, good spread for short ids.
function hash32(input: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i)
    // h *= 16777619, kept in 32-bit range via Math.imul.
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0 // unsigned
}

export function briefIdentity(id: string): BriefIdentity {
  const h = hash32(id)
  const hue = h % 360
  // Derive the code and glyph from upper bits so they aren't trivially
  // correlated with the hue (two briefs sharing a hue still differ in code).
  const code = ((h >>> 8) & 0xffff).toString(16).toUpperCase().padStart(4, '0')
  const glyphKey = GLYPH_KEYS[(h >>> 24) % GLYPH_KEYS.length]
  return {
    hue,
    color: `hsl(${hue}, ${SATURATION}%, ${LIGHTNESS}%)`,
    code,
    glyphKey,
  }
}
