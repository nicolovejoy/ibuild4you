import { isValidEmail, normalizeEmail } from '@/lib/email/normalize'
import { memberForAddress, type SenderMember } from './sender'

// Who wrote a quoted block inside an email. Code decides this, never the model:
// the address in the quote header is matched to the project's members, and a
// name in the header is never what identifies a member (anyone can set their
// display name to "Nico").
//
// `header` is the quote header as new-text.ts finds it: `>` markers already
// stripped, lines joined with "\n". It is either an attribution ("On ... wrote:"
// or the French "Le ... a écrit :", possibly wrapped over two lines) or a
// divider and/or a field block (From:, Sent: or Date:, To:, Subject:). '' means
// the quote has no header, or a quoter the app could not identify.

// `bare` is true when the address is a loose token in the text, not one the mail
// program put in an angle group or a mailto form. false when there is no address.
export type HeaderAuthor = { name: string | null; email: string | null; bare: boolean }

// A quote header is a few lines. Cutting here keeps every pattern below cheap
// whatever the sender put in the email.
const MAX_HEADER_LENGTH = 2000

// An address-shaped token: starts with a letter or digit, so a quote mark
// before it is left out, and ends at the domain's last label, so a full stop
// after it is left out.
const ADDRESS = /[A-Za-z0-9][A-Za-z0-9._%+'-]*@[A-Za-z0-9.-]+\.[A-Za-z0-9-]+/g
const FROM_LINE = /^\s*From:(.*)$/im
// Where the address part starts: an angle group or a [mailto:...] form.
const GROUP_START = /<|\[mailto:/i
// An innermost angle group, and an Outlook [mailto:...] form. In
// <a@b<mailto:a@b>> only the inner group matches, which holds the same address.
const ANGLE_GROUP = /<([^<>]*)>/g
const MAILTO_GROUP = /\[mailto:([^\]]*)\]/gi
// Pieces between an attribution's date and its name. A time zone counts only
// when it follows the time or AM/PM directly: with a comma between, the capitals
// are the start of the name ("10:40 AM, DJ Khaled").
const AM_PM = /^ *(?:AM|PM)\b/
const TIME_ZONE = /^ *[A-Z]{2,5}\b/

// The first address-shaped token that is a valid address, normalized.
function firstAddress(text: string): string | null {
  const token = text.match(ADDRESS)?.[0]
  return token && isValidEmail(token) ? normalizeEmail(token) : null
}

// What leads into an address after the name ("Name <", "Name [mailto:") is cut
// off the end of the name. Done by index, with no regex, so that a long run of
// spaces or brackets cannot make it slow.
function isOpenerChar(c: string): boolean {
  return c === '<' || c === '[' || c === '(' || /\s/.test(c)
}
function stripOpener(text: string): string {
  let end = text.length
  while (end > 0 && isOpenerChar(text[end - 1])) end--
  if (text.slice(0, end).toLowerCase().endsWith('mailto:')) end -= 'mailto:'.length
  while (end > 0 && isOpenerChar(text[end - 1])) end--
  return text.slice(0, end)
}

// The author's address in a From: value or an attribution's middle.
// Display names are written by whoever sent the original mail, so an address
// inside one proves nothing. The real address is the one in the LAST angle
// group or [mailto:] form; if that group holds no valid address there is none,
// and no other token is tried. Only when the text has no group at all is a bare
// address taken, and then only if it is the one address-shaped token in it.
function headerAddress(text: string): { email: string | null; bare: boolean } {
  const groups = [...text.matchAll(ANGLE_GROUP), ...text.matchAll(MAILTO_GROUP)]
  if (groups.length > 0) {
    groups.sort((a, b) => a.index - b.index)
    return { email: firstAddress(groups[groups.length - 1][1]), bare: false }
  }
  const tokens = text.match(ADDRESS)
  const email = tokens?.length === 1 ? firstAddress(tokens[0]) : null
  return { email, bare: email !== null }
}

// The text before the address part: up to the first group, or else up to the
// bare address, or else all of it.
function beforeAddress(text: string): string {
  const group = GROUP_START.exec(text)
  if (group) return text.slice(0, group.index)
  const bare = text.match(ADDRESS)
  return bare?.length === 1 ? text.slice(0, text.indexOf(bare[0])) : text
}

// Surrounding double quotes and spaces off; an empty name is null.
function cleanName(raw: string): string | null {
  const name = raw
    .trim()
    .replace(/^"+|"+$/g, '')
    .trim()
  return name || null
}

// "On <date>, <name> <addr> wrote:" read from the text between On and wrote:.
// The name is what comes after the date: drop everything up to and including
// the last token that holds a digit (a date or a time), then an AM or PM and
// a time zone such as PST. With no digit there is no date to drop.
function attributionName(inner: string): string | null {
  const tokens = stripOpener(beforeAddress(inner)).split(/\s+/)
  let lastDigit = -1
  tokens.forEach((token, i) => {
    if (/\d/.test(token)) lastDigit = i
  })
  if (lastDigit < 0) return cleanName(tokens.join(' '))
  // A comma that ended the date token ("at 18:40, DJ Khaled") stays in front of
  // the rest, so the time zone check sees it and leaves the name alone.
  const comma = tokens[lastDigit].endsWith(',') ? ',' : ''
  const afterDate = `${comma} ${tokens.slice(lastDigit + 1).join(' ')}`
  return cleanName(
    afterDate
      .replace(AM_PM, '')
      .replace(TIME_ZONE, '')
      .replace(/^[\s,]+/, '')
  )
}

export function parseQuoteHeader(header: string): HeaderAuthor {
  const text = header.slice(0, MAX_HEADER_LENGTH)

  // A field block wins over an attribution. Only the first From: line is read:
  // the To: and Cc: lines name recipients, never the author.
  const from = FROM_LINE.exec(text)
  if (from) {
    const value = from[1].trim()
    return { name: cleanName(stripOpener(beforeAddress(value))), ...headerAddress(value) }
  }

  // Otherwise "On ... wrote:" or its French form "Le ... a écrit :", which a
  // mail client may have wrapped over two lines. Its address is read the same
  // way, from the text between On and wrote: (or Le and a écrit).
  const inner = attributionInner(text.split('\n').join(' '))
  if (inner !== null) return { name: attributionName(inner), ...headerAddress(inner) }

  return { name: null, email: null, bare: false }
}

// The text between an attribution's opening word and its closing words, or
// null when the header is not an attribution. English first, then French.
function attributionInner(joined: string): string | null {
  const on = /\bOn\s/.exec(joined)
  const wrote = joined.lastIndexOf('wrote:')
  if (on && wrote > on.index) return joined.slice(on.index + on[0].length, wrote)
  const le = /\bLe\s/.exec(joined)
  const ecrit = joined.lastIndexOf(' a écrit')
  if (le && ecrit >= le.index + le[0].length) return joined.slice(le.index + le[0].length, ecrit)
  return null
}

export type QuoteAuthor =
  | { kind: 'member'; role: 'maker' | 'builder'; name: string }
  | { kind: 'outsider'; name: string }
  | { kind: 'unknown' }

export function resolveQuoteAuthor(header: string, members: SenderMember[]): QuoteAuthor {
  const parsed = parseQuoteHeader(header)
  const { email, bare } = parsed
  // A header name that is itself address-shaped (a display name set to
  // someone's address) is never kept: no full address goes into a label.
  const name = parsed.name?.includes('@') ? null : parsed.name
  if (email) {
    // A bare address never identifies a member: one the mail program wrote sits
    // in an angle or mailto group, but a loose one may be a display name that an
    // outsider chose to look like a member.
    const member = bare ? null : memberForAddress(email, members)
    // The member's own display name, not the one the header shows.
    if (member) return { kind: 'member', role: member.role, name: member.name }
    // Not a member: the header's name, else the address's local part.
    return { kind: 'outsider', name: name ?? email.split('@')[0] }
  }
  if (name) return { kind: 'outsider', name }
  return { kind: 'unknown' }
}

// A name goes into a label that is part of a prompt, so it must not carry
// quotes, angle brackets or line breaks that could close or fake a block.
// Control characters and line separators become spaces, then " < > go,
// whitespace collapses, and it is cut to 80 characters.
function cleanForLabel(name: string): string {
  // Format characters (bidi overrides, zero-width spaces) go without a trace.
  const spaced = name.replace(/\p{Cf}/gu, '').replace(/[\p{Cc}\p{Zl}\p{Zp}]/gu, ' ')
  const collapsed = spaced.replace(/["<>]/g, '').replace(/\s+/g, ' ').trim()
  return Array.from(collapsed).slice(0, 80).join('').trim()
}

export function senderLabel(role: 'maker' | 'builder', name: string): string {
  return `${role === 'maker' ? 'Maker' : 'Builder'} (${cleanForLabel(name)})`
}

export function authorLabel(author: QuoteAuthor): string {
  if (author.kind === 'member') return senderLabel(author.role, author.name)
  if (author.kind === 'outsider') {
    return `${cleanForLabel(author.name) || 'Someone'}, not a project member`
  }
  return 'unknown author'
}
