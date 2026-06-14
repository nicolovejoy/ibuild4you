import { Circle, Square, Triangle, Hexagon, Diamond, Star, Pentagon, Octagon, type LucideIcon } from 'lucide-react'
import { briefIdentity, type GlyphKey } from '@/lib/brief-identity'

// Renders a brief's visual identity — glyph + optional code in the brief's
// deterministic color. The same brief shows the same badge everywhere it
// appears, so someone with several briefs can tell them apart at a glance.
// Identity is derived from the doc id only (PII-free) — see lib/brief-identity.

const GLYPHS: Record<GlyphKey, LucideIcon> = {
  circle: Circle,
  square: Square,
  triangle: Triangle,
  hexagon: Hexagon,
  diamond: Diamond,
  star: Star,
  pentagon: Pentagon,
  octagon: Octagon,
}

interface BriefBadgeProps {
  id: string
  showCode?: boolean
  size?: number // glyph size in px
  className?: string
}

export function BriefBadge({ id, showCode = false, size = 14, className = '' }: BriefBadgeProps) {
  const { color, code, glyphKey } = briefIdentity(id)
  const Glyph = GLYPHS[glyphKey]
  return (
    <span className={`inline-flex items-center gap-1 shrink-0 ${className}`} title={`Brief ${code}`}>
      <Glyph size={size} style={{ color }} fill={color} strokeWidth={0} aria-hidden />
      {showCode && (
        <span className="text-[10px] font-semibold tracking-wider tabular-nums" style={{ color }}>
          {code}
        </span>
      )}
    </span>
  )
}
