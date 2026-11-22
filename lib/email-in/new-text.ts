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
// held line or the same header: then an answer the app holds does not come back
// as new words in every later reply. When a quoted message the app already
// holds gets a new answer, the held lines come back marked `context`, so the
// answer arrives with its question. Context lines are only in `quotes`, never
// in `quotedUnseen`.

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

// Every non-blank normalized line of every text, of any length, and every
// non-blank line paired with the one before it in its text (pairKeys). A short
// quoted line ("Thanks,", "Green.") is dropped beside a held line only when it
// is in this set, and an inline answer from further up the thread only when its
// pair is (decideFates), so an answer the app never saw is kept.
export function allLines(texts: string[]): Set<string> {
  const all = new Set<string>()
  for (const text of texts) {
    const lines = markLines(splitLines(text))
    const pairs = pairKeys(lines)
    lines.forEach((line, i) => {
      if (line.normalized !== '') all.add(line.normalized)
      const pair = pairs[i]
      if (pair !== null) all.add(pair)
    })
  }
  return all
}

// For each line, the non-blank line before it and the line itself as one entry
// of allLines; null for a blank line and for the first one. A normalized line
// never holds a newline, so a pair is never mistaken for a line.
//
// For a line under a quote header, what comes before it is the whole header: its
// last line may be "wrote:" or "Subject: ...", the same in many headers. Its
// lines are joined with a space, and without the one after a "<", where Gmail
// wraps, so a header makes the same pair however it is wrapped. Between the
// lines of one header the line before counts alone: the cost stays linear.
function pairKeys(lines: Line[]): (string | null)[] {
  const headers: string[][] = []
  for (const line of lines) {
    if (line.headerId === null || line.normalized === '') continue
    if (line.headerId === headers.length) headers.push([])
    headers[line.headerId].push(line.normalized)
  }

  let previous: Line | null = null
  return lines.map((line) => {
    if (line.normalized === '') return null
    const before = previous
    previous = line
    if (before === null) return null
    const place =
      before.headerId !== null && before.headerId !== line.headerId
        ? headers[before.headerId].join(' ').replace(/< /g, '<')
        : before.normalized
    return `${place}\n${line.normalized}`
  })
}

// One line of a quoted message, `>` markers stripped.
// context: the app already holds this line; it is shown only so the new lines
//   around it make sense. own: written into the quote by the person who quoted
//   it (an inline answer), not by the quote's author. Never both.
// quoter: on an own line, who wrote it, when that is not the block's
//   quoterHeader; in the same terms. A block placed deep in a thread can hold
//   an answer by someone further out, the email's sender above all.
// possible: on an own line, how many of the block's possibleQuoters, counted
//   from the last, could have written it, when not all could: a message deeper
//   than the line cannot hold it.
export type QuoteLine = {
  text: string
  context: boolean
  own: boolean
  quoter?: string | null
  possible?: number
}

// One quoted message: a quote header and the quoted lines placed under it by
// depth (step 3), in their original order. They need not be next to each
// other: a line typed under a nested quote goes back to the outer message.
// header: the header's lines, markers stripped, joined with '\n'; '' for `>`
//   lines that come before any header.
// quoterHeader: who quoted this message (and so wrote its own lines, unless a
//   line says otherwise), the best reading of the email's structure. null: the
//   email's sender. '': someone the app could not identify (the header sits
//   inside `>` text whose header was not recognised, step 3). Otherwise the
//   header of the quote this one sits inside: its author wrote that message.
// possibleQuoters: the header of every earlier message that could enclose this
//   one, nearest first, whatever shape the mail program gave it; '' comes last
//   when a message whose header was not recognised could. Anyone in it could
//   have written this header themselves, so a credit is only as good as
//   everyone in it (lib/email-in/reading.ts). It holds quoterHeader, unless
//   that is null, and every quoter around it.
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
  // Written into a quote by the person who quoted it (step 3), and for such a
  // line that person, as in Block.quoter.
  own: boolean
  quoter: Block | null
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
  // For an unknown quoter's empty block (step 3), 1.
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

// What finding headers needs to know of each line.
type HeaderLine = {
  // Without its `>` markers, trimmed; '' when blank.
  text: string
  depth: number
  // The end (exclusive) of the run of field lines at one depth that starts
  // here; the line's own index when it is not a field line.
  fieldsEnd: number
  // The first non-blank line from here on; lines.length when there is none.
  nextText: number
}

