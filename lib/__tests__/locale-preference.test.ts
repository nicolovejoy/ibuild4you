import { describe, it, expect } from 'vitest'
import { readLocaleCookie, localeCookie, resolveLocale } from '../locale-preference'

describe('readLocaleCookie', () => {
  it('reads the locale cookie among others', () => {
    expect(readLocaleCookie('a=1; locale=fr; b=2')).toBe('fr')
    expect(readLocaleCookie('locale=en')).toBe('en')
  })

  it('ignores a missing or unsupported value', () => {
    expect(readLocaleCookie('')).toBeNull()
    expect(readLocaleCookie('locale=de')).toBeNull()
    expect(readLocaleCookie('xlocale=fr')).toBeNull()
  })
})

describe('localeCookie', () => {
  it('is site-wide, long-lived and Lax', () => {
    const c = localeCookie('fr')
    expect(c).toMatch(/^locale=fr;/)
    expect(c).toContain('Path=/')
    expect(c).toContain('SameSite=Lax')
    expect(c).toMatch(/Max-Age=\d+/)
  })
})

describe('resolveLocale', () => {
  it('prefers the saved profile, then the cookie, then the brief, then English', () => {
    expect(resolveLocale({ user: 'fr', cookie: 'en', brief: 'en' })).toBe('fr')
    expect(resolveLocale({ user: null, cookie: 'fr', brief: 'en' })).toBe('fr')
    expect(resolveLocale({ user: null, cookie: null, brief: 'fr' })).toBe('fr')
    expect(resolveLocale({ user: null, cookie: null, brief: null })).toBe('en')
  })

  it('lets an explicit ?lang= override everything', () => {
    expect(resolveLocale({ query: 'en', user: 'fr', cookie: 'fr', brief: 'fr' })).toBe('en')
  })

  it('ignores unsupported values at every level', () => {
    expect(resolveLocale({ query: 'de', user: 'xx', cookie: null, brief: 'fr' })).toBe('fr')
  })
})
