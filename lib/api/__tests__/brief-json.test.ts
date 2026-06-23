import { describe, it, expect } from 'vitest'
import {
  normalizeBriefContent,
  parseBriefJson,
  serializeBriefContent,
  emptyBrief,
} from '../brief-json'
import type { BriefContent } from '@/lib/types'

describe('normalizeBriefContent', () => {
  it('accepts a full valid brief', () => {
    const input = {
      problem: 'p',
      target_users: 't',
      features: ['a', 'b'],
      constraints: 'c',
      additional_context: 'x',
      decisions: [{ topic: 'Pay', decision: 'Stripe', locked: true }],
      open_risks: ['r'],
    }
    const r = normalizeBriefContent(input)
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.value.features).toEqual(['a', 'b'])
      expect(r.value.decisions).toEqual([{ topic: 'Pay', decision: 'Stripe', locked: true }])
      expect(r.value.open_risks).toEqual(['r'])
    }
  })

  it('fills missing optional fields with defaults', () => {
    const r = normalizeBriefContent({ problem: 'only problem' })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.value).toEqual({
        problem: 'only problem',
        target_users: '',
        features: [],
        constraints: '',
        additional_context: '',
        decisions: [],
        open_risks: [],
      })
    }
  })

  it('rejects non-objects', () => {
    expect(normalizeBriefContent(null).ok).toBe(false)
    expect(normalizeBriefContent([1, 2]).ok).toBe(false)
    expect(normalizeBriefContent('str').ok).toBe(false)
  })

  it('rejects features that are not a list of strings', () => {
    expect(normalizeBriefContent({ features: 'nope' }).ok).toBe(false)
    expect(normalizeBriefContent({ features: [1, 2] }).ok).toBe(false)
  })

  it('rejects a decision missing topic/decision', () => {
    expect(normalizeBriefContent({ decisions: [{ topic: 'x' }] }).ok).toBe(false)
    expect(normalizeBriefContent({ decisions: ['nope'] }).ok).toBe(false)
  })

  it('drops the locked flag when not strictly true', () => {
    const r = normalizeBriefContent({ decisions: [{ topic: 't', decision: 'd', locked: false }] })
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.value.decisions).toEqual([{ topic: 't', decision: 'd' }])
  })

  it('filters empty-string list items', () => {
    const r = normalizeBriefContent({ features: ['a', '', '  '], open_risks: ['', 'r'] })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.value.features).toEqual(['a'])
      expect(r.value.open_risks).toEqual(['r'])
    }
  })
})

describe('parseBriefJson', () => {
  it('parses valid JSON text', () => {
    const r = parseBriefJson('{"problem":"p","features":["x"]}')
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.value.features).toEqual(['x'])
  })

  it('errors on invalid JSON', () => {
    const r = parseBriefJson('{not json')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toMatch(/Invalid JSON/)
  })
})

describe('serializeBriefContent', () => {
  it('round-trips through parse', () => {
    const brief: BriefContent = {
      problem: 'p',
      target_users: 't',
      features: ['a'],
      constraints: 'c',
      additional_context: '',
      decisions: [{ topic: 'k', decision: 'v', locked: true }],
      open_risks: ['r'],
    }
    const json = serializeBriefContent(brief)
    const back = parseBriefJson(json)
    expect(back.ok).toBe(true)
    if (back.ok) expect(back.value).toEqual(brief)
  })

  it('emits a stable field order', () => {
    const json = serializeBriefContent(emptyBrief())
    const keys = Object.keys(JSON.parse(json))
    expect(keys).toEqual([
      'problem',
      'target_users',
      'features',
      'constraints',
      'additional_context',
      'decisions',
      'open_risks',
    ])
  })
})
