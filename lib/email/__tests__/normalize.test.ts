import { describe, it, expect } from 'vitest'
import { normalizeEmail, isValidEmail } from '../normalize'

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

// Shape check for anything written to approved_emails / project_members. Garm
// rejects malformed addresses with a 400, so a junk row became an hourly
// reconcile error that could never heal (PR H found two: a "<note: …>"
// placeholder and a "name@gmail" typo).
describe('isValidEmail', () => {
  it('accepts ordinary addresses, including plus-addressing', () => {
    expect(isValidEmail('sam@example.com')).toBe(true)
    expect(isValidEmail('sam+brief@example.co.uk')).toBe(true)
  })

  it('accepts surrounding whitespace and case (validates the normalized form)', () => {
    expect(isValidEmail('  Sam@Example.com ')).toBe(true)
  })

  it('rejects a missing top-level domain', () => {
    expect(isValidEmail('sam@gmail')).toBe(false)
  })

  it('rejects a bracketed note with no address', () => {
    expect(isValidEmail("<placeholder: don't email>")).toBe(false)
  })

  it('rejects inner whitespace, a missing @, and empty input', () => {
    expect(isValidEmail('sam smith@example.com')).toBe(false)
    expect(isValidEmail('example.com')).toBe(false)
    expect(isValidEmail('')).toBe(false)
    expect(isValidEmail(null)).toBe(false)
  })

  it('rejects a display-name form', () => {
    expect(isValidEmail('Sam <sam@example.com>')).toBe(false)
  })
})
