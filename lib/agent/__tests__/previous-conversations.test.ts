import { describe, it, expect } from 'vitest'
import {
  summarizePreviousConversations,
  renderPreviousConversationsBlock,
  truncateLastMessage,
  MAX_PREVIOUS_CONVERSATIONS,
} from '../previous-conversations'

// Three earlier conversations on one brief. Timestamps are UTC at rest; the
// block shows Pacific calendar days, so 2026-10-04T02:30Z is still Oct 3.
const fixture = [
  {
    number: 1,
    messages: [
      { role: 'agent', content: 'Hey! Welcome. What is the idea?', created_at: '2026-10-03T16:00:00.000Z' },
      { role: 'user', content: 'A shapes game for my daughter.', created_at: '2026-10-03T16:02:00.000Z' },
      { role: 'agent', content: 'Got it. Who else would play it?\n\n```options\n["Just her", "Her class"]\n```', created_at: '2026-10-04T02:30:00.000Z' },
    ],
  },
  {
    number: 2,
    messages: [
      { role: 'user', content: 'Back again.', created_at: '2026-10-10T18:00:00.000Z' },
      { role: 'agent', content: 'Welcome back. ' + 'x'.repeat(400), created_at: '2026-10-12T01:00:00.000Z' },
    ],
  },
  {
    number: 3,
    messages: [{ role: 'user', content: 'Only I spoke here.', created_at: '2026-10-15T20:00:00.000Z' }],
  },
]

describe('summarizePreviousConversations', () => {
  it('gives one row per conversation with Pacific day range, count and the agent ending', () => {
    const rows = summarizePreviousConversations(fixture)
    expect(rows).toHaveLength(3)
    expect(rows[0]).toMatchObject({ number: 1, dateRange: 'Oct 3, 2026', messageCount: 3 })
    // The options fence is dropped from the ending.
    expect(rows[0].lastAgentMessage).toBe('Got it. Who else would play it?')
    expect(rows[1]).toMatchObject({ number: 2, dateRange: 'Oct 10, 2026 to Oct 11, 2026', messageCount: 2 })
    expect(rows[1].lastAgentMessage!.length).toBeLessThanOrEqual(301)
    expect(rows[1].lastAgentMessage!.endsWith('…')).toBe(true)
    expect(rows[2]).toMatchObject({ number: 3, dateRange: 'Oct 15, 2026', messageCount: 1, lastAgentMessage: null })
  })

  it('skips conversations with no messages and keeps the last 12', () => {
    const many = Array.from({ length: 15 }, (_, i) => ({
      number: i + 1,
      messages: i === 2 ? [] : [{ role: 'user', content: 'hi', created_at: '2026-10-01T12:00:00.000Z' }],
    }))
    const rows = summarizePreviousConversations(many)
    expect(rows).toHaveLength(MAX_PREVIOUS_CONVERSATIONS)
    expect(rows.map((r) => r.number)).not.toContain(3)
    expect(rows[rows.length - 1].number).toBe(15)
  })

  it('is deterministic across turns: same input, same rows', () => {
    expect(summarizePreviousConversations(fixture)).toEqual(summarizePreviousConversations(fixture))
    const text = renderPreviousConversationsBlock(summarizePreviousConversations(fixture))
    expect(text).not.toMatch(/\b(ago|yesterday|today|last week)\b/i)
    expect(text).not.toMatch(/\d{1,2}:\d{2}/)
  })
})

describe('renderPreviousConversationsBlock', () => {
  it('renders the block with the summary caveat and one line per conversation', () => {
    const text = renderPreviousConversationsBlock(summarizePreviousConversations(fixture))
    expect(text).toContain('## Previous conversations')
    expect(text).toContain('the full text of those conversations is not in front of you')
    expect(text).toContain('- **Conversation 1** (Oct 3, 2026, 3 messages). Your last message: "Got it. Who else would play it?"')
    expect(text).toContain('- **Conversation 2** (Oct 10, 2026 to Oct 11, 2026, 2 messages). Your last message: "Welcome back.')
    expect(text).toContain('- **Conversation 3** (Oct 15, 2026, 1 message).')
  })

  it('is empty when there is nothing to add', () => {
    expect(renderPreviousConversationsBlock([])).toBe('')
  })
})

describe('truncateLastMessage', () => {
  it('collapses whitespace and cuts at 300 characters with an ellipsis', () => {
    expect(truncateLastMessage('a\n\n  b   c')).toBe('a b c')
    const long = truncateLastMessage('w'.repeat(350))
    expect(long).toHaveLength(301)
    expect(long.endsWith('…')).toBe(true)
  })
})
