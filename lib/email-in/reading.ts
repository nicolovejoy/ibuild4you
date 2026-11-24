import type { ProjectEmail } from '@/lib/types'
import {
  allLines,
  isRepeatOfSignature,
  repeatSignature,
  seenLines,
  splitNewText,
  type QuoteBlock,
  type QuoteLine,
} from './new-text'
import {
  authorLabel,
  resolveAttributionAuthor,
  resolveQuoteAuthor,
  senderLabel,
  type QuoteAuthor,
} from './quote-author'
import type { SenderMember } from './sender'

// One reading of each project email: what its sender typed, and each quoted
// message with something new in it, credited by code to its author. The note
// writer is given this reading and the builder's panel shows the same one, so
// what the builder sees is exactly what the writer read.

// kind 'new': not seen before. 'context': already held, shown for sense only.
// 'inside': written into the quote by `by` (a label), an inline answer.
export type ReadingLine = { text: string; kind: 'new' | 'context' | 'inside'; by: string | null }
export type ReadingQuote = {
  // The quote's header lines as they are in the stored text, passed through
  // unchanged ('' for `>` lines with no header). The one field that may hold a
  // non-member's address.
  header: string
  // 'outsider' too for a member's quote passed along by a non-member (readQuote).
  author: 'member' | 'outsider' | 'unknown'
  // authorLabel of the quote's author, with ", as quoted by …" when a
  // non-member passed a member's quote along.
  label: string
  lines: ReadingLine[]
}
export type EmailReading = {
  email: ProjectEmail
  repeat: boolean // the whole email repeats an earlier one from the same sender
  typed: string
  quotes: ReadingQuote[]
}

// What a quote header says about who a credit depends on.
// author: who wrote the message under it (resolveQuoteAuthor), and their label.
// attribution: the label of the attribution's author above its From: line, who
//   could have written that name, when they are not a member; else null
//   (resolveAttributionAuthor).
// nonMember: the label of the one of these who is not a member (an outsider or
//   unknown), the author first; null when there is none.
type HeaderCredit = {
  author: QuoteAuthor['kind']
  label: string
  attribution: string | null
  nonMember: string | null
}

function creditHeader(header: string, members: SenderMember[]): HeaderCredit {
  const author = resolveQuoteAuthor(header, members)
  const label = authorLabel(author)
  const above = resolveAttributionAuthor(header, members)
  const attribution = above !== null && above.kind !== 'member' ? authorLabel(above) : null
  return { author: author.kind, label, attribution, nonMember: author.kind !== 'member' ? label : attribution }
}

// creditHeader, each distinct header once per email: the same header is a
// possible quoter of every quote after it.
type Resolve = (header: string) => HeaderCredit

// The label of the nearest non-member among the last `count` of `headers`
// (nearest first), or null.
function nearestNonMember(headers: string[], count: number, resolve: Resolve): string | null {
  for (let i = headers.length - count; i < headers.length; i++) {
    const { nonMember } = resolve(headers[i])
    if (nonMember !== null) return nonMember
  }
  return null
}

// A member's label as passed along by a non-member, if any: "Maker (Test M), as
// quoted by Dana Reyes, not a project member".
function passedAlong(label: string, passer: string | null): string {
  return passer === null ? label : `${label}, as quoted by ${passer}`
}

