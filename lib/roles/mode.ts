import type { BriefRole } from '@/lib/types'

// Mode — the per-viewer "what's my relationship to this brief" channel.
// Kept strictly separate from brief *identity* (lib/brief-identity.ts): identity
// answers "which brief" (viewer-independent), mode answers "my role here". Two
// orthogonal channels — never merge them. See docs/mode-system.md.

// Coarse chrome treatment: am I a voice in the room, or running the brief?
export type ChromeMode = 'conversation' | 'console'

// Fine-grained: one glyph per brief role, drawn from a single studio/production
// family so the set reads as a system and future roles slot in naturally. Always
// paired with an aria-label at the render site (RoleGlyph) — never the sole
// carrier of meaning.
export const ROLE_GLYPHS: Record<BriefRole, string> = {
  originator: '🎤', // brought the idea, the lead voice
  contributor: '🎸', // joins in, adds their part
  reviewer: '🎛️', // at the board, shapes and operates
}

// Single source of truth for the chrome split, so every surface agrees.
// Originator/Contributor are on stage (conversation); Reviewer is in the booth
// (console). Owner/builder/admin access tiers resolve to 'reviewer' upstream
// (viewerBriefRole), so they land in 'console' here.
export function resolveMode(role: BriefRole): ChromeMode {
  return role === 'reviewer' ? 'console' : 'conversation'
}
