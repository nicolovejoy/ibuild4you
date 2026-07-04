// #72 slice B6 — retention policy for prototype_context captures. Pure helpers
// (no Firestore) so the selection logic is unit-testable; the cron route at
// app/api/cron/expire-captures queries + batches the updates.
//
// Expiry is a status flag ('expired'), never a delete — house rule. The agent
// prompt query already self-limits to 14 days (lib/agent/prototype-context.ts),
// so this window only governs how long captures stay visible to admin/read
// paths before being flagged.

export const CAPTURE_RETENTION_DAYS = 30

const DAY_MS = 24 * 60 * 60 * 1000

export function captureExpiryCutoffIso(nowMs: number): string {
  return new Date(nowMs - CAPTURE_RETENTION_DAYS * DAY_MS).toISOString()
}

export interface ExpirableCaptureRow {
  id: string
  status?: string
  created_at?: string
}

// Which rows should flip to 'expired'? Active (or legacy status-less) rows
// older than the window. Rows with a missing/unparseable created_at are left
// alone — never expire blind.
export function selectExpirable(rows: ExpirableCaptureRow[], nowMs: number): string[] {
  const cutoffMs = nowMs - CAPTURE_RETENTION_DAYS * DAY_MS
  return rows
    .filter((r) => (r.status ?? 'active') === 'active')
    .filter((r) => {
      if (!r.created_at) return false
      const then = new Date(r.created_at).getTime()
      return !Number.isNaN(then) && then < cutoffMs
    })
    .map((r) => r.id)
}
