import { describe, it, expect } from 'vitest'
import { stripCodeFences } from '../utils'

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
