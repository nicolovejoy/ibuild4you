// What is new in an email, given the lines the app already holds.
//
// A maker who hits Reply instead of Reply All writes to the builder alone, so
// their words first reach the app quoted inside the builder's next reply. Those
// quoted words must not be lost: a quoted line the app has never seen is kept,
// apart from what the sender typed. When in doubt a line is kept: keeping costs
// a few tokens, dropping can lose someone's words.
//
// splitNewText returns `typed` and `quotes`, which the note writer and the
// builder's panel read (through lib/email-in/reading.ts): one block per quoted
// message with something new in it, each line marked new, context or own. It
// also returns `quotedUnseen`, the flat view of the same kept quoted lines and
// their headers, kept for the tests that pin which lines survive.
//
// What the sender typed is never dropped line by line: "Yes, go ahead with
// that." typed under a new question is a new answer, even when the same words
// answered an earlier one. Only quoted lines are filtered against the seen
// set. A whole email that repeats an earlier one (isRepeatOf) is left out by
// the note writer instead.
//
// A line written into a quote by the person who quoted it (an inline answer
// under a question) is an `own` line. When the email's sender wrote it, it is
// their words in this email and, like a typed line, it is never dropped. When
// someone further up the thread wrote it, the app may hold it or not: the
// answer may have gone to the email's sender alone. Its words prove nothing,
// since "Yes." or "Sounds good to me, thanks." answers many questions. So it is
// dropped only when the app has seen it in its place, right after the same
// held line: then an answer the app holds does not come back as new words in
// every later reply. When a quoted message the app already holds gets a new
// answer, the held lines come back marked `context`, so the answer arrives with
// its question. Context lines are only in `quotes`, never in `quotedUnseen`.

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

// Every non-blank normalized line of every text, of any length, and every pair
// of consecutive ones in a text (linePair). A short quoted line ("Thanks,",
// "Green.") is dropped beside a held line only when it is in this set, and an
// inline answer from further up the thread only when its pair with the line
// before it is (decideFates), so an answer the app never saw is kept.
export function allLines(texts: string[]): Set<string> {
  const all = new Set<string>()
  for (const text of texts) {
    let previous: string | null = null
    for (const line of splitLines(text)) {
      const normalized = normalizeLine(line)
      if (normalized === '') continue
      all.add(normalized)
      if (previous !== null) all.add(linePair(previous, normalized))
      previous = normalized
    }
  }
  return all
}

// Two consecutive normalized lines as one entry of allLines. A normalized line
// never holds a newline, so a pair is never mistaken for a line.
function linePair(previous: string, line: string): string {
  return `${previous}\n${line}`
}

// One line of a quoted message, `>` markers stripped.
// context: the app already holds this line; it is shown only so the new lines
//   around it make sense. own: written into the quote by the person who quoted
//   it (an inline answer), not by the quote's author. Never both.
export type QuoteLine = { text: string; context: boolean; own: boolean }

// One quoted message: a quote header and the quoted lines placed under it by
// depth (step 3), in their original order. They need not be next to each
// other: a line typed under a nested quote goes back to the outer message.
// header: the header's lines, markers stripped, joined with '\n'; '' for `>`
//   lines that come before any header.
// quoterHeader: who quoted this message (and so wrote its own lines), the best
//   reading of the email's structure. null: the email's sender. '': someone the
//   app could not identify (the header sits inside `>` text whose header was
//   not recognised, step 3). Otherwise the header of the quote this one sits
//   inside: its author wrote that message.
// possibleQuoters: the header of every earlier message that could enclose this
//   one, nearest first, whatever shape the mail program gave it; '' comes last
//   when a message whose header was not recognised could. Anyone in it could have written this
//   header themselves, so a credit is only as good as everyone in it
//   (lib/email-in/reading.ts). It holds quoterHeader, unless that is null, and
//   every quoter around it.
export type QuoteBlock = {
  header: string
  quoterHeader: string | null
  possibleQuoters: string[]
  lines: QuoteLine[]
}

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

// An "On ... wrote:" attribution (English or French, see isAttribution), or a
// divider and/or a From:/Sent: field block.
type HeaderKind = 'attribution' | 'fields'

