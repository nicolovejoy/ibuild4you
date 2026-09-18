import { describe, it, expect } from 'vitest'
import { applyPromptCaching, type CacheableMessage } from '../prompt-cache'

describe('applyPromptCaching', () => {
  it('wraps the system prompt in a single cache-marked text block', () => {
    const { system } = applyPromptCaching('You are Sam.', [{ role: 'user', content: 'hi' }])
    expect(system).toEqual([
      { type: 'text', text: 'You are Sam.', cache_control: { type: 'ephemeral' } },
    ])
  })

  it('converts a string last message into a cache-marked text block', () => {
    const { messages } = applyPromptCaching('sys', [
      { role: 'user', content: 'first' },
      { role: 'assistant', content: 'second' },
    ])
    expect(messages[0]).toEqual({ role: 'user', content: 'first' })
    expect(messages[1]).toEqual({
      role: 'assistant',
      content: [{ type: 'text', text: 'second', cache_control: { type: 'ephemeral' } }],
    })
  })

  it('marks the last block of an array-content last message', () => {
    const { messages } = applyPromptCaching('sys', [
      {
        role: 'user',
        content: [
          { type: 'document', source: {} },
          { type: 'text', text: 'trailer' },
        ],
      },
    ])
    const content = messages[0].content as { type: string; cache_control?: unknown }[]
    expect(content[0].cache_control).toBeUndefined()
    expect(content[1]).toEqual({
      type: 'text',
      text: 'trailer',
      cache_control: { type: 'ephemeral' },
    })
  })

  it('leaves an already-marked last block as is (no double count)', () => {
    const input: CacheableMessage[] = [
      {
        role: 'user',
        content: [{ type: 'text', text: 'trailer', cache_control: { type: 'ephemeral' } }],
      },
    ]
    const { system, messages } = applyPromptCaching('sys', input)
    const content = messages[0].content as { cache_control?: unknown }[]
    const totalMarkers =
      system.filter((b) => b.cache_control).length +
      content.filter((b) => b.cache_control).length
    expect(totalMarkers).toBe(2) // system + the one pre-existing marker
    expect(content).toHaveLength(1)
  })

  it('returns messages unchanged when empty', () => {
    const input: CacheableMessage[] = []
    const { messages } = applyPromptCaching('sys', input)
    expect(messages).toBe(input)
  })

  it('does not mutate its inputs', () => {
    const original: CacheableMessage[] = [
      { role: 'user', content: 'hello' },
      { role: 'assistant', content: [{ type: 'text', text: 'world' }] },
    ]
    const snapshot = JSON.parse(JSON.stringify(original))
    applyPromptCaching('sys', original)
    expect(original).toEqual(snapshot)
  })

  it('never exceeds 4 markers, dropping earliest message markers first', () => {
    // Simulate 4 pre-existing markers already in history (well beyond what
    // the app produces today) so the guard has something to trim: adding
    // system + last-message markers would push the total to 6.
    const input: CacheableMessage[] = [
      { role: 'user', content: [{ type: 'text', text: 'a', cache_control: { type: 'ephemeral' } }] },
      { role: 'assistant', content: [{ type: 'text', text: 'b', cache_control: { type: 'ephemeral' } }] },
      { role: 'user', content: [{ type: 'text', text: 'c', cache_control: { type: 'ephemeral' } }] },
      { role: 'assistant', content: [{ type: 'text', text: 'd', cache_control: { type: 'ephemeral' } }] },
      { role: 'user', content: 'last turn' },
    ]
    const { system, messages } = applyPromptCaching('sys', input)

    let total = system.filter((b) => b.cache_control).length
    for (const m of messages) {
      if (typeof m.content === 'string') continue
      total += m.content.filter((b) => (b as { cache_control?: unknown }).cache_control).length
    }
    expect(total).toBeLessThanOrEqual(4)

    // System and last-message markers survive.
    expect(system[0].cache_control).toEqual({ type: 'ephemeral' })
    const lastContent = messages[4].content as { cache_control?: unknown }[]
    expect(lastContent[lastContent.length - 1].cache_control).toEqual({ type: 'ephemeral' })

    // The earliest message's marker ('a') was dropped first.
    const firstContent = messages[0].content as { cache_control?: unknown }[]
    expect(firstContent[0].cache_control).toBeUndefined()
  })
})
