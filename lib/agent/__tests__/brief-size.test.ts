import { describe, it, expect } from 'vitest'
import { briefRegenCharBudget, briefSizeWarning, regenFailureNotice } from '../brief-size'

// F4FC (2026-10-16): a 25,040-char brief took 8,067 output tokens to rewrite,
// so the cap is measured in characters of brief JSON at ~3 chars per token.
describe('briefRegenCharBudget', () => {
  it('is about 3 chars of brief JSON per output token', () => {
    expect(briefRegenCharBudget(8192)).toBe(24576)
  })
})

describe('briefSizeWarning', () => {
  const sized = (chars: number) => ({ problem: 'x'.repeat(chars) })

  it('is null for a brief well under the budget', () => {
    expect(briefSizeWarning(sized(1000), 8192)).toBeNull()
  })

  it('warns past 80% of what one automatic update can rewrite', () => {
    expect(briefSizeWarning(sized(Math.ceil(24576 * 0.8)), 8192)).toMatch(/automatic update/i)
  })

  it('says it will fail once the brief is over the budget', () => {
    expect(briefSizeWarning(sized(25053), 8192)).toMatch(/will fail/i)
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
