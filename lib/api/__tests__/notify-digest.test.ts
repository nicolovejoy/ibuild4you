import { describe, it, expect } from 'vitest'
import { buildDigest, type DigestItem } from '../notify-digest'

const item = (over: Partial<DigestItem> = {}): DigestItem => ({
  title: 'Sam Cafe App',
  url: 'https://ibuild4you.com/projects/sam-cafe',
  makerName: 'Sam',
  pendingSince: '2026-06-15T12:00:00.000Z',
  ...over,
})

describe('buildDigest', () => {
  it('returns null when nothing is pending', () => {
    expect(buildDigest([])).toBeNull()
  })

  it('uses singular subject + lede for one brief', () => {
    const d = buildDigest([item()])!
    expect(d.subject).toBe('1 brief has new messages')
    expect(d.text).toContain('This brief has new messages waiting for you:')
  })

  it('uses plural subject + lede with the count for multiple briefs', () => {
    const d = buildDigest([item(), item({ title: 'Owen Music', makerName: 'Owen' })])!
    expect(d.subject).toBe('2 briefs have new messages')
    expect(d.text).toContain('These briefs have new messages waiting for you:')
  })

  it('lists each brief with title, maker, link, and a Pacific since-time', () => {
    const d = buildDigest([item()])!
    expect(d.text).toContain('"Sam Cafe App" — from Sam')
    expect(d.text).toContain('https://ibuild4you.com/projects/sam-cafe')
    expect(d.text).toContain('(since Jun 15, 2026, 5:00 AM PDT)')
    expect(d.text).not.toContain('2026-06-15T12:00:00.000Z')
  })

  it('omits the since clause when pendingSince is absent or unparseable', () => {
    expect(buildDigest([item({ pendingSince: null })])!.text).not.toContain('since')
    expect(buildDigest([item({ pendingSince: 'garbage' })])!.text).not.toContain('since')
    expect(buildDigest([item({ pendingSince: 'garbage' })])!.text).not.toContain('Invalid')
  })

  it('ships an HTML body with each brief as a clickable link', () => {
    const d = buildDigest([
      item(),
      item({ title: 'Owen Music', url: 'https://ibuild4you.com/projects/owen', makerName: 'Owen' }),
    ])!
    expect(d.html).toContain('<a href="https://ibuild4you.com/projects/sam-cafe"')
    expect(d.html).toContain('<a href="https://ibuild4you.com/projects/owen"')
    expect(d.html.match(/<li[ >]/g)?.length).toBe(2)
  })
})
