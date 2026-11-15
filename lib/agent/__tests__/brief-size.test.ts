import { describe, it, expect } from 'vitest'
import { BRIEF_CHAR_BUDGET, briefSizeChars, briefSizeWarning, regenFailureNotice } from '../brief-size'

describe('briefSizeWarning', () => {
  // JSON.stringify({ problem: 'x'.repeat(n) }) is n + 14 chars.
  const sized = (chars: number) => ({ problem: 'x'.repeat(chars - 14) })

  it('has a 20,000-char budget', () => {
    expect(BRIEF_CHAR_BUDGET).toBe(20000)
  })

  it('is null below 16000 chars', () => {
    expect(briefSizeWarning(sized(15_999))).toBeNull()
  })

  it('warns at 16000 chars', () => {
    expect(briefSizeWarning(sized(16_000))).toMatch(/close to/i)
  })

  it('gives the over-budget line above 20000 and says it still saves', () => {
    expect(briefSizeWarning(sized(20_001))).toMatch(/over the 20,000/i)
  })

  // The app carries decision provenance itself and no agent reads it, so the
  // stamps do not count toward the curation budget.
  it('does not count decision provenance stamps', () => {
    const stamps = {
      decided_in_session: 'a'.repeat(20),
      decided_at: '2026-10-12T00:00:00.000Z',
      revised_in_session: 'b'.repeat(20),
      revised_at: '2026-11-01T00:00:00.000Z',
    }
    const bareDecisions = Array.from({ length: 40 }, (_, i) => ({ topic: `T${i}`, decision: 'd' }))
    const bare = { problem: 'x'.repeat(14_000), decisions: bareDecisions }
    const stamped = { problem: 'x'.repeat(14_000), decisions: bareDecisions.map((d) => ({ ...d, ...stamps })) }
    expect(JSON.stringify(stamped).length).toBeGreaterThan(BRIEF_CHAR_BUDGET)
    expect(briefSizeChars(stamped)).toBe(JSON.stringify(bare).length)
    expect(briefSizeWarning(stamped)).toBeNull()
  })

  it('sizes a brief with no decisions, and a missing brief, without throwing', () => {
    expect(briefSizeChars({ problem: 'x' })).toBe(JSON.stringify({ problem: 'x' }).length)
    expect(briefSizeChars(null)).toBe(2)
    expect(briefSizeChars({ decisions: 'not a list' })).toBe(JSON.stringify({ decisions: 'not a list' }).length)
  })
})

describe('regenFailureNotice', () => {
  const failed = {
    brief_regen_last_error: 'write_note_max_tokens',
    brief_regen_last_error_at: '2026-10-18T01:50:50.369Z',
  }

  it('is null when nothing failed', () => {
    expect(regenFailureNotice({}, '2026-10-16T06:48:34.758Z')).toBeNull()
  })

  it('reports a failure newer than the live brief, naming the out-of-room cause', () => {
    const notice = regenFailureNotice(failed, '2026-10-16T06:48:34.758Z')
    expect(notice).toMatch(/ran out of room/i)
  })

  it('reports other failures generically', () => {
    const notice = regenFailureNotice(
      { ...failed, brief_regen_last_error: 'write_note_no_tool_use' },
      '2026-10-16T06:48:34.758Z',
    )
    expect(notice).not.toBeNull()
    expect(notice).not.toMatch(/ran out of room/i)
  })

  it('is null once a paste has refreshed the brief after the failure', () => {
    expect(regenFailureNotice(failed, '2026-10-18T02:34:53.135Z')).toBeNull()
  })
})
