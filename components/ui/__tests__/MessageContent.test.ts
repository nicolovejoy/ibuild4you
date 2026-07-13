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

  it('parses a single wireframe block', () => {
    const content = '```wireframe\n{"title":"Test","sections":[{"type":"hero","label":"Hi","description":"desc"}]}\n```'
    const { segments, hasIncompleteBlock } = parseMessageContent(content)
    expect(segments).toHaveLength(1)
    expect(segments[0].type).toBe('wireframe')
    if (segments[0].type === 'wireframe') {
      expect(segments[0].parsed).not.toBeNull()
      expect(segments[0].parsed!.title).toBe('Test')
      expect(segments[0].parsed!.sections).toHaveLength(1)
    }
    expect(hasIncompleteBlock).toBe(false)
  })

  it('handles text before and after a wireframe block', () => {
    const content = 'Here is the layout:\n\n```wireframe\n{"title":"Layout","sections":[]}\n```\n\nWhat do you think?'
    const { segments } = parseMessageContent(content)
    expect(segments).toHaveLength(3)
    expect(segments[0]).toEqual({ type: 'text', content: 'Here is the layout:\n\n' })
    expect(segments[1].type).toBe('wireframe')
    expect(segments[2]).toEqual({ type: 'text', content: '\n\nWhat do you think?' })
  })

  it('handles multiple wireframe blocks', () => {
    const content = 'Option A:\n\n```wireframe\n{"title":"A","sections":[]}\n```\n\nOption B:\n\n```wireframe\n{"title":"B","sections":[]}\n```'
    const { segments } = parseMessageContent(content)
    expect(segments).toHaveLength(4)
    expect(segments[0].type).toBe('text')
    expect(segments[1].type).toBe('wireframe')
    expect(segments[2].type).toBe('text')
    expect(segments[3].type).toBe('wireframe')
  })

  it('handles malformed JSON gracefully', () => {
    const content = '```wireframe\n{not valid json}\n```'
    const { segments } = parseMessageContent(content)
    expect(segments).toHaveLength(1)
    expect(segments[0].type).toBe('wireframe')
    if (segments[0].type === 'wireframe') {
      expect(segments[0].parsed).toBeNull()
      expect(segments[0].raw).toBe('{not valid json}')
    }
  })

  it('handles valid JSON without required fields', () => {
    const content = '```wireframe\n{"name":"missing title and sections"}\n```'
    const { segments } = parseMessageContent(content)
    expect(segments[0].type).toBe('wireframe')
    if (segments[0].type === 'wireframe') {
      expect(segments[0].parsed).toBeNull()
    }
  })

  it('detects incomplete block (streaming in progress)', () => {
    const content = 'Here is the layout:\n\n```wireframe\n{"title":"Test","sec'
    const { segments, hasIncompleteBlock } = parseMessageContent(content)
    expect(hasIncompleteBlock).toBe(true)
    // Text before the incomplete block should still show
    expect(segments).toHaveLength(1)
    expect(segments[0]).toEqual({ type: 'text', content: 'Here is the layout:\n\n' })
  })

  it('handles complete block followed by incomplete block', () => {
    const content = '```wireframe\n{"title":"Done","sections":[]}\n```\n\nNow another:\n\n```wireframe\n{"title":"Still stream'
    const { segments, hasIncompleteBlock } = parseMessageContent(content)
    expect(hasIncompleteBlock).toBe(true)
    expect(segments).toHaveLength(2)
    expect(segments[0].type).toBe('wireframe')
    expect(segments[1].type).toBe('text')
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

  it('handles a wireframe and an options block in the same message', () => {
    const content =
      '```wireframe\n{"title":"A","sections":[]}\n```\n\nLike this?\n\n```options\n["Yes", "No"]\n```'
    const { segments } = parseMessageContent(content)
    expect(segments.map((s) => s.type)).toEqual(['wireframe', 'text', 'options'])
  })
})
