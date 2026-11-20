import { isValidEmail, normalizeEmail } from '@/lib/email/normalize'

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

// The address a mail receiver treats as the From address, or null. DMARC is
// checked by Resend against that real address, so taking any other address
// out of the header (one inside a quoted display name, a comment, a second
// mailbox) would let a sender whose own domain passes DMARC put words in a
// member's mouth. So only two shapes are accepted, and anything else fails
// closed:
//   bare:   addr                         (whitespace around it only)
//   named:  [name] <addr>                (angle group last, whitespace after)
// where name is one double-quoted string (anything inside, with \" escapes)
// or unquoted text with none of < > ( ) , ". That rejects some legal headers
// a real client could send, such as Duris, Bill <b@aol.com> or
// Bill (Home) <b@aol.com>: dropping those is the price of never guessing.
const BARE = /^\s*([^\s<>()",]+)\s*$/
const NAMED = /^\s*(?:"(?:[^"\\]|\\.)*"\s*|[^<>()",]*)<([^<>]*)>\s*$/
const PRINTABLE_ASCII = /^[\x21-\x7e]+$/

function fromAddress(from: string): string | null {
  const match = from.match(BARE) ?? from.match(NAMED)
  if (!match) return null
  const raw = match[1]
  // Before lowercasing: toLowerCase maps some non-ASCII letters to ASCII ones
  // (U+212A KELVIN SIGN becomes k), which could forge a member's address.
  if (!PRINTABLE_ASCII.test(raw)) return null
  const parts = raw.split('@')
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null
  if (!isValidEmail(raw)) return null
  return normalizeEmail(raw)
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
  if (!address) return { ok: false, reason: 'not_member' }

  // Every active row for this address must have a known role. If two rows
  // disagree, builder side wins, so an ambiguous row never reads as the
  // maker's words.
  const rows = args.members.filter((m) => !m.removed_at && normalizeEmail(m.email) === address)
  if (rows.length === 0) return { ok: false, reason: 'not_member' }
  const roles = rows.map((m) => emailRole(m.role))
  if (roles.includes(null)) return { ok: false, reason: 'not_member' }
  const role: 'maker' | 'builder' = roles.includes('builder') ? 'builder' : 'maker'
  const member = rows.find((m) => m.display_name?.trim()) ?? rows[0]

  // The claimed sender is a member, so keeping the address is fine: it is what
  // tells the builder that this member's mail is being refused.
  if (args.dmarc !== 'pass') return { ok: false, reason: 'auth_failed', from_email: address }

  // Same fallback as getUserDisplayName: the address's local part.
  const from_name = member.display_name?.trim() || address.split('@')[0]
  return { ok: true, from_email: address, from_name, from_role: role }
}
