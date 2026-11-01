import { normalizeEmail } from '@/lib/email/normalize'

/**
 * True when a membership row belongs to the signed-in viewer. Both emails must
 * be non-empty; compared after normalization. One comparison, used by the
 * server guards and the People panel (#245).
 * A Garm email alias (#169) of the member-row email is not recognised as self
 * (accepted; recognising it would need alias resolution).
 */
export function isSelfRow(
  memberEmail: string | null | undefined,
  viewerEmail: string | null | undefined
): boolean {
  const member = normalizeEmail(memberEmail)
  const viewer = normalizeEmail(viewerEmail)
  return !!member && !!viewer && member === viewer
}
