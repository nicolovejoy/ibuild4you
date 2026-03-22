import { describe, it, expect } from 'vitest'
import { validateMockup, moveSection, parseJsonMockup } from '../MockupEditor'
import type { WireframeSection } from '@/lib/types'

const section = (overrides: Partial<WireframeSection> = {}): WireframeSection => ({
  type: 'text',
  label: 'About',
  description: 'About section',
  ...overrides,
})

describe('validateMockup', () => {
  it('returns error when title is empty', () => {
    const result = validateMockup('', [section()])
    expect(result).toBe('Title is required')
  })

  it('returns error when title is only whitespace', () => {
    const result = validateMockup('   ', [section()])
    expect(result).toBe('Title is required')
  })

  it('returns error when sections array is empty', () => {
    const result = validateMockup('My Layout', [])
    expect(result).toBe('Add at least one section')
  })

  it('returns error when a section has no label', () => {
    const result = validateMockup('My Layout', [section({ label: '' })])
    expect(result).toBe('Every section needs a label')
  })

  it('returns error when a section label is whitespace-only', () => {
    const result = validateMockup('My Layout', [section({ label: '  ' })])
    expect(result).toBe('Every section needs a label')
  })

  it('returns null for a valid mockup', () => {
    const result = validateMockup('My Layout', [section(), section({ type: 'hero', label: 'Welcome' })])
    expect(result).toBeNull()
  })
})

describe('moveSection', () => {
  const sections: WireframeSection[] = [
    section({ label: 'A' }),
    section({ label: 'B' }),
    section({ label: 'C' }),
  ]

  it('moves a section up', () => {
    const result = moveSection(sections, 1, 'up')
    expect(result.map((s) => s.label)).toEqual(['B', 'A', 'C'])
  })

  it('moves a section down', () => {
    const result = moveSection(sections, 1, 'down')
    expect(result.map((s) => s.label)).toEqual(['A', 'C', 'B'])
  })

  it('does nothing when moving first section up', () => {
    const result = moveSection(sections, 0, 'up')
    expect(result.map((s) => s.label)).toEqual(['A', 'B', 'C'])
  })

  it('does nothing when moving last section down', () => {
    const result = moveSection(sections, 2, 'down')
    expect(result.map((s) => s.label)).toEqual(['A', 'B', 'C'])
  })

  it('returns a new array (does not mutate input)', () => {
    const result = moveSection(sections, 1, 'up')
    expect(result).not.toBe(sections)
    expect(sections.map((s) => s.label)).toEqual(['A', 'B', 'C'])
  })
})

describe('parseJsonMockup', () => {
  it('parses valid wireframe JSON', () => {
    const json = JSON.stringify({
      title: 'Test',
      sections: [{ type: 'hero', label: 'Hi', description: 'desc' }],
    })
    const result = parseJsonMockup(json)
    expect(result.mockup).not.toBeNull()
    expect(result.error).toBeNull()
    expect(result.mockup!.title).toBe('Test')
    expect(result.mockup!.sections).toHaveLength(1)
  })

  it('returns error for invalid JSON', () => {
    const result = parseJsonMockup('not json')
    expect(result.mockup).toBeNull()
    expect(result.error).toBe('Invalid JSON')
  })

  it('returns error when title is missing', () => {
    const result = parseJsonMockup(JSON.stringify({ sections: [] }))
    expect(result.mockup).toBeNull()
    expect(result.error).toBe('JSON must have "title" (string) and "sections" (array)')
  })

  it('returns error when sections is not an array', () => {
    const result = parseJsonMockup(JSON.stringify({ title: 'Test', sections: 'nope' }))
    expect(result.mockup).toBeNull()
    expect(result.error).toBe('JSON must have "title" (string) and "sections" (array)')
  })

  it('returns error for empty string', () => {
    const result = parseJsonMockup('')
    expect(result.mockup).toBeNull()
    expect(result.error).toBe('Invalid JSON')
  })
})
