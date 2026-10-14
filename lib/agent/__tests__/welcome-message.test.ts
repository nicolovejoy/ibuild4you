import { describe, it, expect } from 'vitest'
import { buildWelcomeSystemPrompt } from '../welcome-message'

describe('buildWelcomeSystemPrompt', () => {
  it('writes the welcome in the language the context asks for', () => {
    const prompt = buildWelcomeSystemPrompt()
    expect(prompt).toMatch(/language/i)
    expect(prompt).toMatch(/French/)
  })
})
