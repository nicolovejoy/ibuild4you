import { describe, it, expect } from 'vitest'
import { riskText, riskOwner, normalizeRisks, makerQuestions, carryRiskOwners } from '@/lib/brief/risks'

describe('riskText / riskOwner', () => {
  it('reads both shapes', () => {
    expect(riskText('a')).toBe('a'); expect(riskOwner('a')).toBeUndefined()
    expect(riskText({ text: 'b', owner: 'maker' })).toBe('b'); expect(riskOwner({ text: 'b', owner: 'maker' })).toBe('maker')
  })
})

describe('normalizeRisks', () => {
  it('is the identity on a clean string list', () => {
    expect(normalizeRisks(['a', 'b'])).toEqual(['a', 'b'])
  })
  it('drops empty/non-string/non-object entries', () => {
    expect(normalizeRisks(['a', '', '  ', 42, null, {}, { text: '' }])).toEqual(['a'])
  })
  it('keeps owned objects, collapses ownerless objects to strings', () => {
    expect(normalizeRisks([{ text: 'x', owner: 'maker' }, { text: 'y' }, { text: 'z', owner: 'builder' }]))
      .toEqual([{ text: 'x', owner: 'maker' }, 'y', { text: 'z', owner: 'builder' }])
  })
  it('drops an unknown owner but keeps the text', () => {
    expect(normalizeRisks([{ text: 'x', owner: 'Maker' }, { text: 'y', owner: 42 }])).toEqual(['x', 'y'])
  })
  it('trims text', () => {
    expect(normalizeRisks([' a ', { text: ' b ', owner: 'maker' }])).toEqual(['a', { text: 'b', owner: 'maker' }])
  })
  it('returns [] for non-arrays', () => {
    expect(normalizeRisks(undefined)).toEqual([]); expect(normalizeRisks('a')).toEqual([])
  })
})

describe('makerQuestions', () => {
  it('returns maker-owned texts in order, nothing else', () => {
    const content = { problem: '', target_users: '', features: [], constraints: '', additional_context: '',
      open_risks: ['plain', { text: 'q1', owner: 'maker' as const }, { text: 'b', owner: 'builder' as const }, { text: 'q2', owner: 'maker' as const }] }
    expect(makerQuestions(content)).toEqual(['q1', 'q2'])
    expect(makerQuestions(undefined)).toEqual([])
    expect(makerQuestions({ ...content, open_risks: undefined })).toEqual([])
  })
})

describe('carryRiskOwners', () => {
  it('restores an owner the next list dropped, matching text case/whitespace-insensitively', () => {
    const current = [{ text: 'Pricing model', owner: 'maker' as const }, 'plain']
    expect(carryRiskOwners(current, ['  pricing MODEL ', 'plain', 'new'])).toEqual([
      { text: '  pricing MODEL ', owner: 'maker' }, 'plain', 'new'])
  })
  it('does not override an owner the next list set', () => {
    expect(carryRiskOwners([{ text: 'a', owner: 'maker' }], [{ text: 'a', owner: 'builder' }])).toEqual([{ text: 'a', owner: 'builder' }])
  })
  it('does not carry when the text changed, and handles undefined current', () => {
    expect(carryRiskOwners([{ text: 'a', owner: 'maker' }], ['a!'])).toEqual(['a!'])
    expect(carryRiskOwners(undefined, ['a'])).toEqual(['a'])
  })
})
