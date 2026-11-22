import { isValidEmail, normalizeEmail } from '@/lib/email/normalize'
import { memberForAddress, type SenderMember } from './sender'

// Who wrote a quoted block inside an email. Code decides this, never the model:
// the address in the quote header is matched to the project's members, and a
// name in the header is never what identifies a member (anyone can set their
// display name to "Nico").
//
// `header` is the quote header as new-text.ts finds it: `>` markers already
// stripped, lines joined with "\n". It is either an attribution ("On ... wrote:",
// possibly wrapped over two lines) or a divider and/or a field block (From:,
// Sent: or Date:, To:, Subject:). '' means the quote has no header.

export type HeaderAuthor = { name: string | null; email: string | null }

// A quote header is a few lines. Cutting here keeps every pattern below cheap
// whatever the sender put in the email.
const MAX_HEADER_LENGTH = 2000

// An address-shaped token: starts with a letter or digit, so a quote mark
// before it is left out, and ends at the domain's last label, so a full stop
// after it is left out. Callers pick the first or the last match.
const ADDRESS = /[A-Za-z0-9][A-Za-z0-9._%+'-]*@[A-Za-z0-9.-]+\.[A-Za-z0-9-]+/g
const FROM_LINE = /^\s*From:(.*)$/im
// What leads into an address after the name: "Name <", "Name [mailto:".
const ADDRESS_OPENER = /[\s<[(]*(?:mailto:)?\s*$/i
// Pieces between an attribution's date and its name.
const AM_PM = /^[\s,]*(?:AM|PM)\b/
const TIME_ZONE = /^[\s,]*[A-Z]{2,5}\b/

// The first or last address-shaped token that is a valid address, normalized,
// with where it sat in the text.
function findAddress(
  text: string,
  which: 'first' | 'last'
): { email: string; index: number } | null {
  const matches = Array.from(text.matchAll(ADDRESS))
  const match = which === 'first' ? matches[0] : matches[matches.length - 1]
  if (!match || !isValidEmail(match[0])) return null
  return { email: normalizeEmail(match[0]), index: match.index }
}

// Surrounding double quotes and spaces off; an empty name is null.
function cleanName(raw: string): string | null {
  const name = raw
    .trim()
    .replace(/^"+|"+$/g, '')
    .trim()
  return name || null
}

// The name in a From: value is the text before the address, minus the opener
// that led into it.
function fromName(value: string, addressIndex: number | null): string | null {
  const before = addressIndex === null ? value : value.slice(0, addressIndex)
  return cleanName(before.replace(ADDRESS_OPENER, ''))
}

// "On <date>, <name> <addr> wrote:" read from the text between On and wrote:.
// The name is what comes after the date: drop everything up to and including
// the last token that holds a digit (a date or a time), then an AM or PM and
// a time zone such as PST, with the commas and spaces around them.
function attributionName(inner: string, addressIndex: number | null): string | null {
  const before = addressIndex === null ? inner : inner.slice(0, addressIndex)
  const tokens = before.replace(ADDRESS_OPENER, '').split(/\s+/)
  let lastDigit = -1
  tokens.forEach((token, i) => {
    if (/\d/.test(token)) lastDigit = i
  })
  const afterDate = tokens.slice(lastDigit + 1).join(' ')
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
    const found = findAddress(value, 'first')
    return { name: fromName(value, found?.index ?? null), email: found?.email ?? null }
  }

  // Otherwise "On ... wrote:", which a mail client may have wrapped over two
  // lines. Its address is the last one before "wrote:", where clients put it.
  const joined = text.split('\n').join(' ')
  const on = /\bOn\s/.exec(joined)
  const end = joined.lastIndexOf('wrote:')
  if (on && end > on.index) {
    const inner = joined.slice(on.index + on[0].length, end)
    const found = findAddress(inner, 'last')
    return { name: attributionName(inner, found?.index ?? null), email: found?.email ?? null }
  }

  return { name: null, email: null }
}

export type QuoteAuthor =
  | { kind: 'member'; role: 'maker' | 'builder'; name: string }
  | { kind: 'outsider'; name: string }
  | { kind: 'unknown' }

export function resolveQuoteAuthor(header: string, members: SenderMember[]): QuoteAuthor {
  const { name, email } = parseQuoteHeader(header)
  if (email) {
    const member = memberForAddress(email, members)
    // The member's own display name, not the one the header shows.
    if (member) return { kind: 'member', role: member.role, name: member.name }
    // Not a member: the header's name, else the address's local part. The
    // address itself never goes into a label.
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
  const spaced = name.replace(/[\p{Cc}\p{Zl}\p{Zp}]/gu, ' ')
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
