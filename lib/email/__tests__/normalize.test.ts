import { describe, it, expect } from 'vitest'
import { normalizeEmail } from '../normalize'

// The one canonical email-normalization rule for the codebase: trim + lowercase.
// ~25 sites currently inline `.trim().toLowerCase()`; this is the shared version
// they should converge on (and the fix for the few that forget the .trim()).
describe('normalizeEmail', () => {
  it('lowercases', () => {
    expect(normalizeEmail('Sam@Example.COM')).toBe('sam@example.com')
  })

  it('trims surrounding whitespace', () => {
    expect(normalizeEmail('  sam@example.com  ')).toBe('sam@example.com')
  })

  it('does both together', () => {
    expect(normalizeEmail('\t SAM@Example.com \n')).toBe('sam@example.com')
  })

  it('treats null/undefined as empty string', () => {
    expect(normalizeEmail(null)).toBe('')
    expect(normalizeEmail(undefined)).toBe('')
  })

  it('leaves an already-normal email unchanged', () => {
    expect(normalizeEmail('sam@example.com')).toBe('sam@example.com')
  })
})
