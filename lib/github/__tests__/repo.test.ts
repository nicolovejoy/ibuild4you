import { describe, it, expect } from 'vitest'
import { normalizeGithubRepo, reposMatch } from '../repo'

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
