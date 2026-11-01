import { describe, it, expect } from 'vitest'
import { parseReadLimit, READ_LIMIT_DEFAULT, READ_LIMIT_MAX } from '../limits'

describe('parseReadLimit', () => {
  it('defaults when missing or non-numeric', () => {
    expect(parseReadLimit(null)).toBe(READ_LIMIT_DEFAULT)
    expect(parseReadLimit('abc')).toBe(20)
    expect(parseReadLimit('')).toBe(20)
  })

  it('clamps to 1..50 and drops fractions', () => {
    expect(parseReadLimit('0')).toBe(1)
    expect(parseReadLimit('-5')).toBe(1)
    expect(parseReadLimit('999')).toBe(READ_LIMIT_MAX)
    expect(parseReadLimit('2.7')).toBe(2)
    expect(parseReadLimit('30')).toBe(30)
  })
})
