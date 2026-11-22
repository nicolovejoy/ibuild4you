import { isValidEmail, normalizeEmail } from '@/lib/email/normalize'
import {
  ENGLISH_ATTRIBUTION,
  endsAttribution,
  FRENCH_ATTRIBUTION,
  HEADER_FIELD,
  isAttribution,
  plainFieldLabel,
  startsAttribution,
} from './new-text'
import { memberForAddress, type SenderMember } from './sender'

// Who wrote a quoted block inside an email. Code decides this, never the model:
// the address in the quote header is matched to the project's members, and a
// name in the header is never what identifies a member (anyone can set their
// display name to "Nico").
//
// `header` is the quote header as new-text.ts finds it: `>` markers already
// stripped, lines joined with "\n". It is either an attribution ("On ... wrote:"
// or the French "Le ... a écrit :", possibly wrapped over two lines, and with
// any field lines directly under it) or a divider and/or a field block (From:,
// Sent: or Date:, To:, Subject:). '' means the quote has no header, or a quoter
// the app could not identify.

// `bare` is true when the address does not prove who the author is: a loose
// token in the text, not one the mail program put in an angle group or a mailto
// form, or one in a From: line that cannot be relied on (parseFrom). false when
// there is no address.
export type HeaderAuthor = { name: string | null; email: string | null; bare: boolean }

// The longest From: line or attribution that is read, so every pattern below
// stays cheap whatever the sender put in the email. A longer one names nobody:
// it is never cut, since a cut could change which address is last.
const MAX_HEADER_LENGTH = 2000

// An address-shaped token: starts with a letter or digit, so a quote mark
// before it is left out, and ends at the domain's last label, so a full stop
// after it is left out.
const ADDRESS = /[A-Za-z0-9][A-Za-z0-9._%+'-]*@[A-Za-z0-9.-]+\.[A-Za-z0-9-]+/g
const WHOLE_ADDRESS = new RegExp(`^${ADDRESS.source}$`)
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

// The text as an address, normalized, when it is one valid address from end to
// end. An address inside a longer one proves nothing: in
// "tm@yahoo.com"@evil.com the mailbox is at evil.com.
function wholeAddress(text: string): string | null {
  return WHOLE_ADDRESS.test(text) && isValidEmail(text) ? normalizeEmail(text) : null
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
// inside one proves nothing. The real address is the LAST angle group or
// [mailto:] form: the whole of it, with nothing but closing brackets after it
// (an address such as <"<tm@yahoo.com>"@evil.com> holds a group of its own). If
// that is not one valid address there is none, and no other token is tried.
// Only when the text has no group at all is a bare address taken, and then only
// if it is the one address-shaped token in it.
function headerAddress(text: string): { email: string | null; bare: boolean } {
  const groups = [...text.matchAll(ANGLE_GROUP), ...text.matchAll(MAILTO_GROUP)]
  if (groups.length > 0) {
    groups.sort((a, b) => a.index - b.index)
    const last = groups[groups.length - 1]
    const after = text.slice(last.index + last[0].length)
    const address = last[1].trim().replace(/^mailto:/i, '').trim()
    return { email: /^[\s>\])]*$/.test(after) ? wholeAddress(address) : null, bare: false }
  }
  const tokens = text.match(ADDRESS)
  const email = tokens?.length === 1 ? wholeAddress(tokens[0]) : null
  return { email, bare: email !== null }
}

