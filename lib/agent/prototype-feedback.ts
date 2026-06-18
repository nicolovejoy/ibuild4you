// #72 (slice A) — let the intake agent perceive the running prototype via Loop.
//
// Loop already runs as the logged-in maker inside the host app and posts
// feedback rows (bug/idea/other) keyed by the project slug. Rather than build
// headless browsing, this slice feeds those real reports into the agent's system
// prompt so Sam can ground the conversation in what the maker actually saw —
// instead of confabulating a site walkthrough (#69 covered the honesty stopgap).
//
// Pure helpers here (no Firestore) so selection/formatting is unit-testable; the
// chat routes query the rows and call summarizePrototypeFeedback before building
// the prompt.

export interface RawFeedbackRow {
  type?: string
  body?: string
  page_url?: string
  status?: string
  created_at?: string
}

export interface PrototypeFeedbackItem {
  type: string
  body: string
  path: string | null // route the report came from, e.g. "/checkout" — host/query stripped
  ageLabel: string // "today", "3 days ago", ...
  resolved: boolean // status is done/wontfix — keep but mark so Sam doesn't re-raise
}

const BODY_MAX = 280
const DEFAULT_LIMIT = 8

// Pull the path off a captured page URL. Loop stores a full URL; the host and
// query string are noise (and mild PII) for the agent — the route is the useful
// signal. Returns null if the URL is missing or unparseable.
function pathFromUrl(url: string | undefined): string | null {
  if (!url) return null
  try {
    return new URL(url).pathname || '/'
  } catch {
    // Not an absolute URL — if it already looks like a path, keep it.
    return url.startsWith('/') ? url.split('?')[0] : null
  }
}

function ageLabel(createdAt: string | undefined, nowMs: number): string {
  if (!createdAt) return 'recently'
  const then = new Date(createdAt).getTime()
  if (Number.isNaN(then)) return 'recently'
  const days = Math.floor((nowMs - then) / (24 * 60 * 60 * 1000))
  if (days <= 0) return 'today'
  if (days === 1) return 'yesterday'
  if (days < 7) return `${days} days ago`
  if (days < 14) return 'last week'
  if (days < 60) return `${Math.floor(days / 7)} weeks ago`
  return 'a while ago'
}

function truncate(s: string): string {
  const t = s.trim()
  return t.length <= BODY_MAX ? t : t.slice(0, BODY_MAX - 1).trimEnd() + '…'
}

// Normalize + select recent feedback rows for the prompt. Rows are expected
// newest-first (the query orders by created_at desc); empty-body rows are
// dropped, the rest truncated and capped at `limit`.
export function summarizePrototypeFeedback(
  rows: RawFeedbackRow[],
  nowMs: number,
  limit: number = DEFAULT_LIMIT,
): PrototypeFeedbackItem[] {
  return rows
    .filter((r) => typeof r.body === 'string' && r.body.trim().length > 0)
    .slice(0, limit)
    .map((r) => ({
      type: typeof r.type === 'string' && r.type ? r.type : 'other',
      body: truncate(r.body as string),
      path: pathFromUrl(r.page_url),
      ageLabel: ageLabel(r.created_at, nowMs),
      resolved: r.status === 'done' || r.status === 'wontfix',
    }))
}

// Render the system-prompt block, or null when there's nothing to show. Kept
// next to the summarizer so the wording and the data shape evolve together.
export function renderPrototypeFeedbackBlock(items: PrototypeFeedbackItem[]): string | null {
  if (items.length === 0) return null
  const lines = items.map((it) => {
    const where = it.path ? ` (on ${it.path})` : ''
    const done = it.resolved ? ' [marked resolved]' : ''
    return `- **${it.type}**${where} — ${it.body} _(${it.ageLabel})_${done}`
  })
  return `
## What the maker has reported from the prototype

These are real notes the maker (or their testers) submitted from the running app through the feedback widget — actual signal from the deployed prototype, not guesses. Use them to ground the conversation: reference specific things they reported, and if they ask you to "walk me through the site," draw on these.

You still cannot see the live screen yourself, so don't invent UI details beyond what's reported here or what they tell you. Items marked resolved have been addressed — don't re-raise them as if new.

${lines.join('\n')}
`.trim()
}
