import { describe, it, expect } from 'vitest'
import { isSelfRow } from '../self'

describe('isSelfRow', () => {
  it('matches case-insensitively', () => {
    expect(isSelfRow('Nico@Me.com', 'nico@me.com')).toBe(true)
  })
  it('is false for someone else', () => {
    expect(isSelfRow('danny@example.com', 'nico@me.com')).toBe(false)
  })
  it('is false when either side is missing or empty', () => {
    expect(isSelfRow(undefined, 'nico@me.com')).toBe(false)
    expect(isSelfRow('nico@me.com', null)).toBe(false)
    expect(isSelfRow('', '')).toBe(false)
  })
})
