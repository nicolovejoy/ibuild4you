import type { ProjectEmail } from '@/lib/types'
import {
  allLines,
  isRepeatOfSignature,
  repeatSignature,
  seenLines,
  splitNewText,
  type QuoteBlock,
} from './new-text'
import { authorLabel, resolveQuoteAuthor, senderLabel } from './quote-author'
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
  author: 'member' | 'outsider' | 'unknown'
  label: string // authorLabel of the quote's author
  lines: ReadingLine[]
}
export type EmailReading = {
  email: ProjectEmail
  repeat: boolean // the whole email repeats an earlier one from the same sender
  typed: string
  quotes: ReadingQuote[]
}

// A quoted message from splitNewText, credited. An inside line was written by
// whoever quoted the block: the email's sender when nothing encloses it, else
// the author of the quote around it.
function readQuote(block: QuoteBlock, email: ProjectEmail, members: SenderMember[]): ReadingQuote {
  const author = resolveQuoteAuthor(block.header, members)
  const quoter =
    block.quoterHeader === null
      ? senderLabel(email.from_role, email.from_name)
      : authorLabel(resolveQuoteAuthor(block.quoterHeader, members))
  return {
    header: block.header,
    author: author.kind,
    label: authorLabel(author),
    lines: block.lines.map((line): ReadingLine => {
      if (line.context) return { text: line.text, kind: 'context', by: null }
      if (line.own) return { text: line.text, kind: 'inside', by: quoter }
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
      quotes = split.quotes.map((block) => readQuote(block, email, members))
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
