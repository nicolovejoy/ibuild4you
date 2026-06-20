import type { BriefRole } from '@/lib/types'
import { ROLE_GLYPHS } from '@/lib/roles/mode'
import { briefRoleLabel, briefRoleShort } from '@/lib/roles/display'

// Renders the viewer's per-brief role as a studio-family glyph (mode channel),
// kept separate from the brief's identity badge (BriefBadge). The glyph is never
// the sole carrier of meaning — it always pairs with an aria-label (the role
// term) and a tooltip (the one-line description).
export function RoleGlyph({
  role,
  size = 16,
  className = '',
}: {
  role: BriefRole
  size?: number
  className?: string
}) {
  return (
    <span
      role="img"
      aria-label={briefRoleLabel(role)}
      title={briefRoleShort(role)}
      className={`shrink-0 leading-none ${className}`}
      style={{ fontSize: size }}
    >
      {ROLE_GLYPHS[role]}
    </span>
  )
}
