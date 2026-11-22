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
// out of the header (one inside a display name, a comment, a group, a second
// mailbox) would let a sender whose own domain passes DMARC put words in a
// member's mouth. So only two shapes are accepted, and anything else fails
// closed:
//   bare:   addr
//   named:  [name] <addr>                (the angle group is last)
// Spaces and tabs may surround either shape; they are the only whitespace.
// The name is either
//   - one double-quoted string: anything inside but " and \, which must be
//     escaped as \" and \\, or
//   - unquoted text of spaces, tabs, printable ASCII other than
//     < > ( ) , " @ : ; [ ] \, and Unicode letters and combining marks.
//     Excluding @ : ; [ ] \ is what stops a mailbox or a group
//     (g: a@b.com;) hiding in front of the real angle group.
// addr must be plain printable ASCII with exactly one @.
// Rejected outright, never unfolded or cleaned: a header over 998 characters
// and any control character (every C0 control but tab, DEL, U+2028, U+2029).
// That rejects some legal headers a real client could send, such as
// Duris, Bill <b@aol.com>, Bill (Home) <b@aol.com> or a folded line:
// dropping those is the price of never guessing.

// RFC 5322's line limit. Checked first so that no pattern below ever runs on
// a long adversarial input.
const MAX_FROM_LENGTH = 998
// Every C0 control except tab, plus DEL and the two Unicode line separators.
const FORBIDDEN_CHAR = /[\x00-\x08\x0a-\x1f\x7f\u2028\u2029]/
const BARE = /^([^ \t<>()",]+)$/
// Anchored at both ends, with no leading or trailing whitespace to match
// (trimSpaceTab does that). The two name forms cannot overlap (the unquoted
// one has no "), the quoted one ends at its first unescaped ", and the
// unquoted one stops at the first < (it holds none), so each step has one
// way forward and failing costs one pass, not a retry per split point.
const NAMED = /^(?:"(?:[^"\\]|\\.)*"[ \t]*|[ \t!#-'*+\-./0-9=?A-Z^-~\p{L}\p{M}]*)<([^<>]*)>$/u
const PRINTABLE_ASCII = /^[\x21-\x7e]+$/

// Strip spaces and tabs from both ends, by index, with no regex.
function trimSpaceTab(s: string): string {
  let start = 0
  let end = s.length
  while (start < end && (s[start] === ' ' || s[start] === '\t')) start++
  while (end > start && (s[end - 1] === ' ' || s[end - 1] === '\t')) end--
  return s.slice(start, end)
}

function fromAddress(from: string): string | null {
  if (from.length > MAX_FROM_LENGTH) return null
  if (FORBIDDEN_CHAR.test(from)) return null
  const header = trimSpaceTab(from)
  const match = header.match(BARE) ?? header.match(NAMED)
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

// The active member rows for this normalized address, as one member, or null.
// Every active row for the address must have a known role. If two rows
// disagree, builder side wins, so an ambiguous row never reads as the maker's
// words. Shared by checkSender (who sent this) and quote-author (who wrote a
// quoted block), so both read a member the same way.
export function memberForAddress(
  address: string,
  members: SenderMember[]
): { role: 'maker' | 'builder'; name: string } | null {
  const rows = members.filter((m) => !m.removed_at && normalizeEmail(m.email) === address)
  if (rows.length === 0) return null
  const roles = rows.map((m) => emailRole(m.role))
  if (roles.includes(null)) return null
  const role: 'maker' | 'builder' = roles.includes('builder') ? 'builder' : 'maker'
  const member = rows.find((m) => m.display_name?.trim()) ?? rows[0]
  // Same fallback as getUserDisplayName: the address's local part.
  const name = member.display_name?.trim() || address.split('@')[0]
  return { role, name }
}

export function checkSender(args: {
  from: string
  dmarc: string | null
  members: SenderMember[]
}): SenderCheck {
  const address = fromAddress(args.from)
  if (!address) return { ok: false, reason: 'not_member' }

  const member = memberForAddress(address, args.members)
  if (!member) return { ok: false, reason: 'not_member' }

  // The claimed sender is a member, so keeping the address is fine: it is what
  // tells the builder that this member's mail is being refused.
  if (args.dmarc !== 'pass') return { ok: false, reason: 'auth_failed', from_email: address }

  return { ok: true, from_email: address, from_name: member.name, from_role: member.role }
}
