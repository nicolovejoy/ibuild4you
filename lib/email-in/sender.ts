import { normalizeEmail } from '@/lib/email/normalize'

// Who may write to a project's address: an active member of that project whose
// mail passes DMARC. DMARC is the only check that ties the visible From line to
// the sending domain; SPF or DKIM passing alone says nothing about From.

export interface SenderMember {
  email: string
  role: unknown
  display_name?: string
  removed_at?: string | null
}

export type SenderCheck =
  | { ok: true; from_email: string; from_name: string; from_role: 'maker' | 'builder' }
  | { ok: false; reason: 'not_member' }
  | { ok: false; reason: 'auth_failed'; from_email: string }

// The address in a From header: the part inside angle brackets when there is
// one ("Bill Duris" <BDuris@AOL.com>), else the whole value. Normalized.
function fromAddress(from: string): string {
  const wrapped = from.match(/<([^>]+)>/)
  return normalizeEmail(wrapped ? wrapped[1] : from)
}

// Owner, builder and apprentice are all builder side here, wider than
// isBuilderSideRole: an apprentice's email must never read as the maker's
// words. Any other value (missing, legacy, unknown) gives null, and the
// sender is then treated as not a member: we fail closed.
function emailRole(role: unknown): 'maker' | 'builder' | null {
  if (role === 'maker') return 'maker'
  if (role === 'owner' || role === 'builder' || role === 'apprentice') return 'builder'
  return null
}

export function checkSender(args: {
  from: string
  dmarc: string | null
  members: SenderMember[]
}): SenderCheck {
  const address = fromAddress(args.from)
  if (!address.includes('@')) return { ok: false, reason: 'not_member' }

  const member = args.members.find((m) => !m.removed_at && normalizeEmail(m.email) === address)
  const role = member ? emailRole(member.role) : null
  if (!member || !role) return { ok: false, reason: 'not_member' }

  // The claimed sender is a member, so keeping the address is fine: it is what
  // tells the builder that this member's mail is being refused.
  if (args.dmarc !== 'pass') return { ok: false, reason: 'auth_failed', from_email: address }

  // Same fallback as getUserDisplayName: the address's local part.
  const from_name = member.display_name?.trim() || address.split('@')[0]
  return { ok: true, from_email: address, from_name, from_role: role }
}
