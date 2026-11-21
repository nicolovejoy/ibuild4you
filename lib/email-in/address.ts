import { randomInt } from 'crypto'
import { FEEDBACK_INBOX_HOST } from '@/lib/feedback/inbound'
import { normalizeEmail } from '@/lib/email/normalize'

// Each project gets an address the builder keeps on CC: <slug>-<tail>@<inbox host>.
// The tail makes the address hard to guess; the slug makes it recognisable.

const MAX_SLUG_LENGTH = 40

// No 0/o, 1/l/i look-alikes, so an address read aloud or off a screen survives.
const TAIL_ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789'
const TAIL_LENGTH = 4

// Turn a raw slug into something safe for the local part of an address.
function cleanSlug(slug: string | undefined): string {
  const cleaned = (slug ?? '')
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, MAX_SLUG_LENGTH)
    .replace(/-+$/, '') // the cut can leave a hyphen at the end
  return cleaned || 'project'
}

export function mintEmailInAddress(slug: string | undefined, randomTail: string): string {
  return `${cleanSlug(slug)}-${randomTail}@${FEEDBACK_INBOX_HOST}`
}

export function randomTail(): string {
  let tail = ''
  for (let i = 0; i < TAIL_LENGTH; i++) {
    tail += TAIL_ALPHABET[randomInt(TAIL_ALPHABET.length)]
  }
  return tail
}

// Every distinct project address among the recipients of a message: an address
// at the inbox host that is not a Loop reply address (feedback+<id>@...).
// Takes the shapes Resend sends: a string, a list, or a comma-separated header,
// with or without a "Name <addr>" wrapper.
export function projectAddressesIn(recipients: Array<string | string[] | undefined>): string[] {
  const found = new Set<string>()
  for (const entry of recipients) {
    if (!entry) continue
    const items = Array.isArray(entry) ? entry : [entry]
    for (const item of items) {
      if (typeof item !== 'string') continue
      for (const piece of item.split(',')) {
        const wrapped = piece.match(/<([^>]+)>/)
        const address = normalizeEmail(wrapped ? wrapped[1] : piece)
        const atIdx = address.lastIndexOf('@')
        if (atIdx < 0) continue
        const localpart = address.slice(0, atIdx)
        const host = address.slice(atIdx + 1)
        if (host !== FEEDBACK_INBOX_HOST.toLowerCase()) continue
        if (!localpart || localpart.startsWith('feedback+')) continue
        found.add(address)
      }
    }
  }
  return [...found]
}
