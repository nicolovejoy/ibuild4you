import { describe, it, expect } from 'vitest'
import { resolveChatModel, acceptsTemperature, chatModelOptions, EFFORT_MODEL_MAX_TOKENS } from '../model-config'
import { AGENT_MODEL, AGENT_TEMPERATURE, AGENT_MAX_TOKENS } from '../constants'

describe('resolveChatModel', () => {
  it('defaults to AGENT_MODEL when CHAT_MODEL is unset or blank', () => {
    expect(resolveChatModel({})).toBe(AGENT_MODEL)
    expect(resolveChatModel({ CHAT_MODEL: '   ' })).toBe(AGENT_MODEL)
  })
  it('honours CHAT_MODEL, trimmed', () => {
    expect(resolveChatModel({ CHAT_MODEL: ' claude-sonnet-5-5 ' })).toBe('claude-sonnet-5-5')
  })
})

describe('acceptsTemperature', () => {
  it('is true for the 4.0–4.6 generation (and dated snapshots of it)', () => {
    for (const m of ['claude-sonnet-4-6', 'claude-haiku-4-5', 'claude-opus-4-6', 'claude-opus-4-1', 'claude-opus-4', 'claude-sonnet-4-5-20250929']) {
      expect(acceptsTemperature(m)).toBe(true)
    }
  })
  it('is false for Opus 4.7/4.8 and every 5.x id, which 400 on a temperature', () => {
    for (const m of ['claude-opus-4-7', 'claude-opus-4-8', 'claude-sonnet-5-5', 'claude-sonnet-5', 'claude-opus-5-5', 'claude-haiku-5-5', 'claude-fable-5-1', 'claude-mythos-5-1']) {
      expect(acceptsTemperature(m)).toBe(false)
    }
  })
  it('sends an unknown id down the effort path rather than guessing a temperature', () => {
    expect(acceptsTemperature('claude-sonnet-50')).toBe(false)
    expect(acceptsTemperature('')).toBe(false)
  })
})

describe('chatModelOptions', () => {
  it('keeps the tuned temperature and the 2048 cap on 4.6', () => {
    expect(chatModelOptions('claude-sonnet-4-6')).toEqual({ temperature: AGENT_TEMPERATURE, max_tokens: AGENT_MAX_TOKENS })
  })
  it('sends low effort, no temperature, and more output headroom on 5.x', () => {
    const o = chatModelOptions('claude-sonnet-5-5')
    expect(o).toEqual({ output_config: { effort: 'low' }, max_tokens: EFFORT_MODEL_MAX_TOKENS })
    expect('temperature' in o).toBe(false)
    expect(EFFORT_MODEL_MAX_TOKENS).toBeGreaterThan(AGENT_MAX_TOKENS)
  })
})
