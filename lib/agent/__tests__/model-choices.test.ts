import { describe, it, expect } from 'vitest'
import { BRIEF_MODELS, isBriefModel } from '../model-choices'

describe('BRIEF_MODELS', () => {
  it('lists exactly the three selectable chat models', () => {
    expect(BRIEF_MODELS).toEqual(['claude-sonnet-4-6', 'claude-sonnet-5-5', 'claude-opus-5-5'])
  })
})

describe('isBriefModel', () => {
  it('accepts each allowed id', () => {
    for (const m of BRIEF_MODELS) {
      expect(isBriefModel(m)).toBe(true)
    }
  })
  it('rejects blank, null, unknown and wrong-case ids', () => {
    for (const v of ['', null, undefined, 'claude-opus-4-8', 'CLAUDE-SONNET-5-5', 'gpt-4', 42]) {
      expect(isBriefModel(v)).toBe(false)
    }
  })
})
