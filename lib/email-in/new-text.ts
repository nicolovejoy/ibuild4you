// What is new in an email, given the lines the app already holds.
//
// A maker who hits Reply instead of Reply All writes to the builder alone, so
// their words first reach the app quoted inside the builder's next reply. Those
// quoted words must not be lost: a quoted line the app has never seen is
// returned as `quotedUnseen`, apart from what the sender typed. When in doubt a
// line is kept: keeping costs a few tokens, dropping can lose someone's words.
//
// What the sender typed is never dropped line by line: "Yes, go ahead with
// that." typed under a new question is a new answer, even when the same words
// answered an earlier one. Only quoted lines are filtered against the seen
// set. A whole email that repeats an earlier one (isRepeatOf) is left out by
// the note writer instead.
//
// A line written into a quote by the person who quoted it (an inline answer
// under a question) is an `own` line, and like a typed line it is never
// dropped. When a quoted message the app already holds gets such an answer,
// the held lines come back marked `context`, so the answers arrive with their
// questions. Context lines are only in `quotes`, never in `quotedUnseen`.

// Lines shorter than this ("Thanks", "Hi Nico,", "Bill") appear in many emails,
// so they are never evidence that the app has already seen an email.
export const MIN_EVIDENCE_LENGTH = 12

// Strip leading `>` markers and whitespace (repeated, so `> > x` becomes `x`),
// collapse inner whitespace, lowercase.
export function normalizeLine(line: string): string {
  return line
    .replace(/^[\s>]+/, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
}

// The normalized lines, MIN_EVIDENCE_LENGTH or longer, of every text.
export function seenLines(texts: string[]): Set<string> {
  const seen = new Set<string>()
  for (const text of texts) {
    for (const line of splitLines(text)) {
      const normalized = normalizeLine(line)
      if (normalized.length >= MIN_EVIDENCE_LENGTH) seen.add(normalized)
    }
  }
  return seen
}

// Every non-blank normalized line of every text, of any length. A short quoted
// line ("Thanks,", "Green.") is dropped beside a held line only when it is in
// this set (decideFates), so an inline answer the app never saw is kept.
export function allLines(texts: string[]): Set<string> {
  const all = new Set<string>()
  for (const text of texts) {
    for (const line of splitLines(text)) {
      const normalized = normalizeLine(line)
      if (normalized !== '') all.add(normalized)
    }
  }
  return all
}

// One line of a quoted message, `>` markers stripped.
// context: the app already holds this line; it is shown only so the new lines
//   around it make sense. own: written into the quote by the person who quoted
//   it (an inline answer), not by the quote's author. Never both.
export type QuoteLine = { text: string; context: boolean; own: boolean }

// One quoted message: a quote header and the quoted lines placed under it
// (step 3), in their original order. They need not be next to each other: a
// line typed under a nested quote goes back to the outer message.
// header: the header's lines, markers stripped, joined with '\n'; '' for `>`
//   lines that come before any header.
// quoterHeader: the header of the quote this one sits inside (the person who
//   quoted it wrote that message); null when the email's sender quoted it.
export type QuoteBlock = { header: string; quoterHeader: string | null; lines: QuoteLine[] }

type Line = {
  raw: string
  normalized: string
  quoted: boolean
  // How many `>` the line's leading marker run holds: `> > x` is 2.
  depth: number
  // Which quote header this line belongs to, or null when it is not a header
  // line. A header spans several lines (a wrapped "On ... wrote:", a divider
  // with its From/Date block); they all share one id and one fate.
  headerId: number | null
  // For a header line, the kind of header it belongs to.
  headerKind: HeaderKind | null
  // Written into a quote by the person who quoted it (step 3).
  own: boolean
  kept: boolean
  // Dropped as seen, but shown in `quotes` beside new lines of its message (step 6).
  context: boolean
}

// An "On ... wrote:" attribution, or a divider and/or a From:/Sent: field block.
type HeaderKind = 'attribution' | 'fields'

// A quote header and the quoted lines placed under it (step 3). The `>` lines
// before the first header form one block with no header lines, depth 0.
type Block = {
  headerLines: Line[]
  // null for the block of `>` lines before the first header.
  kind: HeaderKind | null
  // The depth of the header's first line.
  depth: number
  // The block this one's header sits inside: the nearest earlier header block
  // at a shallower depth. null when the email's sender quoted it.
  quoter: Block | null
  // Another quote header sits inside this block (deeper, so it is this block's
  // quotee): the mail program marks quotes here.
  hasNestedHeader: boolean
  lines: Line[]
}

// Step 1: `\r\n` is treated as `\n`.
function splitLines(text: string): string[] {
  return text.replace(/\r\n/g, '\n').split('\n')
}

// "On <date>, <name> wrote:". Real attributions carry a date or an address, so
// a typed "On reflection, this is what Danny wrote:" is not one. Missing a
// date-less attribution is the safe direction: its lines stay typed.
function isAttribution(text: string): boolean {
  return /^On .+ wrote:$/.test(text) && /[\d@]/.test(text)
}

const DIVIDERS = [
  /^-{2,}\s*Original Message\s*-{2,}$/i,
  /^-{2,}\s*Forwarded message\s*-{2,}$/i,
  /^Begin forwarded message:$/,
]

const HEADER_FIELD = /^(From|Sent|Date|To|Cc|Subject):/i

// A line without its leading `>` markers and the whitespace after them.
function removeQuoteMarkers(line: string): string {
  return line.replace(/^\s*>[>\s]*/, '')
}

// How many `>` the line's leading marker run (the part removeQuoteMarkers strips) holds.
function quoteDepth(line: string): number {
  const run = /^\s*>[>\s]*/.exec(line)
  return run ? run[0].split('>').length - 1 : 0
}

// How many header-field lines (From:, Sent:, Date:, To:, Cc:, Subject:) run
// directly from `index`. Fields count with their `>` markers stripped, since
// Apple Mail quotes a forward's field block. The run ends at the first other
// line, a blank one included.
function fieldRunLength(lines: string[], index: number): number {
  let end = index
  while (end < lines.length && HEADER_FIELD.test(removeQuoteMarkers(lines[end]).trim())) end++
  return end - index
}

// The quote header starting at `index`: how many lines it spans, and its kind.
// null when there is none. The span is the header line plus the header fields
// directly under it, so a quote we already hold does not leak its
// Sent:/To:/Subject: lines as unseen text.
function quoteHeaderAt(lines: string[], index: number): { span: number; kind: HeaderKind } | null {
  const line = lines[index].trim()

  // "On ... wrote:" is checked with its `>` markers stripped, since Apple Mail
  // quotes the attribution along with the text under it.
  const marked = /^\s*>/.test(lines[index])
  const attribution = removeQuoteMarkers(lines[index]).trim()
  if (isAttribution(attribution)) {
    return { span: 1 + fieldRunLength(lines, index + 1), kind: 'attribution' }
  }
  // "On ... wrote:" wrapped over two lines by the sender's mail client. It never
  // joins a blank line or a line that is a whole attribution itself, and both
  // lines carry a `>` marker or neither does.
  const rawNext = index + 1 < lines.length ? lines[index + 1] : ''
  const next = removeQuoteMarkers(rawNext).trim()
  const nextCanJoin = next !== '' && /^\s*>/.test(rawNext) === marked && !isAttribution(next)
  if (attribution.startsWith('On ') && nextCanJoin && isAttribution(`${attribution} ${next}`)) {
    return { span: 2 + fieldRunLength(lines, index + 2), kind: 'attribution' }
  }

  // A divider, any blank lines directly under it (a bare `>` counts as blank),
  // then its header fields.
  if (DIVIDERS.some((divider) => divider.test(line))) {
    let end = index + 1
    while (end < lines.length && removeQuoteMarkers(lines[end]).trim() === '') end++
    return { span: end - index + fieldRunLength(lines, end), kind: 'fields' }
  }

  // Outlook: "From:" with "Sent:" or "Date:" within the next 4 lines.
  if (line.startsWith('From:')) {
    const following = lines.slice(index + 1, index + 5).map((l) => l.trim())
    if (following.some((l) => l.startsWith('Sent:') || l.startsWith('Date:'))) {
      return { span: 1 + fieldRunLength(lines, index + 1), kind: 'fields' }
    }
  }
  return null
}

// Step 2: mark quote headers and quoted lines. A line is quoted when it starts
// with `>` or comes at or after the first quote header.
function markLines(rawLines: string[]): Line[] {
  const lines: Line[] = rawLines.map((raw) => ({
    raw,
    normalized: normalizeLine(raw),
    quoted: /^\s*>/.test(raw),
    depth: quoteDepth(raw),
    headerId: null,
    headerKind: null,
    own: false,
    kept: true,
    context: false,
  }))

  let headerCount = 0
  let insideQuote = false
  let i = 0
  while (i < lines.length) {
    const header = quoteHeaderAt(rawLines, i)
    if (header) {
      const span = header.span
      for (let j = i; j < i + span; j++) {
        lines[j].headerId = headerCount
        lines[j].headerKind = header.kind
        lines[j].quoted = true
      }
      headerCount++
      insideQuote = true
      i += span
      continue
    }
    if (insideQuote) lines[i].quoted = true
    i++
  }
  return lines
}

// Step 3: place every quoted line in a block, then mark the own lines in each.
// Typed lines (unmarked, before the first header) are in no block, and the `>`
// lines before the first header form the header-less block.
//
// The open header blocks are kept on a stack, shallowest at the bottom. A
// header at depth d closes every open block at depth d or deeper, then opens
// its own, so depths strictly increase up the stack and the block left below
// it is its quoter. A quoted line at depth k goes to the deepest open block no
// deeper than k, or to the shallowest one when all are deeper (an unmarked
// line under an Apple Mail quote whose header is at depth 1). Lines never close
// a block, so a line typed under a nested quote goes back to the outer message.
function findBlocks(lines: Line[]): Block[] {
  const blocks: Block[] = []
  const open: Block[] = []
  let headerless: Block | null = null
  let currentHeaderId: number | null = null
  for (const line of lines) {
    if (line.headerId !== null) {
      // The first line of a new header opens a new block; the rest of its span joins it.
      if (line.headerId !== currentHeaderId) {
        currentHeaderId = line.headerId
        while (open.length > 0 && open[open.length - 1].depth >= line.depth) open.pop()
        const quoter = open.length > 0 ? open[open.length - 1] : null
        // The quoter is shallower than this header, so the header is nested in it.
        if (quoter) quoter.hasNestedHeader = true
        const block: Block = {
          headerLines: [],
          kind: line.headerKind,
          depth: line.depth,
          quoter,
          hasNestedHeader: false,
          lines: [],
        }
        open.push(block)
        blocks.push(block)
      }
      open[open.length - 1].headerLines.push(line)
    } else if (line.quoted) {
      if (open.length > 0) {
        openBlockFor(open, line.depth).lines.push(line)
      } else {
        // `>` lines before the first header.
        if (headerless === null) {
          headerless = { headerLines: [], kind: null, depth: 0, quoter: null, hasNestedHeader: false, lines: [] }
          blocks.push(headerless)
        }
        headerless.lines.push(line)
      }
    }
  }
  return blocks
}

// The deepest open block no deeper than `depth`, else the shallowest. The scan
// is short: a stack of h blocks needs headers at depths 0 to h - 1, so even a
// 50,000-character email holds no more than about 300.
function openBlockFor(open: Block[], depth: number): Block {
  for (let i = open.length - 1; i >= 0; i--) {
    if (open[i].depth <= depth) return open[i]
  }
  return open[0]
}

// A non-blank line is own when its block has an "On ... wrote:" header, the
// line sits at the header's depth or shallower, and the block has something
// deeper than the header: a non-blank line, or another quote header nested in
// it. Either shows the mail program marks quotes. Gmail and Apple Mail put the
// quoted text one level deeper than its attribution, so a line at the
// attribution's level was written by the quoter. A block with nothing deeper
// (Outlook, or a mail program that does not mark quotes), a forward or Outlook
// block (its body is the forwarded message, quotes inside it included) and the
// header-less block have no own lines: the quoter's lines cannot be told apart
// there. Own is a best reading, not a certainty: a quoted line that a mail
// program re-wrapped without its `>` reads as own.
function markOwnLines(blocks: Block[]): void {
  for (const block of blocks) {
    if (block.kind !== 'attribution') continue
    const hasDeeper =
      block.hasNestedHeader ||
      block.lines.some((line) => line.normalized !== '' && line.depth > block.depth)
    if (!hasDeeper) continue
    for (const line of block.lines) {
      if (line.normalized !== '' && line.depth <= block.depth) line.own = true
    }
  }
}

function isLong(line: Line): boolean {
  return line.normalized.length >= MIN_EVIDENCE_LENGTH
}

// A line that can show the app has seen an email: long, not a header line, and
// not an own line (the quoter's new words, never dropped).
function isEvidence(line: Line): boolean {
  return line.headerId === null && !line.own && isLong(line)
}

// Step 4: a typed line is always kept, and so is an own line. A long quoted
// line is dropped when the app has seen it. A short quoted line takes the fate
// of the nearest long line of its block, looking before it first and then
// after it. Header lines and own lines are never that neighbour (step 5
// decides headers), and the search stays in the line's block, so a greeting
// under one header never follows a line quoted under another. With no such
// neighbour, a short line is kept.
//
// When `seenAny` is given, a short non-blank line whose neighbour was dropped
// is dropped only if the app has seen it too: a "Green." answered inline beside
// a held question is new words. A blank line follows its neighbour regardless.
function decideFates(blocks: Block[], seen: Set<string>, seenAny?: Set<string>): void {
  for (const block of blocks) {
    const lines = block.lines
    for (const line of lines) {
      if (isEvidence(line)) line.kept = !seen.has(line.normalized)
    }

    // The nearest evidence line before each line, then after it, in one pass each.
    const before: (Line | null)[] = []
    let last: Line | null = null
    for (const line of lines) {
      before.push(last)
      if (isEvidence(line)) last = line
    }
    const after: (Line | null)[] = new Array(lines.length).fill(null)
    let next: Line | null = null
    for (let i = lines.length - 1; i >= 0; i--) {
      after[i] = next
      if (isEvidence(lines[i])) next = lines[i]
    }

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]
      if (line.own || isLong(line)) continue
      const neighbour = before[i] ?? after[i]
      if (!neighbour || neighbour.kept) line.kept = true
      else if (seenAny && line.normalized !== '') line.kept = !seenAny.has(line.normalized)
      else line.kept = false
    }
  }
}

