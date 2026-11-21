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

type Line = {
  raw: string
  normalized: string
  quoted: boolean
  // Which quote header this line belongs to, or null when it is not a header
  // line. A header spans several lines (a wrapped "On ... wrote:", a divider
  // with its From/Date block); they all share one id and one fate.
  headerId: number | null
  kept: boolean
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

// How many header-field lines (From:, Sent:, Date:, To:, Cc:, Subject:) run
// directly from `index`. Fields count with their `>` markers stripped, since
// Apple Mail quotes a forward's field block. The run ends at the first other
// line, a blank one included.
function fieldRunLength(lines: string[], index: number): number {
  let end = index
  while (end < lines.length && HEADER_FIELD.test(removeQuoteMarkers(lines[end]).trim())) end++
  return end - index
}

// How many lines the quote header starting at `index` spans: 0 when there is none.
// The span is the header line plus the header fields directly under it, so a
// quote we already hold does not leak its Sent:/To:/Subject: lines as unseen text.
function quoteHeaderLength(lines: string[], index: number): number {
  const line = lines[index].trim()

  // "On ... wrote:" is checked with its `>` markers stripped, since Apple Mail
  // quotes the attribution along with the text under it.
  const marked = /^\s*>/.test(lines[index])
  const attribution = removeQuoteMarkers(lines[index]).trim()
  if (isAttribution(attribution)) return 1 + fieldRunLength(lines, index + 1)
  // "On ... wrote:" wrapped over two lines by the sender's mail client. It never
  // joins a blank line or a line that is a whole attribution itself, and both
  // lines carry a `>` marker or neither does.
  const rawNext = index + 1 < lines.length ? lines[index + 1] : ''
  const next = removeQuoteMarkers(rawNext).trim()
  const nextCanJoin = next !== '' && /^\s*>/.test(rawNext) === marked && !isAttribution(next)
  if (attribution.startsWith('On ') && nextCanJoin && isAttribution(`${attribution} ${next}`)) {
    return 2 + fieldRunLength(lines, index + 2)
  }

  // A divider, any blank lines directly under it (a bare `>` counts as blank),
  // then its header fields.
  if (DIVIDERS.some((divider) => divider.test(line))) {
    let end = index + 1
    while (end < lines.length && removeQuoteMarkers(lines[end]).trim() === '') end++
    return end - index + fieldRunLength(lines, end)
  }

  // Outlook: "From:" with "Sent:" or "Date:" within the next 4 lines.
  if (line.startsWith('From:')) {
    const following = lines.slice(index + 1, index + 5).map((l) => l.trim())
    if (following.some((l) => l.startsWith('Sent:') || l.startsWith('Date:'))) {
      return 1 + fieldRunLength(lines, index + 1)
    }
  }
  return 0
}

// Step 2: mark quote headers and quoted lines. A line is quoted when it starts
// with `>` or comes at or after the first quote header.
function markLines(rawLines: string[]): Line[] {
  const lines: Line[] = rawLines.map((raw) => ({
    raw,
    normalized: normalizeLine(raw),
    quoted: /^\s*>/.test(raw),
    headerId: null,
    kept: true,
  }))

  let headerCount = 0
  let insideQuote = false
  let i = 0
  while (i < lines.length) {
    const span = quoteHeaderLength(rawLines, i)
    if (span > 0) {
      for (let j = i; j < i + span; j++) {
        lines[j].headerId = headerCount
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

function isLong(line: Line): boolean {
  return line.normalized.length >= MIN_EVIDENCE_LENGTH
}

// A line that can show the app has seen an email: long, and not a header line.
function isEvidence(line: Line): boolean {
  return line.headerId === null && isLong(line)
}

// Step 3: a long quoted line is dropped when the app has seen it; a long typed
// line is always kept. A short line takes the fate of the nearest long line
// with the same quoted status, looking before it first and then after it, so a
// short typed "Yes agreed" never follows a seen quoted line out (and a short
// typed line is therefore always kept too). Header lines are never that
// neighbour (step 4 decides them), and the search stays between the header
// spans around the line, so a greeting under one header never follows a line
// quoted under another. With no such neighbour, a short line is kept.
function decideFates(lines: Line[], seen: Set<string>): void {
  for (const line of lines) {
    if (isEvidence(line)) line.kept = !line.quoted || !seen.has(line.normalized)
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (line.headerId !== null || isLong(line)) continue

    // The stretch from the header span before this line (or the start) to the
    // header span after it (or the end).
    let start = i
    while (start > 0 && lines[start - 1].headerId === null) start--
    let end = i
    while (end + 1 < lines.length && lines[end + 1].headerId === null) end++

    const sameStatus = (other: Line) => isEvidence(other) && other.quoted === line.quoted
    const before = lines.slice(start, i).reverse().find(sameStatus)
    const after = lines.slice(i + 1, end + 1).find(sameStatus)
    const neighbour = before ?? after
    line.kept = neighbour ? neighbour.kept : true
  }
}

// Step 4: a quote header is kept only when a kept, non-blank quoted line follows
// it before the next header. Every line of a header's span shares that fate.
function decideHeaders(lines: Line[]): void {
  const headersWithKeptQuote = new Set<number>()
  let currentHeader: number | null = null
  for (const line of lines) {
    if (line.headerId !== null) {
      currentHeader = line.headerId
    } else if (currentHeader !== null && line.quoted && line.kept && line.normalized !== '') {
      headersWithKeptQuote.add(currentHeader)
    }
  }
  for (const line of lines) {
    if (line.headerId !== null) line.kept = headersWithKeptQuote.has(line.headerId)
  }
}

// Step 5: join lines, collapsing runs of blank lines to one and trimming the ends.
function joinLines(lines: string[]): string {
  const out: string[] = []
  for (const line of lines) {
    const blank = line.trim() === ''
    if (blank && out.length > 0 && out[out.length - 1].trim() === '') continue
    out.push(line)
  }
  return out.join('\n').trim()
}

export function splitNewText(
  text: string,
  seen: Set<string>
): { typed: string; quotedUnseen: string } {
  const lines = markLines(splitLines(text))
  decideFates(lines, seen)
  decideHeaders(lines)

  const kept = lines.filter((line) => line.kept)
  return {
    typed: joinLines(kept.filter((line) => !line.quoted).map((line) => line.raw)),
    quotedUnseen: joinLines(
      kept.filter((line) => line.quoted).map((line) => removeQuoteMarkers(line.raw))
    ),
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
