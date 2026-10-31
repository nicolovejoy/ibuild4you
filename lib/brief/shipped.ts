// Shipped batches and the queue on a brief (#219).
//
// shipped: dated batches of things already built, { date: 'YYYY-MM-DD', items }.
// queued: plain strings, things not built yet. Both are optional on a brief.
// Untrusted input (pasted JSON, model output) is coerced here; malformed
// entries are dropped, not rejected, the same way open_risks works.
import type { BriefShipped } from '@/lib/types'

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

function cleanStrings(raw: unknown): string[] {
  if (!Array.isArray(raw)) return []
  return raw
    .filter((s): s is string => typeof s === 'string')
    .map((s) => s.trim())
    .filter((s) => s !== '')
}

export function normalizeShipped(raw: unknown): BriefShipped[] {
  if (!Array.isArray(raw)) return []
  const out: BriefShipped[] = []
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue
    const { date, items } = entry as { date?: unknown; items?: unknown }
    if (typeof date !== 'string' || !DATE_RE.test(date.trim())) continue
    const cleaned = cleanStrings(items)
    if (cleaned.length === 0) continue
    out.push({ date: date.trim(), items: cleaned })
  }
  return out
}

export function normalizeQueued(raw: unknown): string[] {
  return cleanStrings(raw)
}

// A present field must be a list; undefined is fine.
export function isShippedArrayShape(v: unknown): boolean {
  return v === undefined || Array.isArray(v)
}

// The n most recent batches by date (newest first). Array order breaks ties.
export function latestShipped(list: BriefShipped[] | undefined, n: number): BriefShipped[] {
  return [...(list ?? [])].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0)).slice(0, n)
}