// Step 5: a quote header is kept only when its block has a kept, non-blank
// line. Every line of a header's span shares that fate.
function decideHeaders(blocks: Block[]): void {
  for (const block of blocks) {
    const hasKept = block.lines.some((line) => line.kept && line.normalized !== '')
    for (const line of block.headerLines) line.kept = hasKept
  }
}

function headerText(block: Block): string {
  return block.headerLines.map((line) => removeQuoteMarkers(line.raw)).join('\n')
}

// Step 6: the quoted messages with something new in them, as `quotes`.
//
// A block with no kept non-blank line stays out: it is an older level of the
// thread that the app already holds. A block that has new lines and dropped
// lines brings every dropped line back as context, so an inline answer arrives
// with the question it answers. Every drop is a drop as seen (step 4), so a
// listed block shows all its lines. Its quoter was found in step 3.
function collectQuotes(blocks: Block[]): QuoteBlock[] {
  const quotes: QuoteBlock[] = []
  for (const block of blocks) {
    if (!block.lines.some((line) => line.kept && line.normalized !== '')) continue
    for (const line of block.lines) line.context = !line.kept && line.normalized !== ''
    quotes.push({
      header: headerText(block),
      quoterHeader: block.quoter ? headerText(block.quoter) : null,
      lines: trimBlankRuns(block.lines.map(toQuoteLine)),
    })
  }
  return quotes
}

