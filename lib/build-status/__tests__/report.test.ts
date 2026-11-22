import { describe, it, expect } from 'vitest'
import { validateReport, reportBodyHash } from '../report'

const good = {
  live: [{ what: 'Bar ranges', checked: 'commit a1b2c3d on l6music.app, page loads' }],
  merged: ['Two-game split, PR 88'],
  proposed: [],
  questions: [],
}

describe('validateReport', () => {
  it('accepts a good report unchanged', () => {
    expect(validateReport(good)).toEqual({ ok: true, report: good })
  })

  it('trims strings and drops unknown fields', () => {
    expect(validateReport({ ...good, extra: 1, merged: ['  x  '] })).toEqual({
      ok: true,
      report: { ...good, merged: ['x'] },
    })
  })

  it('treats a missing list as an empty list', () => {
    expect(validateReport({ merged: ['x'] })).toEqual({
      ok: true,
      report: { live: [], merged: ['x'], proposed: [], questions: [] },
    })
  })

  it('rejects a live item without checked, or with only spaces', () => {
    expect(validateReport({ live: [{ what: 'A', checked: '   ' }] })).toEqual({
      ok: false,
      error: 'live[0] has no "checked". Say what was checked in production, or move it to "merged".',
    })
  })

  it('rejects a report whose four lists are all empty', () => {
    expect(validateReport({ live: [], merged: [] })).toEqual({
      ok: false,
      error: 'The report is empty. At least one of live, merged, proposed, questions needs an item.',
    })
  })

  it('rejects a list of 31 items', () => {
    expect(validateReport({ merged: Array(31).fill('x') })).toEqual({
      ok: false,
      error: 'merged has 31 items; the limit is 30.',
    })
  })

  it('rejects a 501-character string', () => {
    expect(validateReport({ merged: ['x'.repeat(501)] })).toEqual({
      ok: false,
      error: 'merged[0] is 501 characters; the limit is 500.',
    })
  })

  it('rejects a report of 4,500 characters in total', () => {
    expect(validateReport({ merged: Array(9).fill('x'.repeat(500)) })).toEqual({
      ok: false,
      error: 'The report is 4500 characters; the limit is 4000.',
    })
  })

  it('rejects a body that is not an object', () => {
    expect(validateReport(null).ok).toBe(false)
  })

  it('rejects a list that is not a list', () => {
    expect(validateReport({ merged: 'x' })).toEqual({ ok: false, error: 'merged must be a list.' })
  })

  it('rejects an item that is not a non-empty string', () => {
    expect(validateReport({ merged: [3] })).toEqual({
      ok: false,
      error: 'merged[0] must be a non-empty string.',
    })
  })

  it('rejects a live item that is not { what, checked }', () => {
    expect(validateReport({ live: ['x'] })).toEqual({
      ok: false,
      error: 'live[0] must be { "what", "checked" }.',
    })
  })
})

// try_it: optional on a live item, what the maker can do to try it.
describe('validateReport, try_it on a live item', () => {
  const withTry = (try_it: unknown) => ({
    live: [{ what: 'Bar ranges', checked: 'page loads on prod', try_it }],
  })

  it('keeps a try_it, trimmed', () => {
    const result = validateReport(withTry('  Open Practice and tap Bars.  '))
    expect(result).toEqual({
      ok: true,
      report: {
        live: [{ what: 'Bar ranges', checked: 'page loads on prod', try_it: 'Open Practice and tap Bars.' }],
        merged: [],
        proposed: [],
        questions: [],
      },
    })
  })

  it('leaves the key out when try_it is missing, null or only spaces', () => {
    for (const value of [undefined, null, '   ']) {
      const result = validateReport(withTry(value))
      expect(result.ok && 'try_it' in result.report.live[0]).toBe(false)
    }
  })

  it('rejects a try_it that is not a string', () => {
    expect(validateReport(withTry(['step 1']))).toEqual({
      ok: false,
      error: 'live[0].try_it must be a string: what the maker can do to try it.',
    })
  })

  it('holds try_it to the per-string limit and names the item', () => {
    const report = {
      live: [
        { what: 'A', checked: 'ok' },
        { what: 'B', checked: 'ok', try_it: 'x'.repeat(501) },
      ],
    }
    expect(validateReport(report)).toEqual({
      ok: false,
      error: 'live[1] is 501 characters; the limit is 500.',
    })
  })

  it('counts try_it toward the total', () => {
    const live = Array.from({ length: 9 }, () => ({ what: 'A', checked: 'ok', try_it: 'x'.repeat(450) }))
    const result = validateReport({ live })
    expect(result.ok).toBe(false)
    expect(!result.ok && result.error).toMatch(/^The report is \d+ characters; the limit is 4000\.$/)
  })
})

describe('reportBodyHash', () => {
  it('is the same as before for a report with no try_it', () => {
    // Pinned so reports stored before try_it existed still match a retry.
    expect(reportBodyHash(good)).toBe(reportBodyHash({ ...good, live: good.live.map((l) => ({ ...l })) }))
    expect(JSON.stringify(good.live[0])).not.toContain('try_it')
  })

  it('changes when a try_it is added or changed', () => {
    const a = { ...good, live: [{ ...good.live[0], try_it: 'Tap Bars.' }] }
    const b = { ...good, live: [{ ...good.live[0], try_it: 'Tap Ranges.' }] }
    expect(reportBodyHash(a)).not.toBe(reportBodyHash(good))
    expect(reportBodyHash(a)).not.toBe(reportBodyHash(b))
  })

  it('is stable for the same body', () => {
    expect(reportBodyHash(good)).toBe(reportBodyHash({ ...good }))
  })

  it('changes when any list changes', () => {
    expect(reportBodyHash(good)).not.toBe(reportBodyHash({ ...good, merged: [] }))
  })
})