// Whether a From: value's groups hold more than one address. A link repeats its
// own address (<a@b.c<mailto:a@b.c>>), which counts as one.
function hasSeveralAddresses(text: string): boolean {
  const group = GROUP_START.exec(text)
  if (!group) return false
  const addresses = text.slice(group.index).match(ADDRESS) ?? []
  return new Set(addresses.map(normalizeEmail)).size > 1
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

const NOBODY: HeaderAuthor = { name: null, email: null, bare: false }

// The two parts of a header that can name someone, each null when the header
// does not have it: its attribution, the lines before the first field line, and
// its first From: line. The other field lines are never read: To: and Cc: name
// recipients, and a Subject: can hold any text. Lines end at "\n" only, as in
// new-text.ts.
function headerParts(header: string): { attribution: HeaderAuthor | null; from: HeaderAuthor | null } {
  const lines = header.split('\n').map((line) => plainFieldLabel(line.trim()))
  const firstField = lines.findIndex((line) => HEADER_FIELD.test(line))
  const fieldsAt = firstField < 0 ? lines.length : firstField
  const fromAt = lines.findIndex((line) => /^From:/i.test(line))
  return {
    attribution: startsAttribution(lines[0])
      ? parseAttribution(lines.slice(0, fieldsAt), lines[fieldsAt] ?? '')
      : null,
    from: fromAt < 0 ? null : parseFrom(lines[fromAt], lines[fromAt + 1] ?? ''),
  }
}

// Whoever a From: line names. Its address proves nothing (it is as good as a
// bare one) when the line may have been wrapped and lost its end, which is
// when the line under it is not a field, or is another From:; when it was sent on behalf of someone,
// whose display name then comes last; and when it holds several addresses.
function parseFrom(line: string, next: string): HeaderAuthor {
  if (line.length > MAX_HEADER_LENGTH) return NOBODY
  const value = line.slice('From:'.length).trim()
  const { email, bare } = headerAddress(value)
  const unproven =
    !HEADER_FIELD.test(next) ||
    /^From:/i.test(next) ||
    /\bon\s+behalf\s+of\b/i.test(value) ||
    hasSeveralAddresses(value)
  return {
    name: cleanName(stripOpener(beforeAddress(value))),
    email,
    bare: bare || (email !== null && unproven),
  }
}

// Whoever "On ... wrote:" or its French form "Le ... a écrit :" names, from its
// lines and the field line under them. Its address is read from the text
// between On and wrote: (or Le and a écrit).
//
// Nobody, when a line that ends like an attribution follows a whole one. It may
// be the end of a wrapped display name, so the address above it is not the
// author's; or the quoted message's own first line, so neither is its own.
function parseAttribution(lines: string[], fieldLine: string): HeaderAuthor {
  const joined = lines.join(' ')
  if (joined.length > MAX_HEADER_LENGTH) return NOBODY
  if (isAttribution(lines.slice(0, -1).join(' ')) || endsAttribution(fieldLine)) return NOBODY
  const inner = attributionInner(joined)
  return inner === null ? NOBODY : { name: attributionName(inner), ...headerAddress(inner) }
}

// A From: line wins over an attribution above it.
export function parseQuoteHeader(header: string): HeaderAuthor {
  const { attribution, from } = headerParts(header)
  return from ?? attribution ?? NOBODY
}

// The text between an attribution's opening word and its closing words, or
// null when it is not an attribution from end to end. A display name can hold
// an attribution of its own, in either language ("Le ..., On <a@b.c> wrote:
// <d@e.f> a écrit :"), so only the outermost opening and closing words count.
function attributionInner(joined: string): string | null {
  if (FRENCH_ATTRIBUTION.test(joined)) return joined.slice('Le '.length, joined.lastIndexOf(' a écrit'))
  if (ENGLISH_ATTRIBUTION.test(joined)) return joined.slice('On '.length, joined.lastIndexOf(' wrote:'))
  return null
}

export type QuoteAuthor =
  | { kind: 'member'; role: 'maker' | 'builder'; name: string }
  | { kind: 'outsider'; name: string }
  | { kind: 'unknown' }

export function resolveQuoteAuthor(header: string, members: SenderMember[]): QuoteAuthor {
  return resolveParsed(parseQuoteHeader(header), members)
}

// The author of the attribution above a header's From: line, or null when the
// header does not have both. The From: line names the header's author
// (resolveQuoteAuthor), but the fields directly under an attribution may be the
// first lines of the attributed message, so its author could have written that
// name. Unknown when the attribution cannot be read.
export function resolveAttributionAuthor(header: string, members: SenderMember[]): QuoteAuthor | null {
  const { attribution, from } = headerParts(header)
  return attribution !== null && from !== null ? resolveParsed(attribution, members) : null
}

function resolveParsed(parsed: HeaderAuthor, members: SenderMember[]): QuoteAuthor {
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
