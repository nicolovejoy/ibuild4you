import { describe, it, expect } from 'vitest'
import { normalizeShipped, normalizeQueued, isShippedArrayShape, latestShipped } from '../shipped'

describe('normalizeShipped', () => {
  it('keeps a valid batch and trims items', () => {
    expect(normalizeShipped([{ date: '2026-10-17', items: [' A ', 'B'] }])).toEqual([
      { date: '2026-10-17', items: ['A', 'B'] },
    ])
  })
  it('drops bad dates, missing dates and batches with no usable items', () => {
    expect(
      normalizeShipped([
        { date: 'Oct 17', items: ['A'] },
        { items: ['A'] },
        { date: '2026-10-17', items: ['  ', 3] },
        { date: '2026-10-18', items: ['ok', '', 4] },
        'junk',
      ]),
    ).toEqual([{ date: '2026-10-18', items: ['ok'] }])
  })
  it('returns [] for a non-array', () => {
    expect(normalizeShipped('x')).toEqual([])
    expect(normalizeShipped(undefined)).toEqual([])
  })
})

describe('normalizeQueued', () => {
  it('trims and drops blanks and non-strings', () => {
    expect(normalizeQueued([' a ', '', '  ', 5, null, 'b'])).toEqual(['a', 'b'])
    expect(normalizeQueued({})).toEqual([])
  })
})

describe('isShippedArrayShape', () => {
  it('accepts undefined and arrays only', () => {
    expect(isShippedArrayShape(undefined)).toBe(true)
    expect(isShippedArrayShape([])).toBe(true)
    expect(isShippedArrayShape('x')).toBe(false)
    expect(isShippedArrayShape({})).toBe(false)
  })
})

describe('latestShipped', () => {
  const list = [
    { date: '2026-09-01', items: ['a'] },
    { date: '2026-10-17', items: ['b'] },
    { date: '2026-10-01', items: ['c'] },
  ]
  it('returns the n latest by date, newest first', () => {
    expect(latestShipped(list, 2).map((s) => s.date)).toEqual(['2026-10-17', '2026-10-01'])
  })
  it('keeps array order on ties and handles undefined', () => {
    const tie = [
      { date: '2026-10-01', items: ['x'] },
      { date: '2026-10-01', items: ['y'] },
    ]
    expect(latestShipped(tie, 2).map((s) => s.items[0])).toEqual(['x', 'y'])
    expect(latestShipped(undefined, 2)).toEqual([])
  })
})