// Worked out once for the whole text, from the last line back, so that no
// header search reads the same run of lines again and again.
function readHeaderLines(rawLines: string[]): HeaderLine[] {
  const lines: HeaderLine[] = new Array(rawLines.length)
  for (let i = rawLines.length - 1; i >= 0; i--) {
    const text = removeQuoteMarkers(rawLines[i]).trim()
    const depth = quoteDepth(rawLines[i])
    const next = i + 1 < lines.length ? lines[i + 1] : null
    let fieldsEnd = i
    if (HEADER_FIELD.test(text)) fieldsEnd = next !== null && next.depth === depth ? next.fieldsEnd : i + 1
    const nextText = text !== '' ? i : next !== null ? next.nextText : lines.length
    lines[i] = { text, depth, fieldsEnd, nextText }
  }
  return lines
}

// How many header-field lines (From:, Sent:, Date:, To:, Cc:, Subject:) run
// directly from `index`, at any depth, since Apple Mail quotes a forward's field
// block. The run ends at the first other line, a blank one included.
function fieldRunLength(lines: HeaderLine[], index: number): number {
  let end = index
  while (end < lines.length && HEADER_FIELD.test(lines[end].text)) end++
  return end - index
}

// How many lines the "On ... wrote:" at `index` spans: 0 when there is none. It
// may be marked: Apple Mail quotes the attribution along with the text under it.
function attributionLength(lines: HeaderLine[], index: number): number {
  const { text, depth } = lines[index]
  let end = index
  if (isAttribution(text)) {
    end = index + 1
  } else {
    // "On ... wrote:" (or "Le ... a écrit :") wrapped over two lines by the
    // sender's mail client. A real one starts with its date, so its first line
    // holds a digit: a typed sentence that starts with "On " or "Le " is not
    // joined to the line under it. It never joins a blank line or a line that
    // is a whole attribution itself, and both lines carry a `>` marker or
    // neither does.
    const next = index + 1 < lines.length ? lines[index + 1] : null
    if (next === null || !startsAttribution(text) || !/\d/.test(text)) return 0
    const nextCanJoin = next.text !== '' && next.depth > 0 === depth > 0 && !isAttribution(next.text)
    if (!nextCanJoin || !isAttribution(`${text} ${next.text}`)) return 0
    end = index + 2
  }
  // A line that may be the end of it belongs to it. Then nobody can tell who
  // wrote it (lib/email-in/quote-author.ts).
  const isEnd = end < lines.length && lines[end].depth === depth && endsAttribution(lines[end].text)
  return isEnd ? end + 1 - index : end - index
}

// An address inside a From: value. Only its presence is asked here.
const HOLDS_ADDRESS = /[^\s@]@[^\s@]+\.[^\s@]/

// The quote header starting at `index`: how many lines it spans, and its kind.
// null when there is none. The span is the header line plus the header fields
// directly under it, so a quote we already hold does not leak its
// Sent:/To:/Subject: lines as unseen text.
function quoteHeaderAt(lines: HeaderLine[], index: number): { span: number; kind: HeaderKind } | null {
  const attribution = attributionLength(lines, index)
  if (attribution > 0) {
    return { span: attribution + fieldRunLength(lines, index + attribution), kind: 'attribution' }
  }

  const { text, depth } = lines[index]
  if (DIVIDERS.some((divider) => divider.test(text))) {
    return depth === 0 ? dividerAt(lines, index) : markedDividerAt(lines, index)
  }
  if (text.startsWith('From:')) {
    return depth === 0 ? fieldBlockAt(lines, index) : markedFieldBlockAt(lines, index)
  }
  return null
}

// A divider, any blank lines directly under it (a bare `>` counts as blank),
// then its header fields, which may be marked (Apple Mail's "Begin forwarded
// message:").
function dividerAt(lines: HeaderLine[], index: number): { span: number; kind: HeaderKind } {
  let end = index + 1
  while (end < lines.length && lines[end].text === '') end++
  return { span: end - index + fieldRunLength(lines, end), kind: 'fields' }
}

