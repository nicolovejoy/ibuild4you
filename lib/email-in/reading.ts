import type { ProjectEmail } from '@/lib/types'
import {
  allLines,
  isRepeatOfSignature,
  repeatSignature,
  seenLines,
  splitNewText,
  type QuoteBlock,
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
// author: who wrote the message under it (resolveQuoteAuthor).
// attribution: the author of the attribution above its From: line, who could
//   have written that name; null when there is none (resolveAttributionAuthor).
// nonMember: the one of these who is not a member (an outsider or unknown), the
//   author first; null when there is none.
type HeaderCredit = {
  author: QuoteAuthor
  attribution: QuoteAuthor | null
  nonMember: QuoteAuthor | null
}

function creditHeader(header: string, members: SenderMember[]): HeaderCredit {
  const author = resolveQuoteAuthor(header, members)
  const attribution = resolveAttributionAuthor(header, members)
  let nonMember: QuoteAuthor | null = null
  if (author.kind !== 'member') nonMember = author
  else if (attribution !== null && attribution.kind !== 'member') nonMember = attribution
  return { author, attribution, nonMember }
}

// creditHeader, each distinct header once per email: the same header is a
// possible quoter of every quote after it.
type Resolve = (header: string) => HeaderCredit

// The nearest of `headers` (nearest first) with a non-member in it, as that
// non-member, or null.
function nearestNonMember(headers: string[], resolve: Resolve): QuoteAuthor | null {
  for (const header of headers) {
    const { nonMember } = resolve(header)
    if (nonMember !== null) return nonMember
  }
  return null
}

// A member's label as passed along by a non-member: "Maker (Test M), as quoted
// by Dana Reyes, not a project member".
function asQuotedBy(label: string, passer: QuoteAuthor): string {
  return `${label}, as quoted by ${authorLabel(passer)}`
}

// A quoted message from splitNewText, credited. An inside line was written by
// whoever quoted the block: the email's sender when nothing encloses it, else
// the author of the quote around it.
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
function readQuote(block: QuoteBlock, email: ProjectEmail, resolve: Resolve): ReadingQuote {
  const { author, attribution } = resolve(block.header)
  // Who passed this whole block along. Its own attribution is nearer than any
  // quote around it, but it passed along only the message under the From: line,
  // not the inside lines, which its quoter wrote.
  const outside = nearestNonMember(block.possibleQuoters, resolve)
  const passer = attribution !== null && attribution.kind !== 'member' ? attribution : outside

  let kind = author.kind
  let label = authorLabel(author)
  if (author.kind === 'member' && passer !== null) {
    kind = 'outsider'
    label = asQuotedBy(label, passer)
  }

  // The inside lines' author. A quoter who is a member never counts as their
  // own passer, but the attribution above their From: line does.
  const quoter = block.quoterHeader === null ? null : resolve(block.quoterHeader).author
  let by = quoter === null ? senderLabel(email.from_role, email.from_name) : authorLabel(quoter)
  if ((quoter === null || quoter.kind === 'member') && outside !== null) by = asQuotedBy(by, outside)

  return {
    header: block.header,
    author: kind,
    label,
    lines: block.lines.map((line): ReadingLine => {
      if (line.context) return { text: line.text, kind: 'context', by: null }
      if (line.own) return { text: line.text, kind: 'inside', by }
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
      quotes = split.quotes.map((block) => readQuote(block, email, resolve))
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
