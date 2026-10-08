import { describe, it, expect } from 'vitest'
import { resolveChatModel, isClaude5Family, chatSampling } from '../model-config'
import { AGENT_MODEL, AGENT_TEMPERATURE } from '../constants'

describe('resolveChatModel', () => {
  it('defaults to AGENT_MODEL when CHAT_MODEL is unset or blank', () => {
    expect(resolveChatModel({})).toBe(AGENT_MODEL)
    expect(resolveChatModel({ CHAT_MODEL: '   ' })).toBe(AGENT_MODEL)
  })
  it('honours CHAT_MODEL, trimmed', () => {
    expect(resolveChatModel({ CHAT_MODEL: ' claude-sonnet-5-5 ' })).toBe('claude-sonnet-5-5')
  })
})

describe('isClaude5Family', () => {
  it('matches the 5.x ids and nothing older', () => {
    for (const m of ['claude-sonnet-5-5', 'claude-sonnet-5', 'claude-opus-5-5', 'claude-haiku-5-5', 'claude-fable-5-1']) {
      expect(isClaude5Family(m)).toBe(true)
    }
    for (const m of ['claude-sonnet-4-6', 'claude-haiku-4-5', 'claude-opus-4-8', 'claude-sonnet-50']) {
      expect(isClaude5Family(m)).toBe(false)
    }
  })
})

describe('chatSampling', () => {
  it('keeps the tuned temperature on 4.x', () => {
    expect(chatSampling('claude-sonnet-4-6')).toEqual({ temperature: AGENT_TEMPERATURE })
  })
  it('sends low effort and no temperature on 5.x (temperature would 400)', () => {
    const s = chatSampling('claude-sonnet-5-5')
    expect(s).toEqual({ output_config: { effort: 'low' } })
    expect('temperature' in s).toBe(false)
  })
})