// Outlook: "From:" with "Sent:" or "Date:" within the next 4 lines, none of
// them marked.
function fieldBlockAt(lines: HeaderLine[], index: number): { span: number; kind: HeaderKind } | null {
  for (let i = index + 1; i < lines.length && i <= index + 4 && lines[i].depth === 0; i++) {
    if (isDateField(lines[i].text)) return { span: lines[index].fieldsEnd - index, kind: 'fields' }
  }
  return null
}

function isDateField(text: string): boolean {
  return text.startsWith('Sent:') || text.startsWith('Date:')
}

// A marked divider or field block heads a message that someone quoted. Inside a
// quote the same lines can also be a member's own words ("The form needs these
// fields: From: departure city"), which must not be lost, so a header there
// needs more: its lines at one depth, and text of its own under them. A divider
// may also have its fields one level deeper, as in a quoted Apple Mail forward.
function markedDividerAt(lines: HeaderLine[], index: number): { span: number; kind: HeaderKind } | null {
  const { depth } = lines[index]
  let end = index + 1
  while (end < lines.length && lines[end].text === '' && lines[end].depth === depth) end++
  const fields = end < lines.length && lines[end].fieldsEnd > end ? lines[end] : null
  const hasFields = fields !== null && (fields.depth === depth || fields.depth === depth + 1)
  if (hasFields) end = fields.fieldsEnd
  if (!hasTextAt(lines, end, hasFields ? fields.depth : depth)) return null
  return { span: end - index, kind: 'fields' }
}

// For a field block the fields from From: to Sent: or Date: are also unbroken,
// and the From: value holds an address. One that shows only names stays part of
// the message around it.
function markedFieldBlockAt(lines: HeaderLine[], index: number): { span: number; kind: HeaderKind } | null {
  const { text, depth, fieldsEnd } = lines[index]
  if (!HOLDS_ADDRESS.test(text)) return null
  const lastDateAt = Math.min(index + 4, fieldsEnd - 1)
  for (let i = index + 1; i <= lastDateAt; i++) {
    if (!isDateField(lines[i].text)) continue
    return hasTextAt(lines, fieldsEnd, depth) ? { span: fieldsEnd - index, kind: 'fields' } : null
  }
  return null
}

// Whether the next non-blank line from `index` on is at this depth or deeper.
function hasTextAt(lines: HeaderLine[], index: number, depth: number): boolean {
  if (index >= lines.length) return false
  const next = lines[index].nextText
  return next < lines.length && lines[next].depth >= depth
}

