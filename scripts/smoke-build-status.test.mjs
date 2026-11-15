import { describe, it, expect, vi } from 'vitest'
import { bypassFor, isProdBase, parseArgs } from './smoke-build-status.mjs'

// The bypass token is never read here: bypassFor takes the reader as an argument.
describe('smoke-build-status: production guard and bypass header', () => {
  it('treats ibuild4you.com and www.ibuild4you.com as production', () => {
    expect(isProdBase('https://ibuild4you.com')).toBe(true)
    expect(isProdBase('https://www.ibuild4you.com')).toBe(true)
    expect(isProdBase('https://IBUILD4YOU.com')).toBe(true)
    expect(isProdBase('https://preview.ibuild4you.com')).toBe(false)
    expect(isProdBase('http://localhost:3000')).toBe(false)
  })

  it('sends the bypass token only to a *.ibuild4you.com preview or a *.vercel.app host', () => {
    const read = vi.fn(() => 'token-value\n')
    expect(bypassFor('https://preview.ibuild4you.com', read)).toBe('token-value')
    expect(bypassFor('https://ibuild4you-git-x.vercel.app', read)).toBe('token-value')
    expect(read).toHaveBeenCalledTimes(2)
  })

  it('never reads or sends the bypass token for production or any other host', () => {
    const read = vi.fn(() => 'token-value')
    for (const base of [
      'https://ibuild4you.com',
      'https://www.ibuild4you.com',
      'http://localhost:3000',
      'https://example.com',
      'https://evilibuild4you.com',
      'https://vercel.app.example.com',
    ]) {
      expect(bypassFor(base, read)).toBeNull()
    }
    expect(read).not.toHaveBeenCalled()
  })

  it('parses --allow-prod as a flag with no value', () => {
    expect(parseArgs(['--base', 'https://ibuild4you.com', '--allow-prod', '--repo', 'a/b'])).toEqual({
      base: 'https://ibuild4you.com',
      'allow-prod': true,
      repo: 'a/b',
    })
    expect(parseArgs(['--repo', 'a/b'])['allow-prod']).toBeUndefined()
    expect(() => parseArgs(['--repo'])).toThrow('--repo needs a value')
  })
})
