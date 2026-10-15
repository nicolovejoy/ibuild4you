import { describe, it, expect } from 'vitest'
import { formatMessageTimestamp, formatRelativeTime, makerCopy } from '../copy-maker'

const now = new Date('2026-10-15T12:00:00Z')
const ago = (ms: number) => new Date(now.getTime() - ms).toISOString()

describe('formatRelativeTime', () => {
  it('formats in English as before', () => {
    expect(formatRelativeTime(ago(10_000), 'en', now)).toBe('just now')
    expect(formatRelativeTime(ago(5 * 60_000), 'en', now)).toBe('5m ago')
    expect(formatRelativeTime(ago(3 * 3_600_000), 'en', now)).toBe('3h ago')
    expect(formatRelativeTime(ago(2 * 86_400_000), 'en', now)).toBe('2d ago')
  })

  it('formats in French', () => {
    expect(formatRelativeTime(ago(10_000), 'fr', now)).toBe('à l’instant')
    expect(formatRelativeTime(ago(5 * 60_000), 'fr', now)).toBe('il y a 5 min')
    expect(formatRelativeTime(ago(3 * 3_600_000), 'fr', now)).toBe('il y a 3 h')
    expect(formatRelativeTime(ago(2 * 86_400_000), 'fr', now)).toBe('il y a 2 j')
    expect(formatRelativeTime(ago(20 * 86_400_000), 'fr', now)).toMatch(/sept\./)
  })
})

describe('makerCopy', () => {
  it('keeps English identical to the strings the app showed before', () => {
    expect(makerCopy.en.dashboard.title).toBe('Your briefs')
    expect(makerCopy.en.login.signInGoogle).toBe('Sign in with Google')
    expect(makerCopy.en.dashboard.features(1)).toBe('1 feature')
    expect(makerCopy.en.dashboard.features(3)).toBe('3 features')
  })

  it('pluralises French counts from 2 up', () => {
    expect(makerCopy.fr.dashboard.features(1)).toBe('1 fonctionnalité')
    expect(makerCopy.fr.dashboard.decisions(2)).toBe('2 décisions')
  })
})

describe('formatMessageTimestamp', () => {
  it('shows only the time for today, in each language', () => {
    const today = new Date('2026-10-15T15:05:00')
    const now = new Date('2026-10-15T18:00:00')
    expect(formatMessageTimestamp(today.toISOString(), 'en', now)).toMatch(/3:05\sPM/)
    expect(formatMessageTimestamp(today.toISOString(), 'fr', now)).toBe('15:05')
  })

  it('adds a short date for older messages', () => {
    const earlier = new Date('2026-10-08T07:53:00')
    const now = new Date('2026-10-15T18:00:00')
    expect(formatMessageTimestamp(earlier.toISOString(), 'en', now)).toMatch(/^Oct 8 /)
    expect(formatMessageTimestamp(earlier.toISOString(), 'fr', now)).toMatch(/^8 oct\. 07:53$/)
  })
})

describe('roles', () => {
  it('keeps the English glossary terms and translates to French', () => {
    expect(makerCopy.en.roles.originator.term).toBe('Originator')
    expect(makerCopy.fr.roles.reviewer.term).toBe('Relecteur')
  })
})
