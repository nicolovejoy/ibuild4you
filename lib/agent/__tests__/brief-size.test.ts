import { describe, it, expect } from 'vitest'
import { BRIEF_CHAR_BUDGET, briefSizeWarning, regenFailureNotice } from '../brief-size'

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
