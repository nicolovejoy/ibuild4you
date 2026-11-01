import { normalizeEmail } from '@/lib/email/normalize'

/**
 * True when a membership row belongs to the signed-in viewer. Both emails must
 * be non-empty; compared after normalization. One comparison, used by the
 * server guards and the People panel (#245).
 */
export function isSelfRow(
  memberEmail: string | null | undefined,
  viewerEmail: string | null | undefined
): boolean {
  const member = normalizeEmail(memberEmail)
  const viewer = normalizeEmail(viewerEmail)
  return !!member && !!viewer && member === viewer
}