// A quote header and the quoted lines placed under it (step 3). The `>` lines
// before the first header form one block with no header lines.
type Block = {
  headerLines: Line[]
  // null for a block with no header.
  kind: HeaderKind | null
  // The depth of the header's first line. For the block of `>` lines before the
  // first header, the shallowest depth of a non-blank line in it (at least 1).
  // For an unknown quoter's empty block (step 3), the depth it was found at.
  depth: number
  // The depth the quoted message's own text sits at (step 3). A line one level
  // shallower was written by the quoter.
  bodyDepth: number
  // The block whose body this one's header sits in; null when the email's
  // sender quoted it. A block with no header lines, so with the header text '',
  // when the quoter is unknown (step 3).
  quoter: Block | null
  // The nearest earlier block that could enclose this one (step 3). Followed
  // from block to block, it gives possibleQuoters.
  possibleQuoter: Block | null
  lines: Line[]
}

// Step 1: `\r\n` is treated as `\n`.
function splitLines(text: string): string[] {
  return text.replace(/\r\n/g, '\n').split('\n')
}

// "On <date>, <name> wrote:", or its French form "Le <date>, <name> a écrit :"
// (the space before the colon may be a no-break space, or missing). Real
// attributions carry a date or an address, so a typed "On reflection, this is
// what Danny wrote:" is not one. Missing a date-less attribution is the safe
// direction: its lines stay typed. No other language is recognised. Both
// patterns are anchored at the start and have one open-ended run, so a long
// line is checked in linear time.
export const ENGLISH_ATTRIBUTION = /^On .+ wrote:$/
export const FRENCH_ATTRIBUTION = /^Le .+ a écrit\s?:$/
export function isAttribution(text: string): boolean {
  return (ENGLISH_ATTRIBUTION.test(text) || FRENCH_ATTRIBUTION.test(text)) && /[\d@]/.test(text)
}

// The start of an attribution that a mail client may have wrapped onto the next line.
export function startsAttribution(text: string): boolean {
  return text.startsWith('On ') || text.startsWith('Le ')
}

// A line that ends like an attribution but does not start one: the end of an
// attribution that a mail program wrapped right after a "wrote:" in its display
// name ("On ..., x <a@b.c> wrote:" over "<d@e.f> wrote:").
const ATTRIBUTION_END = /(?:wrote|a écrit\s?):$/
export function endsAttribution(text: string): boolean {
  return ATTRIBUTION_END.test(text) && !startsAttribution(text)
}

const DIVIDERS = [
  /^-{2,}\s*Original Message\s*-{2,}$/i,
  /^-{2,}\s*Forwarded message\s*-{2,}$/i,
  /^Begin forwarded message:$/,
]

export const HEADER_FIELD = /^(From|Sent|Date|To|Cc|Subject):/i

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
// line, a blank one included. With `depth` given, it also ends at the first
// line at another depth.
function fieldRunLength(lines: string[], index: number, depth?: number): number {
  let end = index
  while (
    end < lines.length &&
    HEADER_FIELD.test(removeQuoteMarkers(lines[end]).trim()) &&
    (depth === undefined || quoteDepth(lines[end]) === depth)
  ) {
    end++
  }
  return end - index
}

// How many lines the "On ... wrote:" at `index` spans: 0 when there is none.
// The lines are read with their `>` markers stripped, since Apple Mail quotes
// the attribution along with the text under it.
function attributionLength(lines: string[], index: number): number {
  const attribution = removeQuoteMarkers(lines[index]).trim()
  let end = index
  if (isAttribution(attribution)) {
    end = index + 1
  } else {
    // "On ... wrote:" (or "Le ... a écrit :") wrapped over two lines by the
    // sender's mail client. A real one starts with its date, so its first line
    // holds a digit: a typed sentence that starts with "On " or "Le " is not
    // joined to the line under it. It never joins a blank line or a line that
    // is a whole attribution itself, and both lines carry a `>` marker or
    // neither does.
    const marked = /^\s*>/.test(lines[index])
    const rawNext = index + 1 < lines.length ? lines[index + 1] : ''
    const next = removeQuoteMarkers(rawNext).trim()
    const startsWithDate = startsAttribution(attribution) && /\d/.test(attribution)
    const nextCanJoin = next !== '' && /^\s*>/.test(rawNext) === marked && !isAttribution(next)
    if (!startsWithDate || !nextCanJoin || !isAttribution(`${attribution} ${next}`)) return 0
    end = index + 2
  }
  // A line that may be the end of it belongs to it. Then nobody can tell who
  // wrote it (lib/email-in/quote-author.ts).
  const isEnd =
    end < lines.length &&
    quoteDepth(lines[end]) === quoteDepth(lines[index]) &&
    endsAttribution(removeQuoteMarkers(lines[end]).trim())
  return isEnd ? end + 1 - index : end - index
}

