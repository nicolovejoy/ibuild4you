import type { BriefRole } from '@/lib/types'

// One glyph per brief role, drawn from a single studio/production family so
// the set reads as a system and future roles slot in naturally. Always paired
// with an aria-label at the render site (RoleGlyph) — never the sole carrier
// of meaning.
export const ROLE_GLYPHS: Record<BriefRole, string> = {
  originator: '🎤', // brought the idea, the lead voice
  contributor: '🎸', // joins in, adds their part
  reviewer: '🎛️', // at the board, shapes and operates
}
