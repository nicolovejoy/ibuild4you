import { describe, it, expect } from 'vitest'
import { parseMessageContent } from '../MessageContent'

describe('parseMessageContent', () => {
  it('returns plain text as a single text segment', () => {
    const { segments, hasIncompleteBlock } = parseMessageContent('Hello, how are you?')
    expect(segments).toEqual([{ type: 'text', content: 'Hello, how are you?' }])
    expect(hasIncompleteBlock).toBe(false)
  })

  it('returns empty segments for empty string', () => {
    const { segments, hasIncompleteBlock } = parseMessageContent('')
    expect(segments).toEqual([])
    expect(hasIncompleteBlock).toBe(false)
  })

  // #195 phase 2: wireframe fences are no longer a block type. Old messages
  // that still carry one render as the plain text they are.
  it('treats a legacy wireframe fence as plain text', () => {
    const content = 'Here is the layout:\n\n```wireframe\n{"title":"Layout","sections":[]}\n```\n\nWhat do you think?'
    const { segments, hasIncompleteBlock } = parseMessageContent(content)
    expect(hasIncompleteBlock).toBe(false)
    expect(segments).toEqual([{ type: 'text', content }])
  })

  it('does not flag an unclosed legacy wireframe fence as a streaming block', () => {
    const content = 'Here is the layout:\n\n```wireframe\n{"title":"Test","sec'
    const { segments, hasIncompleteBlock, incompleteKind } = parseMessageContent(content)
    expect(hasIncompleteBlock).toBe(false)
    expect(incompleteKind).toBeUndefined()
    expect(segments).toEqual([{ type: 'text', content }])
  })

  it('still detects an unclosed options fence while streaming', () => {
    const content = 'Which way?\n\n```options\n["Pickup", "Deli'
    const { segments, hasIncompleteBlock, incompleteKind } = parseMessageContent(content)
    expect(hasIncompleteBlock).toBe(true)
    expect(incompleteKind).toBe('options')
    expect(segments).toEqual([{ type: 'text', content: 'Which way?\n\n' }])
  })

  it('keeps a legacy wireframe fence and an options block apart', () => {
    const content =
      '```wireframe\n{"title":"A","sections":[]}\n```\n\nLike this?\n\n```options\n["Yes", "No"]\n```'
    const { segments } = parseMessageContent(content)
    expect(segments.map((s) => s.type)).toEqual(['text', 'options'])
    expect(segments[0]).toEqual({
      type: 'text',
      content: '```wireframe\n{"title":"A","sections":[]}\n```\n\nLike this?\n\n',
    })
  })

  // --- options blocks (#131) ---

  it('parses an options block into a string array', () => {
    const content = 'Which way do you lean?\n\n```options\n["Pickup", "Delivery", "Both"]\n```'
    const { segments, hasIncompleteBlock } = parseMessageContent(content)
    expect(segments).toHaveLength(2)
    expect(segments[0]).toEqual({ type: 'text', content: 'Which way do you lean?\n\n' })
    expect(segments[1].type).toBe('options')
    if (segments[1].type === 'options') {
      expect(segments[1].parsed).toEqual(['Pickup', 'Delivery', 'Both'])
    }
    expect(hasIncompleteBlock).toBe(false)
  })

  it('rejects an options block that is not an array of strings', () => {
    const content = '```options\n{"a": 1}\n```'
    const { segments } = parseMessageContent(content)
    expect(segments[0].type).toBe('options')
    if (segments[0].type === 'options') {
      expect(segments[0].parsed).toBeNull()
      expect(segments[0].raw).toBe('{"a": 1}')
    }
  })

  it('rejects options with non-string or empty entries', () => {
    const bad = ['```options\n["A", 2]\n```', '```options\n["A", ""]\n```', '```options\n[]\n```']
    for (const content of bad) {
      const { segments } = parseMessageContent(content)
      expect(segments[0].type).toBe('options')
      if (segments[0].type === 'options') {
        expect(segments[0].parsed).toBeNull()
      }
    }
  })

  it('handles malformed JSON in an options block', () => {
    const content = '```options\n[not json\n```'
    const { segments } = parseMessageContent(content)
    expect(segments[0].type).toBe('options')
    if (segments[0].type === 'options') {
      expect(segments[0].parsed).toBeNull()
    }
  })

  it('detects an incomplete options block (streaming in progress)', () => {
    const content = 'Pick one:\n\n```options\n["Pick'
    const { segments, hasIncompleteBlock } = parseMessageContent(content)
    expect(hasIncompleteBlock).toBe(true)
    expect(segments).toHaveLength(1)
    expect(segments[0]).toEqual({ type: 'text', content: 'Pick one:\n\n' })
  })
})
