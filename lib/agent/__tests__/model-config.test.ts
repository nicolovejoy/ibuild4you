import { describe, it, expect } from 'vitest'
import { resolveChatModel, resolveBriefModel, acceptsTemperature, chatModelOptions, EFFORT_MODEL_MAX_TOKENS } from '../model-config'
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

describe('resolveChatModel with a brief model', () => {
  it('uses the brief model over CHAT_MODEL and AGENT_MODEL', () => {
    expect(resolveChatModel({}, 'claude-opus-5-5')).toBe('claude-opus-5-5')
    expect(resolveChatModel({ CHAT_MODEL: 'claude-sonnet-5-5' }, 'claude-sonnet-4-6')).toBe('claude-sonnet-4-6')
  })
  it('falls back to CHAT_MODEL when the brief model is null or unset', () => {
    expect(resolveChatModel({ CHAT_MODEL: 'claude-sonnet-5-5' }, null)).toBe('claude-sonnet-5-5')
    expect(resolveChatModel({ CHAT_MODEL: 'claude-sonnet-5-5' }, undefined)).toBe('claude-sonnet-5-5')
  })
  it('ignores a brief model that is not in the allowed list', () => {
    expect(resolveChatModel({ CHAT_MODEL: 'claude-sonnet-5-5' }, 'gpt-4')).toBe('claude-sonnet-5-5')
  })
  it('falls back to AGENT_MODEL when neither the brief nor CHAT_MODEL is set', () => {
    expect(resolveChatModel({}, undefined)).toBe(AGENT_MODEL)
  })
})

describe('resolveBriefModel', () => {
  it('a session-level agent_model wins, and null means Default', () => {
    expect(resolveBriefModel({ agent_model: null }, { model: 'claude-opus-5-5' })).toBeNull()
    expect(resolveBriefModel({ agent_model: 'claude-sonnet-4-6' }, { model: 'claude-opus-5-5' })).toBe('claude-sonnet-4-6')
  })
  it('falls back to the project model when the session has no agent_model field', () => {
    expect(resolveBriefModel({}, { model: 'claude-opus-5-5' })).toBe('claude-opus-5-5')
  })
  it('returns null when neither sets a model', () => {
    expect(resolveBriefModel({}, {})).toBeNull()
  })
})

describe('chatModelOptions for the brief choices', () => {
  it('sends low effort and no temperature on opus-5-5', () => {
    const o = chatModelOptions('claude-opus-5-5')
    expect(o).toEqual({ output_config: { effort: 'low' }, max_tokens: EFFORT_MODEL_MAX_TOKENS })
    expect('temperature' in o).toBe(false)
  })
  it('keeps temperature on sonnet-4-6', () => {
    expect('temperature' in chatModelOptions('claude-sonnet-4-6')).toBe(true)
  })
})
