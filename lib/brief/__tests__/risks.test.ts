import { describe, it, expect } from 'vitest'
import type { BriefContent } from '@/lib/types'
import {
  riskText,
  riskOwner,
  normalizeRisks,
  makerQuestions,
  carryRiskOwners,
  resolvedText,
  resolvedAnswer,
  normalizeResolvedRisks,
} from '@/lib/brief/risks'

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

describe('makerQuestions hardening', () => {
  const base = { problem: '', target_users: '', features: [], constraints: '', additional_context: '', decisions: [] } as unknown as BriefContent
  it('tolerates null elements', () => {
    expect(makerQuestions({ ...base, open_risks: [null, 'x', { text: 'q', owner: 'maker' }] as unknown as BriefContent['open_risks'] })).toEqual(['q'])
  })
  it('tolerates a non-array', () => {
    expect(makerQuestions({ ...base, open_risks: 'oops' as unknown as BriefContent['open_risks'] })).toEqual([])
  })
})

// A settled risk used to be its text only, so the answer was lost ("Start over
// button?" closed with nothing saying what the maker chose).
describe('settled risks', () => {
  it('reads the text and the answer from either shape', () => {
    expect(resolvedText('Hosting')).toBe('Hosting')
    expect(resolvedAnswer('Hosting')).toBeUndefined()
    const r = { text: 'Start over button?', resolution: 'Yes, on the results page' }
    expect(resolvedText(r)).toBe('Start over button?')
    expect(resolvedAnswer(r)).toBe('Yes, on the results page')
  })

  it('normalizes untrusted input: trims, drops empties, collapses an answerless object to its text', () => {
    expect(
      normalizeResolvedRisks([
        '  Hosting  ',
        '',
        { text: ' Start over button? ', resolution: ' Yes ' },
        { text: 'No answer given' },
        { text: 'Blank answer', resolution: '   ' },
        { resolution: 'orphan' },
        null,
        7,
      ])
    ).toEqual(['Hosting', { text: 'Start over button?', resolution: 'Yes' }, 'No answer given', 'Blank answer'])
    expect(normalizeResolvedRisks(undefined)).toEqual([])
  })
})