// A quoted message from splitNewText, credited. An inside line was written by
// its quoter, the block's unless the line names another: the email's sender, or
// the author of a quote around it.
//
// A credit is only as good as everyone who could have written the header it
// rests on: anyone a member forwards can write "On ..., Test M <tm@yahoo.com>
// wrote:" into their own message, or open it with "From: Test M
// <tm@yahoo.com>", which then sits directly under their attribution. So when a
// member's quote, or a member's inside lines, could have reached the sender
// through someone who is not a member (an outsider, or a quoter the app could
// not identify), the credit is unconfirmed: the quote counts as an outsider's,
// and both labels say who passed it along. Not being sure of a genuine author
// costs little; a forged member credit becomes a decision. An author who is
// already an outsider or unknown keeps their plain label.
function readQuote(block: QuoteBlock, sender: string, resolve: Resolve): ReadingQuote {
  const { author, label, attribution } = resolve(block.header)
  // The nearest non-member around the block, by how many of its possible
  // quoters count (QuoteLine.possible). Few numbers, each looked up once.
  const outsides = new Map<number, string | null>()
  const outsideOf = (count: number): string | null => {
    let outside = outsides.get(count)
    if (outside === undefined) {
      outside = nearestNonMember(block.possibleQuoters, count, resolve)
      outsides.set(count, outside)
    }
    return outside
  }

  // Who passed this whole block along. Its own attribution is nearer than any
  // quote around it, but it passed along only the message under the From: line,
  // not the inside lines, which a quoter wrote.
  const everyone = block.possibleQuoters.length
  const passer = author === 'member' ? (attribution ?? outsideOf(everyone)) : null

  // A quoter who is a member never counts as their own passer, but the
  // attribution above their From: line does.
  const insideBy = (line: QuoteLine): string => {
    const outside = outsideOf(line.possible ?? everyone)
    const quoterHeader = line.quoter === undefined ? block.quoterHeader : line.quoter
    if (quoterHeader === null) return passedAlong(sender, outside)
    const quoter = resolve(quoterHeader)
    return passedAlong(quoter.label, quoter.author === 'member' ? outside : null)
  }

  return {
    header: block.header,
    author: passer === null ? author : 'outsider',
    label: passedAlong(label, passer),
    lines: block.lines.map((line): ReadingLine => {
      if (line.context) return { text: line.text, kind: 'context', by: null }
      if (line.own) return { text: line.text, kind: 'inside', by: insideBy(line) }
      return { text: line.text, kind: 'new', by: null }
    }),
  }
}

// One reading per email, same order. `emails` is every email of the project,
// oldest first.
//
// Each email's seen sets are the stored text of every email on the project
// before it, so a line someone quoted again is dropped and a quote of mail the
// app never received is kept. What the sender typed is always kept, unless the
// whole email repeats an earlier one from the same sender (sent twice, say):
// then it has no text left and is covered without being shown, like an email
// whose every line was already seen.
export function readProjectEmails(emails: ProjectEmail[], members: SenderMember[]): EmailReading[] {
  const seen = new Set<string>()
  const seenAny = new Set<string>()
  // One repeat signature per email, made once: each email is compared with
  // every earlier one from its sender, and parsing a text per comparison made
  // many long emails take seconds.
  const signatures = emails.map((email) => repeatSignature(email.text ?? ''))
  return emails.map((email, i) => {
    const text = email.text ?? ''
    let repeat = false
    for (let j = 0; j < i && !repeat; j++) {
      repeat = emails[j].from_email === email.from_email && isRepeatOfSignature(signatures[i], signatures[j])
    }
    let typed = ''
    let quotes: ReadingQuote[] = []
    if (!repeat) {
      const split = splitNewText(text, seen, seenAny)
      typed = split.typed
      const credits = new Map<string, HeaderCredit>()
      const resolve: Resolve = (header) => {
        let credit = credits.get(header)
        if (credit === undefined) {
          credit = creditHeader(header, members)
          credits.set(header, credit)
        }
        return credit
      }
      const sender = senderLabel(email.from_role, email.from_name)
      quotes = split.quotes.map((block) => readQuote(block, sender, resolve))
    }
    // Added after the split: an email is never evidence against itself.
    for (const line of seenLines([text])) seen.add(line)
    for (const line of allLines([text])) seenAny.add(line)
    return { email, repeat, typed, quotes }
  })
}

// typed.length plus the length of every quote line's text.
export function readingSize(reading: { typed: string; quotes: ReadingQuote[] }): number {
  let size = reading.typed.length
  for (const quote of reading.quotes) {
    for (const line of quote.lines) size += line.text.length
  }
  return size
}

// The start of what the sender typed, on one line, for the panel's list: enough
// to tell one email from another without opening it. '' when nothing typed was
// kept (a repeat, or an email that is all quote).
export const EMAIL_PREVIEW_MAX = 200

export function emailPreview(typed: string): string {
  const oneLine = typed.replace(/\s+/g, ' ').trim()
  if (oneLine.length <= EMAIL_PREVIEW_MAX) return oneLine
  return `${oneLine.slice(0, EMAIL_PREVIEW_MAX).trimEnd()}…`
}
