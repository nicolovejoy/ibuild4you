import { describe, it, expect } from 'vitest'
import { stripCodeFences, generateSlug, parseLooseJson } from '../utils'

// stripCodeFences removes markdown code fences so pasted JSON from
// Claude/ChatGPT can be parsed directly. These tests verify each
// format variation we might encounter.

describe('stripCodeFences', () => {
  it('returns bare JSON unchanged', () => {
    const input = '{"title": "Test"}'
    expect(stripCodeFences(input)).toBe('{"title": "Test"}')
  })

  it('strips ```json ... ``` fences', () => {
    const input = '```json\n{"title": "Test"}\n```'
    expect(stripCodeFences(input)).toBe('{"title": "Test"}')
  })

  it('strips plain ``` ... ``` fences', () => {
    const input = '```\n{"title": "Test"}\n```'
    expect(stripCodeFences(input)).toBe('{"title": "Test"}')
  })

  it('handles leading/trailing whitespace around fences', () => {
    const input = '  \n```json\n{"title": "Test"}\n```\n  '
    expect(stripCodeFences(input)).toBe('{"title": "Test"}')
  })

  it('preserves multiline JSON inside fences', () => {
    const input = '```json\n{\n  "title": "Test",\n  "sections": []\n}\n```'
    expect(stripCodeFences(input)).toBe('{\n  "title": "Test",\n  "sections": []\n}')
  })

  it('does not strip fences that are not wrapping the whole string', () => {
    // If someone pastes text with a code block in the middle, don't strip
    const input = 'Here is some JSON:\n```json\n{"title": "Test"}\n```\nMore text'
    expect(stripCodeFences(input)).toBe(input.trim())
  })
})

describe('generateSlug', () => {
  it('converts a simple title to kebab-case', () => {
    expect(generateSlug('Sample Cafe')).toBe('sample-cafe')
  })

  it('strips apostrophes and special characters', () => {
    expect(generateSlug("Sam's Cafe App")).toBe('sams-cafe-app')
  })

  it('handles accented characters', () => {
    expect(generateSlug('Café René')).toBe('cafe-rene')
  })

  it('collapses multiple spaces and hyphens', () => {
    expect(generateSlug('Rob  --  Tuesday Night')).toBe('rob-tuesday-night')
  })

  it('trims leading and trailing whitespace', () => {
    expect(generateSlug('  My Project  ')).toBe('my-project')
  })

  it('handles all-special-character titles', () => {
    expect(generateSlug("!!!")).toBe('')
  })

  it('handles numbers', () => {
    expect(generateSlug("Rob's Tuesday Night Build 2")).toBe('robs-tuesday-night-build-2')
  })
})

// parseLooseJson repairs structure-breaking characters from copy-paste (#68) but
// ONLY as a fallback after a normal parse fails — so legitimate content is never
// rewritten. Smart quotes built with \u escapes so the intent is unambiguous.
describe('parseLooseJson', () => {
  const LDQUO = '“', RDQUO = '”' // “ ”
  const RSQUO = '’' // ’
  const NBSP = ' '

  it('parses plain valid JSON', () => {
    expect(parseLooseJson('{"a":1}')).toEqual({ a: 1 })
  })

  it('strips code fences before parsing', () => {
    expect(parseLooseJson('```json\n{"a":1}\n```')).toEqual({ a: 1 })
  })

  it('repairs smart double quotes used as delimiters', () => {
    const input = `{${LDQUO}title${RDQUO}:${LDQUO}Sam App${RDQUO}}`
    expect(parseLooseJson(input)).toEqual({ title: 'Sam App' })
  })

  it('repairs non-breaking spaces between tokens', () => {
    expect(parseLooseJson(`{"title":${NBSP}"X"}`)).toEqual({ title: 'X' })
  })

  it('preserves a curly apostrophe INSIDE a value byte-for-byte (no false repair)', () => {
    const r = parseLooseJson(`{"title":"Sam${RSQUO}s Cafe"}`) as { title: string }
    expect(r.title).toBe(`Sam${RSQUO}s Cafe`)
    expect(r.title).toContain(RSQUO) // not straightened
  })

  it('preserves emoji in values', () => {
    const r = parseLooseJson('{"welcome_message":"hi \u{1F44B}"}') as { welcome_message: string }
    expect(r.welcome_message).toBe('hi \u{1F44B}')
  })

  it('throws on genuinely malformed JSON', () => {
    expect(() => parseLooseJson('{nope')).toThrow()
  })
})
