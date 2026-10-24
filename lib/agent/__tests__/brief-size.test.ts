import { describe, it, expect } from 'vitest'
import { briefRegenCharBudget, briefSizeWarning, regenFailureNotice } from '../brief-size'

// F4FC: a 25,040-char brief took 8,067 output tokens to rewrite (2026-10-16)
// and a 34,726-char one took 11,903 (2026-10-19), so the cap is measured in
// characters of brief JSON at 2.9 chars per token.
describe('briefRegenCharBudget', () => {
  it('is 2.9 chars of brief JSON per output token, rounded down', () => {
    expect(briefRegenCharBudget(8192)).toBe(23756)
  })

  it('would have flagged the 2026-10-19 F4FC brief as near the 12,000-token cap', () => {
    // 34,726 chars used 11,903 of 12,000 tokens. At 2.9 the budget is 34,800,
    // so the brief reads as 74 chars from failing; the old 3 chars/token
    // estimate (36,000) claimed 1,274 chars of headroom.
    expect(briefRegenCharBudget(12_000)).toBe(34_800)
    expect(briefSizeWarning({ problem: 'x'.repeat(34_726 - 14) }, 12_000)).toMatch(/may fail/i)
  })
})

describe('briefSizeWarning', () => {
  const sized = (chars: number) => ({ problem: 'x'.repeat(chars) })

  it('is null for a brief well under the budget', () => {
    expect(briefSizeWarning(sized(1000), 8192)).toBeNull()
  })

  it('warns past 80% of what one automatic update can rewrite', () => {
    expect(briefSizeWarning(sized(Math.ceil(23756 * 0.8)), 8192)).toMatch(/automatic update/i)
  })

  it('says it will fail once the brief is over the budget', () => {
    expect(briefSizeWarning(sized(23757), 8192)).toMatch(/will fail/i)
  })
})

describe('regenFailureNotice', () => {
  const failed = {
    brief_regen_last_error: 'regenerate_brief_max_tokens',
    brief_regen_last_error_at: '2026-10-18T01:50:50.369Z',
  }

  it('is null when nothing failed', () => {
    expect(regenFailureNotice({}, '2026-10-16T06:48:34.758Z')).toBeNull()
  })

  it('reports a failure newer than the live brief, naming the too-large cause', () => {
    const notice = regenFailureNotice(failed, '2026-10-16T06:48:34.758Z')
    expect(notice).toMatch(/too large/i)
  })

  it('reports other failures generically', () => {
    const notice = regenFailureNotice(
      { ...failed, brief_regen_last_error: 'regenerate_brief_no_tool_use' },
      '2026-10-16T06:48:34.758Z',
    )
    expect(notice).not.toBeNull()
    expect(notice).not.toMatch(/too large/i)
  })

  it('is null once a paste or regen has refreshed the brief after the failure', () => {
    expect(regenFailureNotice(failed, '2026-10-18T02:34:53.135Z')).toBeNull()
  })
})
