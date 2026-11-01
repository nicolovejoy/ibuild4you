import { describe, it, expect } from 'vitest'
import { platformFromUserAgent, summarize, SUMMARY_MAX } from '../read-format'

describe('platformFromUserAgent', () => {
  it.each([
    [
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Safari/604.1',
      'ios',
    ],
    ['Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Safari/604.1', 'ios'],
    [
      'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/120 Mobile Safari/537.36',
      'android',
    ],
    ['Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Safari/605.1.15', 'mac'],
    ['Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120', 'windows'],
    ['Mozilla/5.0 (X11; Linux x86_64) Firefox/120', 'linux'],
    ['Mozilla/5.0 (X11; CrOS x86_64 14541.0.0) Chrome/120', 'other'],
    ['', 'other'],
    [undefined, 'other'],
    [null, 'other'],
    ['e2e-loop-apps/1.0', 'other'],
  ])('%s -> %s', (ua, expected) => {
    expect(platformFromUserAgent(ua as string | null | undefined)).toBe(expected)
  })

  it('is case-insensitive', () => {
    expect(platformFromUserAgent('IPHONE')).toBe('ios')
  })
})

describe('summarize', () => {
  it('takes the first non-empty line, trimmed', () => {
    expect(summarize('\n\n  Footer 404s  \nmore')).toBe('Footer 404s')
  })
  it('truncates long lines to 140 with an ellipsis', () => {
    const out = summarize('x'.repeat(200))
    expect(out).toHaveLength(SUMMARY_MAX)
    expect(out.endsWith('…')).toBe(true)
    expect(out.slice(0, 139)).toBe('x'.repeat(139))
  })
  it('leaves exactly 140 chars unchanged', () => {
    const s = 'y'.repeat(140)
    expect(summarize(s)).toBe(s)
  })
  it('returns empty for blank or missing input', () => {
    expect(summarize('   \n  ')).toBe('')
    expect(summarize(undefined)).toBe('')
  })
  it('handles CRLF', () => {
    expect(summarize('a\r\nb')).toBe('a')
  })
  it('returns empty for a non-string body', () => {
    expect(summarize(42)).toBe('')
    expect(summarize({ text: 'hi' })).toBe('')
    expect(summarize(['a@b.co'])).toBe('')
  })
  it('redacts an email mid-line', () => {
    expect(summarize('Please email me at sam.lee+loop@example.com about this')).toBe(
      'Please email me at [email] about this'
    )
  })
  it('redacts two emails', () => {
    expect(summarize('cc a@b.co and <dana@cafe.example.org>')).toBe('cc [email] and <[email]>')
  })
  it('redacts before truncating, so a straddling email never leaks a fragment', () => {
    const line = 'x'.repeat(130) + ' someone@example.com tail'
    const out = summarize(line)
    expect(out).toHaveLength(SUMMARY_MAX)
    expect(out).not.toContain('@')
    expect(out).not.toContain('someone')
    expect(out.startsWith('x'.repeat(130) + ' [email')).toBe(true)
  })
})
