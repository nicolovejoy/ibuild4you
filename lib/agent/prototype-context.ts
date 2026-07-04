// #72 slice B2 — feed structural page captures (prototype_context rows, written
// by /api/feedback when a Loop submission includes a capture) into the agent
// system prompt. Sibling of prototype-feedback.ts: pure helpers here so
// selection/formatting is unit-testable; lib/api/prototype-context.ts does the
// Firestore query.

export interface RawCaptureRow {
  route?: string
  title?: string
  outline?: string
  status?: string
  created_at?: string
}

export interface PrototypeContextItem {
  route: string
  title: string
  outline: string
  ageLabel: string
}

// Agent sees at most the 3 freshest captures, none older than 14 days — stale
// structure misleads more than it helps (the app may have changed under it).
const DEFAULT_LIMIT = 3
const MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000
const OUTLINE_PROMPT_MAX = 2000

function ageLabel(createdAt: string | undefined, nowMs: number): string {
  if (!createdAt) return 'recently'
  const then = new Date(createdAt).getTime()
  if (Number.isNaN(then)) return 'recently'
  const days = Math.floor((nowMs - then) / (24 * 60 * 60 * 1000))
  if (days <= 0) return 'today'
  if (days === 1) return 'yesterday'
  return `${days} days ago`
}

function tooOld(createdAt: string | undefined, nowMs: number): boolean {
  if (!createdAt) return false
  const then = new Date(createdAt).getTime()
  if (Number.isNaN(then)) return false
  return nowMs - then > MAX_AGE_MS
}

function truncate(s: string, max: number): string {
  const t = s.trim()
  return t.length <= max ? t : t.slice(0, max - 1).trimEnd() + '…'
}

// Normalize + select capture rows for the prompt. Rows are expected
// newest-first (the query orders by created_at desc). Expired rows are dropped
// here too — the query doesn't filter on status, to keep the composite index
// down to (project_id, created_at).
export function summarizePrototypeContext(
  rows: RawCaptureRow[],
  nowMs: number,
  limit: number = DEFAULT_LIMIT,
): PrototypeContextItem[] {
  return rows
    .filter((r) => (r.status ?? 'active') === 'active')
    .filter((r) => !tooOld(r.created_at, nowMs))
    .filter((r) => (r.route ?? '').trim() || (r.outline ?? '').trim())
    .slice(0, limit)
    .map((r) => ({
      route: (r.route ?? '').trim(),
      title: (r.title ?? '').trim(),
      outline: truncate(r.outline ?? '', OUTLINE_PROMPT_MAX),
      ageLabel: ageLabel(r.created_at, nowMs),
    }))
}

// Render the system-prompt block, or null when there's nothing to show.
export function renderPrototypeContextBlock(items: PrototypeContextItem[]): string | null {
  if (items.length === 0) return null
  const sections = items.map((it) => {
    const heading = [it.route || '(unknown page)', it.title].filter(Boolean).join(' — ')
    const outline = it.outline ? `\n${it.outline}` : ''
    return `### ${heading} (${it.ageLabel})${outline}`
  })
  return `
## What the maker's screen looked like (structure)

These are structural snapshots of pages in the running prototype, captured from the maker's own browser when they sent feedback: the page's route, title, headings, and the labels of its controls. Use them to orient a walkthrough — name real pages and real buttons.

They are structural snapshots, NOT a live view or a screenshot — so don't invent visual details (colors, imagery, layout, spacing) beyond what's listed here or what the maker tells you.

${sections.join('\n\n')}
`.trim()
}
