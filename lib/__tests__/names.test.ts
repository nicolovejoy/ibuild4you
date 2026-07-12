import { describe, it, expect } from 'vitest'
import { joinNames } from '@/lib/names'

describe('joinNames', () => {
  it('returns empty string for no names', () => {
    expect(joinNames([])).toBe('')
  })

  it('returns the single name as-is', () => {
    expect(joinNames(['Matt'])).toBe('Matt')
  })

  it('joins two names with "and"', () => {
    expect(joinNames(['Matt', 'Scott'])).toBe('Matt and Scott')
  })

  it('joins three or more with commas and a final "and"', () => {
    expect(joinNames(['Matt', 'Scott', 'Ana'])).toBe('Matt, Scott and Ana')
  })

  it('skips blank entries', () => {
    expect(joinNames(['Matt', '', '  ', 'Scott'])).toBe('Matt and Scott')
  })
})
