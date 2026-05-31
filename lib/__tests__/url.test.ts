import { describe, it, expect, afterEach, vi } from 'vitest'
import { getProjectShareLink } from '../url'

describe('getProjectShareLink', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('prefers the slug', () => {
    vi.stubGlobal('window', { location: { origin: 'https://ibuild4you.com' } })
    expect(getProjectShareLink('my-slug', 'abc123')).toBe(
      'https://ibuild4you.com/projects/my-slug'
    )
  })

  it('falls back to the id when slug is undefined', () => {
    vi.stubGlobal('window', { location: { origin: 'https://ibuild4you.com' } })
    expect(getProjectShareLink(undefined, 'abc123')).toBe(
      'https://ibuild4you.com/projects/abc123'
    )
  })

  it('returns empty string when there is no window (SSR)', () => {
    vi.stubGlobal('window', undefined)
    expect(getProjectShareLink('my-slug', 'abc123')).toBe('')
  })
})