// The quote header starting at `index`: how many lines it spans, and its kind.
// null when there is none. The span is the header line plus the header fields
// directly under it, so a quote we already hold does not leak its
// Sent:/To:/Subject: lines as unseen text.
function quoteHeaderAt(lines: string[], index: number): { span: number; kind: HeaderKind } | null {
  const attribution = attributionLength(lines, index)
  if (attribution > 0) {
    return { span: attribution + fieldRunLength(lines, index + attribution), kind: 'attribution' }
  }

  // A divider or an Outlook block may be marked: someone quoted the message it
  // heads. Then all its lines sit at one depth.
  const line = removeQuoteMarkers(lines[index]).trim()
  const depth = quoteDepth(lines[index])

  // A divider, any blank lines directly under it (a bare `>` counts as blank),
  // then its header fields. An unmarked divider may have marked fields (Apple
  // Mail's "Begin forwarded message:").
  if (DIVIDERS.some((divider) => divider.test(line))) {
    const onlyDepth = depth > 0 ? depth : undefined
    let end = index + 1
    while (
      end < lines.length &&
      removeQuoteMarkers(lines[end]).trim() === '' &&
      (onlyDepth === undefined || quoteDepth(lines[end]) === onlyDepth)
    ) {
      end++
    }
    return { span: end - index + fieldRunLength(lines, end, onlyDepth), kind: 'fields' }
  }

  // Outlook: "From:" with "Sent:" or "Date:" within the next 4 lines.
  if (line.startsWith('From:')) {
    for (let i = index + 1; i < lines.length && i <= index + 4 && quoteDepth(lines[i]) === depth; i++) {
      const field = removeQuoteMarkers(lines[i]).trim()
      if (field.startsWith('Sent:') || field.startsWith('Date:')) {
        return { span: 1 + fieldRunLength(lines, index + 1, depth), kind: 'fields' }
      }
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

function newBlock(kind: HeaderKind | null, depth: number): Block {
  return { headerLines: [], kind, depth, bodyDepth: depth, quoter: null, possibleQuoter: null, lines: [] }
}

// Step 3: place every quoted line in a block and mark the own lines. Typed
// lines (unmarked, before the first header) are in no block, and the `>` lines
// before the first header form the header-less block, which has no own lines.
//
// Each header block has a body depth: the depth its message's own text sits
// at. Mail programs differ. Gmail puts the body one level deeper than its
// "On ... wrote:" line. Apple Mail puts the "On ... wrote:" line inside the
// blockquote, at the same depth as the body. Outlook uses a From:/Sent: field
// block and no markers. So the header's depth alone does not say where the
// quoter's lines are; the body depth does: a line one level shallower than a
// body was written by the person who quoted that message. Own is a best
// reading, not a certainty: a quoted line that a mail program re-wrapped
// without its `>` reads as own.
//
// The open header blocks are kept on a stack. A header at depth h closes every
// open block whose body is deeper than h; the block left on top is the one
// whose body the header sits in, its quoter. No body is more than one level
// deeper than its header, so a header never closes a block whose own header is
// shallower than it. A quoted line at depth k goes to the nearest open block,
// from the top, whose body depth is at most k + 1: own when the body is exactly
// one level deeper, not own otherwise. When none qualifies, it goes to the
// shallowest open block, own. Lines never close a block, so a line typed under
// a nested quote goes back to the outer message.
//
// A header at depth 1 or more with no open block to sit in may still sit inside
// a quoted message, one whose own header the app did not recognise (one in
// another language, say). Whoever wrote that message quoted this one, and the
// app cannot tell who: the quoter is unknown, never the email's sender. It is
// so in four cases. The header-less text holds a non-blank line at the header's
// depth or shallower: that text is the message. The header's own body is deeper
// than it, Gmail's shape: a header at depth 1 in that shape is itself quoted
// text. The header is at depth 2 or more: the sender's own quotes are at depth
// 1 at most. Or it is the first header, right under a typed line that ends in a
// colon, which may be the message's attribution. Any other header at depth 1 in
// Apple Mail's shape, with its body at depth 1, is the sender's own quote. An
// unknown quoter is a block with no header lines: the header-less block, or an
// empty one that stands for the message.
//
// That quoter is a best reading, and a message can be shaped to be read wrong:
// body depths come from its own lines. So who could have written a header is
// found apart, from header depths alone. A header at depth h can sit in any
// earlier message whose header is at h or shallower, until a still shallower
// header ends that message. The second stack holds those messages. At its
// bottom is the header-less block or the unknown quoter's, if any, at the
// shallowest depth its text is known to sit at.
function findBlocks(lines: Line[]): Block[] {
  const headerBlocks = headerBlocksWithBodyDepths(lines)

  const blocks: Block[] = []
  const open: Block[] = []
  const possible: Block[] = []
  let headerless: Block | null = null
  // The nearest non-blank line before the first header.
  let lastLine: Line | null = null
  for (const line of lines) {
    if (line.headerId !== null) {
      const block = headerBlocks[line.headerId]
      // The first line of a header opens its block; the rest of its span is already in it.
      if (block.headerLines[0] !== line) continue

      while (open.length > 0 && open[open.length - 1].bodyDepth > block.depth) open.pop()
      while (possible.length > 0 && possible[possible.length - 1].depth > block.depth) possible.pop()

      if (open.length > 0) {
        block.quoter = open[open.length - 1]
      } else if (block.depth >= 1) {
        // With no block open, every header still in `possible` is at this depth
        // and Gmail-shaped, so it got an unknown quoter here: the bottom of
        // `possible`, when there is one, is always a block with no header.
        const underColon = line.headerId === 0 && lastLine !== null && endsInColon(lastLine)
        if (possible.length === 0 && (block.bodyDepth > block.depth || block.depth >= 2 || underColon)) {
          possible.push(newBlock(null, block.depth))
        }
        if (possible.length > 0) block.quoter = possible[0]
      }
      open.push(block)

      block.possibleQuoter = possible.length > 0 ? possible[possible.length - 1] : null
      possible.push(block)

      blocks.push(block)
      continue
    }

    if (open.length === 0 && line.normalized !== '') lastLine = line
    if (line.quoted) {
      if (open.length > 0) {
        placeLine(open, line)
      } else {
        // `>` lines before the first header.
        if (headerless === null) {
          headerless = newBlock(null, Infinity)
          blocks.push(headerless)
          possible.push(headerless)
        }
        headerless.lines.push(line)
        if (line.normalized !== '') headerless.depth = Math.min(headerless.depth, line.depth)
      }
    }
  }
  return blocks
}

// A typed line that ends in a colon may be an attribution in a language the app
// does not read.
function endsInColon(line: Line): boolean {
  return !line.quoted && /[:：]$/.test(line.normalized)
}

// One block per quote header, in text order (a header's id is its index), with
// its body depth. A field block's body is at its own depth. For an
// "On ... wrote:" header at depth h, the non-blank lines between it and the
// next header decide: the shallowest depth among those deeper than h, if any.
// With no line there at all and the next header nested deeper (depth n > h),
// that header is the first line of the body: the body is at n when the next
// header is itself Gmail-style or a field block (it sits at its quoter's body
// depth), otherwise at n - 1 (an Apple Mail header sits one level inside its
// quoter's body), but never shallower than h. Otherwise the body is at h.
// And never more than one level deeper than the header: no mail program puts it
// there, but a message that opens with a deep quote of its own can look so.
// The next block's body depth is needed, so blocks are resolved from the last
// one back.
function headerBlocksWithBodyDepths(lines: Line[]): Block[] {
  const headerBlocks: Block[] = []
  // Per header block: the shallowest depth deeper than its header among the
  // non-blank lines up to the next header, and whether there is any such line.
  const shallowestDeeper: (number | null)[] = []
  const hasContent: boolean[] = []
  for (const line of lines) {
    if (line.headerId !== null) {
      if (line.headerId === headerBlocks.length) {
        headerBlocks.push(newBlock(line.headerKind, line.depth))
        shallowestDeeper.push(null)
        hasContent.push(false)
      }
      headerBlocks[line.headerId].headerLines.push(line)
    } else if (headerBlocks.length > 0 && line.normalized !== '') {
      const i = headerBlocks.length - 1
      hasContent[i] = true
      const deeper = shallowestDeeper[i]
      if (line.depth > headerBlocks[i].depth && (deeper === null || line.depth < deeper)) {
        shallowestDeeper[i] = line.depth
      }
    }
  }

  for (let i = headerBlocks.length - 1; i >= 0; i--) {
    const block = headerBlocks[i]
    const next = i + 1 < headerBlocks.length ? headerBlocks[i + 1] : null
    const deeper = shallowestDeeper[i]
    if (block.kind === 'fields') {
      block.bodyDepth = block.depth
    } else if (deeper !== null) {
      block.bodyDepth = deeper
    } else if (!hasContent[i] && next !== null && next.depth > block.depth) {
      const n = next.depth
      block.bodyDepth = next.kind === 'fields' || next.bodyDepth > n ? n : Math.max(block.depth, n - 1)
    } else {
      block.bodyDepth = block.depth
    }
    block.bodyDepth = Math.min(block.bodyDepth, block.depth + 1)
  }
  return headerBlocks
}

// Put a quoted line in its open block (see step 3) and mark it own when the
// block's body is one level deeper. A blank line is never own. Body depths
// never decrease up the stack (a header closes every body deeper than itself,
// and its own body is at least as deep as it), so a binary search finds the
// nearest block from the top whose body depth is at most `depth + 1`.
function placeLine(open: Block[], line: Line): void {
  let found = -1
  let low = 0
  let high = open.length - 1
  while (low <= high) {
    const middle = (low + high) >> 1
    if (open[middle].bodyDepth <= line.depth + 1) {
      found = middle
      low = middle + 1
    } else {
      high = middle - 1
    }
  }
  const block = found >= 0 ? open[found] : open[0]
  block.lines.push(line)
  const own = found < 0 || block.bodyDepth === line.depth + 1
  line.own = own && line.normalized !== ''
}

function isLong(line: Line): boolean {
  return line.normalized.length >= MIN_EVIDENCE_LENGTH
}

// A line that can show the app has seen an email: long, not a header line, and
// not an own line. A short quoted line takes its fate from one of these (step 4).
function isEvidence(line: Line): boolean {
  return line.headerId === null && !line.own && isLong(line)
}

// For each line of `lines`, the nearest line before it, then after it, that
// passes `test`; null where there is none. One pass each way.
function nearestBeforeAndAfter(
  lines: Line[],
  test: (line: Line) => boolean
): { before: (Line | null)[]; after: (Line | null)[] } {
  const before: (Line | null)[] = []
  let last: Line | null = null
  for (const line of lines) {
    before.push(last)
    if (test(line)) last = line
  }
  const after: (Line | null)[] = new Array(lines.length).fill(null)
  let next: Line | null = null
  for (let i = lines.length - 1; i >= 0; i--) {
    after[i] = next
    if (test(lines[i])) next = lines[i]
  }
  return { before, after }
}

// Step 4: a typed line is always kept. A long quoted line is dropped when the
// app has seen it. A short quoted line takes the fate of the nearest evidence
// line of its block, looking before it first and then after it. Header lines
// and own lines are never that neighbour (step 5 decides headers), and the
// search stays in the line's block, so a greeting under one header never
// follows a line quoted under another. With no such neighbour, a short line is
// kept.
//
// An own line in a block the email's sender quoted (no quoter) is the sender's
// own words in this email, and like a typed line it is never dropped. An own
// line in a block someone else quoted was written in an earlier email, which
// the app may hold or not: decideAnswers.
//
// When `seenAny` is given, a short non-blank line whose neighbour was dropped
// is dropped only if the app has seen it too: a "Green." answered inline beside
// a held question is new words. A blank line follows its neighbour regardless.
function decideFates(lines: Line[], blocks: Block[], seen: Set<string>, seenAny?: Set<string>): void {
  for (const block of blocks) {
    for (const line of block.lines) {
      if (!line.own && isLong(line)) line.kept = !seen.has(line.normalized)
    }

    const evidence = nearestBeforeAndAfter(block.lines, isEvidence)
    block.lines.forEach((line, i) => {
      if (line.own || isLong(line)) return
      const neighbour = evidence.before[i] ?? evidence.after[i]
      if (!neighbour || neighbour.kept) line.kept = true
      else if (seenAny && line.normalized !== '') line.kept = !seenAny.has(line.normalized)
      else line.kept = false
    })
  }
  if (seenAny) decideAnswers(lines, blocks, seenAny)
}

// Step 4, last part: the own lines of the blocks that someone other than the
// email's sender quoted. Such a line, short or long, is dropped only when the
// app has seen it in its place: `seenAny` has its pair with the non-blank line
// before it in the email, and that line is not kept here, and no header line (a
// header is in every reply, and its fate is not known yet). Its words alone, or
// after a line that is itself new, may be another answer. With no `seenAny` it
// is kept.
//
// In text order and after every other line, so the fate of the line before is
// known, and an answer of several lines is dropped line by line.
function decideAnswers(lines: Line[], blocks: Block[], seenAny: Set<string>): void {
  const answers = new Set<Line>()
  for (const block of blocks) {
    if (block.quoter === null) continue
    for (const line of block.lines) if (line.own) answers.add(line)
  }

  let previous: Line | null = null
  for (const line of lines) {
    if (line.normalized === '') continue
    if (answers.has(line) && previous !== null && previous.headerId === null && !previous.kept) {
      line.kept = !seenAny.has(linePair(previous.normalized, line.normalized))
    }
    previous = line
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
// listed block shows all its lines. Its quoters were found in step 3.
function collectQuotes(blocks: Block[]): QuoteBlock[] {
  // Each header's text made once, so the lists share the same strings.
  const texts = new Map<Block, string>()
  const textOf = (block: Block): string => {
    let text = texts.get(block)
    if (text === undefined) {
      text = headerText(block)
      texts.set(block, text)
    }
    return text
  }

  const quotes: QuoteBlock[] = []
  for (const block of blocks) {
    if (!block.lines.some((line) => line.kept && line.normalized !== '')) continue
    for (const line of block.lines) line.context = !line.kept && line.normalized !== ''
    const possibleQuoters: string[] = []
    for (let quoter = block.possibleQuoter; quoter !== null; quoter = quoter.possibleQuoter) {
      possibleQuoters.push(textOf(quoter))
    }
    quotes.push({
      header: textOf(block),
      quoterHeader: block.quoter === null ? null : textOf(block.quoter),
      possibleQuoters,
      lines: trimBlankRuns(block.lines.map(toQuoteLine)),
    })
  }
  return quotes
}

function toQuoteLine(line: Line): QuoteLine {
  if (line.normalized === '') return { text: '', context: false, own: false }
  // A held own line (step 4) comes back as context only: never both.
  return { text: removeQuoteMarkers(line.raw), context: line.context, own: line.own && !line.context }
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
// given, every line of any length and every pair of lines (allLines), so a
// short quoted line, or an inline answer from further up the thread, is dropped
// only when the app has seen it too (step 4).
export function splitNewText(
  text: string,
  seen: Set<string>,
  seenAny?: Set<string>
): { typed: string; quotedUnseen: string; quotes: QuoteBlock[] } {
  const lines = markLines(splitLines(text))
  const blocks = findBlocks(lines)
  decideFates(lines, blocks, seen, seenAny)
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

// What the repeat check compares, parsed once per email: a text's non-blank,
// non-header lines, normalized, typed and quoted apart, and whether any of them
// is long enough to be evidence. A caller comparing one email with many earlier
// ones (lib/email-in/reading.ts) makes one signature per email and compares
// those, so no text is parsed twice.
export type RepeatSignature = { typed: Set<string>; quoted: Set<string>; hasEvidence: boolean }

export function repeatSignature(text: string): RepeatSignature {
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
  return isRepeatOfSignature(repeatSignature(text), repeatSignature(earlierText))
}

// isRepeatOf on two signatures (repeatSignature).
export function isRepeatOfSignature(now: RepeatSignature, earlier: RepeatSignature): boolean {
  if (!now.hasEvidence) return false
  // A set cannot be inside a smaller one: skip the line-by-line check.
  if (now.typed.size > earlier.typed.size || now.quoted.size > earlier.quoted.size) return false
  for (const line of now.typed) if (!earlier.typed.has(line)) return false
  for (const line of now.quoted) if (!earlier.quoted.has(line)) return false
  return true
}
