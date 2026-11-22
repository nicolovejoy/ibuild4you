import type { ProjectEmail } from '@/lib/types'
import {
  allLines,
  isRepeatOfSignature,
  repeatSignature,
  seenLines,
  splitNewText,
  type QuoteBlock,
} from './new-text'
import { authorLabel, resolveQuoteAuthor, senderLabel, type QuoteAuthor } from './quote-author'
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

// Resolves a header to its author, each distinct header once per email: the
// same header sits in the chain of every quote nested under it.
type Resolve = (header: string) => QuoteAuthor

// The nearest author in `chain` from `from` on that is not a member (an
// outsider or unknown), or null when they are all members.
function nearestNonMember(chain: QuoteAuthor[], from: number): QuoteAuthor | null {
  for (let i = from; i < chain.length; i++) if (chain[i].kind !== 'member') return chain[i]
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
// A credit is only as good as everyone who passed the text along: anyone a
// member forwards can write "On ..., Test M <tm@yahoo.com> wrote:" into their
// own message. So when a member's quote, or a member's inside lines, reached
// the sender through someone who is not a member (an outsider, or a quoter the
// app could not identify), the credit is unconfirmed: the quote counts as an
// outsider's, and both labels say who passed it along. An author who is
// already an outsider or unknown keeps their plain label.
function readQuote(block: QuoteBlock, email: ProjectEmail, resolve: Resolve): ReadingQuote {
  const author = resolve(block.header)
  const chain = block.quoterChain.map(resolve)

  let kind = author.kind
  let label = authorLabel(author)
  const passer = nearestNonMember(chain, 0)
  if (author.kind === 'member' && passer) {
    kind = 'outsider'
    label = asQuotedBy(label, passer)
  }

  // `by` names the quoter, chain[0]; what passed it along is the chain above it.
  let by: string
  if (chain.length === 0) {
    by = senderLabel(email.from_role, email.from_name)
  } else {
    by = authorLabel(chain[0])
    const above = nearestNonMember(chain, 1)
    if (chain[0].kind === 'member' && above) by = asQuotedBy(by, above)
  }

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
      const authors = new Map<string, QuoteAuthor>()
      const resolve: Resolve = (header) => {
        let author = authors.get(header)
        if (author === undefined) {
          author = resolveQuoteAuthor(header, members)
          authors.set(header, author)
        }
        return author
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