function toQuoteLine(line: Line): QuoteLine {
  if (line.normalized === '') return { text: '', context: false, own: false }
  return { text: removeQuoteMarkers(line.raw), context: line.context, own: line.own }
}

// Runs of blank quote lines collapsed to one, and none at either end (as joinLines does).
function trimBlankRuns(lines: QuoteLine[]): QuoteLine[] {
  const out: QuoteLine[] = []
  for (const line of lines) {
    const blank = line.text === ''
    if (blank && (out.length === 0 || out[out.length - 1].text === '')) continue
    out.push(line)
  }
  if (out.length > 0 && out[out.length - 1].text === '') out.pop()
  return out
}

// Step 7: join lines, collapsing runs of blank lines to one and trimming the ends.
function joinLines(lines: string[]): string {
  const out: string[] = []
  for (const line of lines) {
    const blank = line.trim() === ''
    if (blank && out.length > 0 && out[out.length - 1].trim() === '') continue
    out.push(line)
  }
  return out.join('\n').trim()
}

// `seen` holds the long lines the app already has (seenLines); `seenAny`, when
// given, every line of any length (allLines), so a short quoted line is dropped
// beside a held line only when the app has seen it too (step 4).
export function splitNewText(
  text: string,
  seen: Set<string>,
  seenAny?: Set<string>
): { typed: string; quotedUnseen: string; quotes: QuoteBlock[] } {
  const lines = markLines(splitLines(text))
  const blocks = findBlocks(lines)
  markOwnLines(blocks)
  decideFates(blocks, seen, seenAny)
  decideHeaders(blocks)
  const quotes = collectQuotes(blocks)

  // Context lines are not kept, so they stay out of `typed` and `quotedUnseen`.
  const kept = lines.filter((line) => line.kept)
  return {
    typed: joinLines(kept.filter((line) => !line.quoted).map((line) => line.raw)),
    quotedUnseen: joinLines(
      kept.filter((line) => line.quoted).map((line) => removeQuoteMarkers(line.raw))
    ),
    quotes,
  }
}

