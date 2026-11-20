import { describe, it, expect } from 'vitest'
import { mintEmailInAddress, randomTail, projectAddressesIn } from '../address'

describe('mintEmailInAddress', () => {
  it('joins slug, tail and the inbox host', () => {
    expect(mintEmailInAddress('musicforge', '7k2q')).toBe('musicforge-7k2q@inbox.ibuild4you.com')
  })

  it('cleans a raw slug', () => {
    expect(mintEmailInAddress('Bill’s  App!', 'ab23')).toBe('bills-app-ab23@inbox.ibuild4you.com')
  })

  it('uses "project" when the slug is missing or empty', () => {
    expect(mintEmailInAddress(undefined, 'ab23')).toBe('project-ab23@inbox.ibuild4you.com')
    expect(mintEmailInAddress('', 'ab23')).toBe('project-ab23@inbox.ibuild4you.com')
    expect(mintEmailInAddress('!!!', 'ab23')).toBe('project-ab23@inbox.ibuild4you.com')
  })

  it('cuts the slug to 40 characters without leaving a trailing hyphen', () => {
    const long = `${'a'.repeat(39)}-bbbbbb`
    expect(mintEmailInAddress(long, 'ab23')).toBe(`${'a'.repeat(39)}-ab23@inbox.ibuild4you.com`)
    expect(mintEmailInAddress('a'.repeat(60), 'ab23')).toBe(`${'a'.repeat(40)}-ab23@inbox.ibuild4you.com`)
  })

  it('collapses repeated hyphens and trims them from both ends', () => {
    expect(mintEmailInAddress('--my--app--', 'ab23')).toBe('my-app-ab23@inbox.ibuild4you.com')
  })
})

describe('randomTail', () => {
  it('is 4 characters from the no-look-alike alphabet', () => {
    for (let i = 0; i < 50; i++) {
      expect(randomTail()).toMatch(/^[abcdefghjkmnpqrstuvwxyz23456789]{4}$/)
    }
  })
})

describe('projectAddressesIn', () => {
  it('returns distinct normalized project addresses, skipping feedback+ ones', () => {
    expect(
      projectAddressesIn([
        ['Nico <n@x.com>'],
        'MusicForge-7k2q@inbox.ibuild4you.com, feedback+abc@inbox.ibuild4you.com',
        undefined,
      ]),
    ).toEqual(['musicforge-7k2q@inbox.ibuild4you.com'])
  })

  it('ignores other hosts', () => {
    expect(projectAddressesIn(['a@evil.com'])).toEqual([])
  })

  it('handles the Name <addr> form and removes duplicates', () => {
    expect(
      projectAddressesIn([
        'Project <a-1234@inbox.ibuild4you.com>',
        ['a-1234@INBOX.ibuild4you.com', 'b-5678@inbox.ibuild4you.com'],
      ]),
    ).toEqual(['a-1234@inbox.ibuild4you.com', 'b-5678@inbox.ibuild4you.com'])
  })
})