// Step 2: mark quote headers and quoted lines. A line is quoted when it starts
// with `>` or comes at or after the first quote header.
function markLines(rawLines: string[]): Line[] {
  const headerLines = readHeaderLines(rawLines)
  const lines: Line[] = rawLines.map((raw, i) => ({
    raw,
    normalized: normalizeLine(raw),
    quoted: headerLines[i].depth > 0,
    depth: headerLines[i].depth,
    headerId: null,
    headerKind: null,
    own: false,
    quoter: null,
    kept: true,
    context: false,
  }))

  let headerCount = 0
  let insideQuote = false
  let i = 0
  while (i < lines.length) {
    const header = quoteHeaderAt(headerLines, i)
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
// An own line stays beside the question it answers, but its block need not be
// the one its writer quoted: several open blocks can have their body one level
// deeper than it (an Outlook block has its body at its quoter's own depth). The
// lowest of them is what the line's writer quoted, so they are its quoter.
//
// The first header may sit inside a quoted message whose own header the app did
// not recognise (one in another language, say). Whoever wrote that message
// quoted this one, and the app cannot tell who: the quoter is unknown, never
// the email's sender. unknownMessage says when. Such a message stands at depth
// 1 and lasts until a header at depth 0: every marked header with no open block
// to sit in is in it. Its author never wrote a line at depth 0: an own line
// there is the sender's.
//
// That quoter is a best reading, and a message can be shaped to be read wrong:
// body depths come from its own lines. So who could have written a header is
// found apart, from header depths alone. A header at depth h can sit in any
// earlier message whose header is at h or shallower, until a still shallower
// header ends that message. The second stack holds those messages, with the
// unknown message, if any, at its bottom.
function findBlocks(lines: Line[]): Block[] {
  const headerBlocks = headerBlocksWithBodyDepths(lines)

  const blocks: Block[] = []
  const open: Block[] = []
  const possible: Block[] = []
  let headerless: Block | null = null
  let unknown: Block | null = null
  // The last non-blank typed line before any `>` text or header.
  let lastTyped: Line | null = null
  for (const line of lines) {
    if (line.headerId !== null) {
      const block = headerBlocks[line.headerId]
      // The first line of a header opens its block; the rest of its span is already in it.
      if (block.headerLines[0] !== line) continue

      if (line.headerId === 0) {
        unknown = unknownMessage(block, headerless, lastTyped)
        if (unknown !== null) possible.push(unknown)
      }
      while (open.length > 0 && open[open.length - 1].bodyDepth > block.depth) open.pop()
      while (possible.length > 0 && possible[possible.length - 1].depth > block.depth) possible.pop()

      if (open.length > 0) {
        block.quoter = open[open.length - 1]
        // A Gmail header sits at its quoter's body depth, so a deeper one is
        // Apple Mail's, whose body is at its own depth.
        if (block.depth > block.quoter.bodyDepth) block.bodyDepth = block.depth
      } else if (block.depth > 0) {
        block.quoter = unknown
      }
      open.push(block)

      block.possibleQuoter = possible.length > 0 ? possible[possible.length - 1] : null
      possible.push(block)

      blocks.push(block)
    } else if (!line.quoted) {
      if (headerless === null && line.normalized !== '') lastTyped = line
    } else if (open.length > 0) {
      placeLine(open, line)
    } else {
      // `>` lines before the first header.
      if (headerless === null) {
        headerless = newBlock(null, Infinity)
        blocks.push(headerless)
      }
      headerless.lines.push(line)
      if (line.normalized !== '') headerless.depth = Math.min(headerless.depth, line.depth)
    }
  }
  return blocks
}

// The message whose header the app did not recognise and which holds the first
// header of the email, as an empty block; null when the sender quoted it. An
// Apple Mail header is at depth 1 with its body at depth 1 in the sender's own
// quote, and one that is not marked has nothing around it. Otherwise it is
// inside a quoted message
// - when `>` text at its depth or shallower comes before it: that is the message,
// - when its body is deeper than it, Gmail's shape: one at depth 1 in that shape
//   is itself quoted text,
// - when it is at depth 2 or more: the sender's own quotes are at depth 1,
// - when what was typed above it ends like an attribution in some language.
function unknownMessage(first: Block, headerless: Block | null, lastTyped: Line | null): Block | null {
  if (first.depth === 0) return null
  const inside =
    (headerless !== null && headerless.depth <= first.depth) ||
    first.bodyDepth > first.depth ||
    first.depth >= 2 ||
    (lastTyped !== null && mayBeAttribution(lastTyped))
  return inside ? newBlock(null, 1) : null
}

// A typed line that ends in a colon may be an attribution in a language the app
// does not read. A real one holds a date or an address ("My answers are below:"
// does not).
function mayBeAttribution(line: Line): boolean {
  return /[:：]$/.test(line.normalized) && /[\d@]/.test(line.normalized)
}

// One block per quote header, in text order (a header's id is its index), with
// its body depth. A field block's body is at its fields' depth, which under an
// Apple Mail divider is one level deeper than the header's first line. For an
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
// one back. findBlocks, which knows a block's quoter, may still move a body up
// to its header's depth. That agrees with the rule above: a body set from the
// next header is at n - 1 or at n, capped, and only a header deeper than it, so
// not read as Gmail's there, is moved.
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
      block.bodyDepth = Math.max(block.depth, block.headerLines[block.headerLines.length - 1].depth)
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

// Put a quoted line in its open block (see step 3), mark it own when the
// block's body is one level deeper, and then find its quoter. A blank line is
// never own. Body depths never decrease up the stack (a header closes every
// body deeper than itself, and its own body is at least as deep as it), so both
// blocks are found by binary search.
function placeLine(open: Block[], line: Line): void {
  const tooDeep = firstDeeperThan(open, line.depth + 1)
  const block = open[Math.max(tooDeep - 1, 0)]
  block.lines.push(line)
  if (line.normalized === '') return

  line.own = tooDeep === 0 || block.bodyDepth === line.depth + 1
  if (!line.own) return
  const { quoter } = open[firstDeeperThan(open, line.depth)]
  // The unknown message's author wrote no line shallower than it (step 3).
  const isUnknown = quoter !== null && quoter.headerLines.length === 0
  line.quoter = isUnknown && quoter.depth > line.depth ? null : quoter
}

// The index of the lowest open block whose body is deeper than `depth`;
// open.length when there is none.
function firstDeeperThan(open: Block[], depth: number): number {
  let low = 0
  let high = open.length
  while (low < high) {
    const middle = (low + high) >> 1
    if (open[middle].bodyDepth > depth) high = middle
    else low = middle + 1
  }
  return low
}

function isLong(line: Line): boolean {
  return line.normalized.length >= MIN_EVIDENCE_LENGTH
}

// A line that can show the app has seen an email: long, not a header line, and
// not an own line. A short quoted line takes its fate from one of these (step 4).
function isEvidence(line: Line): boolean {
  return line.headerId === null && !line.own && isLong(line)
}

// For each line of `lines`, the nearest evidence line before it, then after it;
// null where there is none. One pass each way.
function nearestEvidence(lines: Line[]): { before: (Line | null)[]; after: (Line | null)[] } {
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
// An own line by the email's sender (no quoter) is their own words in this
// email, and like a typed line it is never dropped. An own line by someone else
// was written in an earlier email, which the app may hold or not: decideAnswers.
//
// When `seenAny` is given, a short non-blank line whose neighbour was dropped
// is dropped only if the app has seen it too: a "Green." answered inline beside
// a held question is new words. A blank line follows its neighbour regardless.
function decideFates(lines: Line[], blocks: Block[], seen: Set<string>, seenAny?: Set<string>): void {
  for (const block of blocks) {
    for (const line of block.lines) {
      if (!line.own && isLong(line)) line.kept = !seen.has(line.normalized)
    }

    const evidence = nearestEvidence(block.lines)
    block.lines.forEach((line, i) => {
      if (line.own || isLong(line)) return
      const neighbour = evidence.before[i] ?? evidence.after[i]
      if (!neighbour || neighbour.kept) line.kept = true
      else if (seenAny && line.normalized !== '') line.kept = !seenAny.has(line.normalized)
      else line.kept = false
    })
  }
  if (seenAny) decideAnswers(lines, seenAny)
}

// Step 4, last part: the own lines by someone other than the email's sender.
// Such a line, short or long, is dropped only when the app has seen it in its
// place: `seenAny` has its pair with the non-blank line before it in the email
// (pairKeys), and that line is a header line or is not kept here. Its words
// alone, or after a line that is itself new, may be another answer. A whole
// header holds its date and author, so it shows the place whatever its own fate
// (not known yet). With no `seenAny` it is kept.
//
// A pair is not always one place: when the same words are held under the same
// signature line, or under the same question asked before (a short one
// included), a private answer shows as context only, or is missing when its
// block has nothing new.
//
// In text order and after every other line, so the fate of the line before is
// known, and an answer of several lines is dropped line by line.
function decideAnswers(lines: Line[], seenAny: Set<string>): void {
  const pairs = pairKeys(lines)
  let previous: Line | null = null
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (line.normalized === '') continue
    const pair = pairs[i]
    const isAnswer = line.own && line.quoter !== null
    if (isAnswer && pair !== null && previous !== null && (previous.headerId !== null || !previous.kept)) {
      line.kept = !seenAny.has(pair)
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
    const possible: Block[] = []
    for (let quoter = block.possibleQuoter; quoter !== null; quoter = quoter.possibleQuoter) {
      possible.push(quoter)
    }
    const lines = block.lines.map((line) => {
      const quoteLine = toQuoteLine(line)
      if (!quoteLine.own) return quoteLine
      if (line.quoter !== block.quoter) quoteLine.quoter = line.quoter === null ? null : textOf(line.quoter)
      const count = countUpToDepth(possible, line.depth)
      if (count < possible.length) quoteLine.possible = count
      return quoteLine
    })
    quotes.push({
      header: textOf(block),
      quoterHeader: block.quoter === null ? null : textOf(block.quoter),
      possibleQuoters: possible.map(textOf),
      lines: trimBlankRuns(lines),
    })
  }
  return quotes
}

// How many of these blocks, nearest first, have their header at `depth` or
// shallower. They are the last ones: header depths never increase outwards.
function countUpToDepth(blocks: Block[], depth: number): number {
  let low = 0
  let high = blocks.length
  while (low < high) {
    const middle = (low + high) >> 1
    if (blocks[middle].depth <= depth) high = middle
    else low = middle + 1
  }
  return blocks.length - low
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