// A text's non-blank, non-header lines, normalized, typed and quoted apart,
// and whether any of them is long enough to be evidence.
function contentLines(text: string): { typed: Set<string>; quoted: Set<string>; hasEvidence: boolean } {
  const typed = new Set<string>()
  const quoted = new Set<string>()
  let hasEvidence = false
  for (const line of markLines(splitLines(text))) {
    if (line.headerId !== null || line.normalized === '') continue
    if (line.quoted) quoted.add(line.normalized)
    else typed.add(line.normalized)
    if (isLong(line)) hasEvidence = true
  }
  return { typed, quoted, hasEvidence }
}

// True when `text` holds nothing that `earlierText` did not: every line it
// typed, of any length, was typed in the earlier email, and every line it
// quoted was quoted there. Blank and header lines do not count. A short line
// is never evidence that the email was seen ("Yes" is in many emails), so a
// text with no long line is never a repeat; but a new short line ("Actually
// no") is new words, so it always stops a repeat. The note writer asks this
// only of an earlier email from the same sender.
export function isRepeatOf(text: string, earlierText: string): boolean {
  const now = contentLines(text)
  if (!now.hasEvidence) return false
  const earlier = contentLines(earlierText)
  for (const line of now.typed) if (!earlier.typed.has(line)) return false
  for (const line of now.quoted) if (!earlier.quoted.has(line)) return false
  return true
}
