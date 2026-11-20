// What is new in an email, given the lines the app already holds.
//
// A maker who hits Reply instead of Reply All writes to the builder alone, so
// their words first reach the app quoted inside the builder's next reply. Those
// quoted words must not be lost: a quoted line the app has never seen is
// returned as `quotedUnseen`, apart from what the sender typed. When in doubt a
// line is kept: keeping costs a few tokens, dropping can lose someone's words.

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
  // Which quote header this line belongs to (a wrapped header spans two lines),
  // or null when it is not a header line.
  headerId: number | null
  kept: boolean
}

// Step 1: `\r\n` is treated as `\n`.
function splitLines(text: string): string[] {
  return text.replace(/\r\n/g, '\n').split('\n')
}

// How many lines the quote header starting at `index` spans: 0 when there is none.
function quoteHeaderLength(lines: string[], index: number): number {
  const line = lines[index].trim()
  if (/^On .+ wrote:$/.test(line)) return 1
  // "On ... wrote:" wrapped over two lines by the sender's mail client. When the
  // next line is a whole header by itself, this line is not part of it.
  const next = index + 1 < lines.length ? lines[index + 1].trim() : ''
  if (!/^On .+ wrote:$/.test(next) && /^On .+ wrote:$/.test(`${line} ${next}`)) return 2
  if (/^-{2,}\s*Original Message\s*-{2,}$/i.test(line)) return 1
  if (/^-{2,}\s*Forwarded message\s*-{2,}$/i.test(line)) return 1
  if (line === 'Begin forwarded message:') return 1
  // Outlook: "From:" with "Sent:" or "Date:" within the next 4 lines.
  if (line.startsWith('From:')) {
    const following = lines.slice(index + 1, index + 5).map((l) => l.trim())
    if (following.some((l) => l.startsWith('Sent:') || l.startsWith('Date:'))) return 1
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
  for (let i = 0; i < lines.length; i++) {
    const span = quoteHeaderLength(rawLines, i)
    if (span > 0) {
      for (let j = i; j < i + span; j++) lines[j].headerId = headerCount
      headerCount++
      insideQuote = true
    }
    if (insideQuote) lines[i].quoted = true
    if (span === 2) {
      lines[i + 1].quoted = true
      i++ // the second line of a wrapped header is already marked
    }
  }
  return lines
}

function isLong(line: Line): boolean {
  return line.normalized.length >= MIN_EVIDENCE_LENGTH
}

// Step 3: a long line is dropped when the app has seen it. A short line takes
// the fate of the nearest long line with the same quoted status, looking before
// it first and then after it, so a short typed "Yes agreed" never follows a seen
// quoted line out. Header lines are never that neighbour (step 4 decides them).
// With no such neighbour, a short line is kept.
function decideFates(lines: Line[], seen: Set<string>): void {
  const isEvidence = (line: Line) => line.headerId === null && isLong(line)

  for (const line of lines) {
    if (isEvidence(line)) line.kept = !seen.has(line.normalized)
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (line.headerId !== null || isLong(line)) continue
    const sameStatus = (other: Line) => isEvidence(other) && other.quoted === line.quoted
    const before = lines.slice(0, i).reverse().find(sameStatus)
    const after = lines.slice(i + 1).find(sameStatus)
    const neighbour = before ?? after
    line.kept = neighbour ? neighbour.kept : true
  }
}

// Step 4: a quote header is kept only when a kept, non-blank quoted line follows
// it before the next header.
function decideHeaders(lines: Line[]): void {
  for (let i = 0; i < lines.length; i++) {
    const headerId = lines[i].headerId
    if (headerId === null) continue
    let hasKeptQuote = false
    for (let j = i + 1; j < lines.length; j++) {
      const other = lines[j]
      if (other.headerId === headerId) continue // second line of a wrapped header
      if (other.headerId !== null) break
      if (other.quoted && other.kept && other.normalized !== '') {
        hasKeptQuote = true
        break
      }
    }
    lines[i].kept = hasKeptQuote
    // A wrapped header's second line shares its fate.
    if (i + 1 < lines.length && lines[i + 1].headerId === headerId) {
      lines[i + 1].kept = hasKeptQuote
      i++
    }
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

function removeQuoteMarkers(line: string): string {
  return line.replace(/^\s*>[>\s]*/, '')
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
