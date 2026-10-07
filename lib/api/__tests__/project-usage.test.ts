import { describe, it, expect } from 'vitest'
import { labelSessions } from '../project-usage'
import { NO_SESSION_KEY, type SessionTotals } from '../usage-rollup'

const totals = (key: string, first = '2026-10-01T00:00:00.000Z'): SessionTotals => ({
  key, calls: 1, cost: 0.01, input: 1, output: 1, cache_read: 0, cache_create: 0,
  first_call_at: first, last_call_at: first,
})

describe('labelSessions', () => {
  const sessions = [
    { id: 's2', created_at: '2026-10-02T00:00:00.000Z' },
    { id: 's1', created_at: '2026-10-01T00:00:00.000Z' },
    { id: 's3', created_at: '2026-10-03T00:00:00.000Z' },
  ]

  it('numbers conversations from the oldest session regardless of input order', () => {
    const out = labelSessions([totals('s3'), totals('s1')], sessions)
    expect(out.map((o) => [o.key, o.number, o.label])).toEqual([
      ['s3', 3, 'Conversation 3'],
      ['s1', 1, 'Conversation 1'],
    ])
    expect(out[1].session_created_at).toBe('2026-10-01T00:00:00.000Z')
  })

  it('labels the no-session bucket', () => {
    const [o] = labelSessions([totals(NO_SESSION_KEY)], sessions)
    expect(o.label).toBe('Brief updates & other')
    expect(o.number).toBeNull()
    expect(o.session_created_at).toBeNull()
  })

  it('does not crash on a session id that no longer exists', () => {
    const [o] = labelSessions([totals('gone')], sessions)
    expect(o.label).toBe('Conversation (removed)')
    expect(o.number).toBeNull()
  })
})
