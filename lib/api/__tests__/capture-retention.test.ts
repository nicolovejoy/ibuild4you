import { describe, it, expect } from 'vitest'
import {
  CAPTURE_RETENTION_DAYS,
  captureExpiryCutoffIso,
  selectExpirable,
} from '../capture-retention'

// #72 slice B6 — retention for prototype_context rows. Captures older than the
// retention window get status: 'expired' (a flag, never a delete — house rule).
// The agent query already self-limits to 14 days, so this is belt-and-suspenders
// for the admin/read path.

const NOW = new Date('2026-07-04T12:00:00Z').getTime()
const DAY = 24 * 60 * 60 * 1000

describe('captureExpiryCutoffIso', () => {
  it('is exactly the retention window before now', () => {
    const cutoff = captureExpiryCutoffIso(NOW)
    expect(new Date(cutoff).getTime()).toBe(NOW - CAPTURE_RETENTION_DAYS * DAY)
  })
})

describe('selectExpirable', () => {
  const row = (id: string, ageDays: number, status = 'active') => ({
    id,
    status,
    created_at: new Date(NOW - ageDays * DAY).toISOString(),
  })

  it('selects active rows older than the retention window', () => {
    const ids = selectExpirable([row('old', 31), row('fresh', 5), row('edge', 29)], NOW)
    expect(ids).toEqual(['old'])
  })

  it('skips rows that are already expired', () => {
    const ids = selectExpirable([row('old-expired', 45, 'expired'), row('old-active', 45)], NOW)
    expect(ids).toEqual(['old-active'])
  })

  it('treats a missing status as active (rows predating the field)', () => {
    const ids = selectExpirable([{ id: 'legacy', created_at: row('x', 40).created_at }], NOW)
    expect(ids).toEqual(['legacy'])
  })

  it('skips rows with missing or unparseable created_at (never expire blind)', () => {
    const ids = selectExpirable(
      [
        { id: 'no-date', status: 'active' },
        { id: 'bad-date', status: 'active', created_at: 'not a date' },
      ],
      NOW,
    )
    expect(ids).toEqual([])
  })
})
