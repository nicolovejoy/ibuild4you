import { describe, it, expect } from 'vitest'
import { buildWelcomeSystemPrompt } from '../welcome-message'

describe('buildWelcomeSystemPrompt', () => {
  it('writes the welcome in the language the context asks for', () => {
    const prompt = buildWelcomeSystemPrompt()
    expect(prompt).toMatch(/language/i)
    expect(prompt).toMatch(/French/)
  })

  it('writes the whole welcome in French when the brief language is fr', () => {
    const prompt = buildWelcomeSystemPrompt(null, 'fr')
    expect(prompt).toMatch(/Write the whole message in French/)
  })
})
