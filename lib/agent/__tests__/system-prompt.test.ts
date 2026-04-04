import { describe, it, expect } from 'vitest'
import { buildSystemPrompt } from '../system-prompt'
import { AGENT_BEHAVIOR_RULES, CONVERGE_BEHAVIOR_RULES } from '../constants'

// =============================================================================
// SYSTEM PROMPT TESTS
//
// buildSystemPrompt is a pure function — takes structured input, returns the
// system prompt string sent to Claude. These tests verify that each optional
// section appears (or doesn't) based on the input.
// =============================================================================

const emptyBrief = {
  problem: '',
  target_users: '',
  features: [] as string[],
  constraints: '',
  additional_context: '',
  decisions: [],
}

const minimalInput = {
  briefContent: null,
  projectContext: null,
  sessionNumber: 1,
}

describe('buildSystemPrompt', () => {
  it('includes the assistant identity', () => {
    const result = buildSystemPrompt(minimalInput)
    expect(result).toContain('You are the iBuild4you project intake assistant.')
  })

  it('uses discover behavior rules by default', () => {
    const result = buildSystemPrompt(minimalInput)
    expect(result).toContain(AGENT_BEHAVIOR_RULES)
    expect(result).not.toContain(CONVERGE_BEHAVIOR_RULES)
  })

  it('uses converge behavior rules when session_mode is converge', () => {
    const result = buildSystemPrompt({ ...minimalInput, sessionMode: 'converge' })
    expect(result).toContain(CONVERGE_BEHAVIOR_RULES)
    expect(result).not.toContain(AGENT_BEHAVIOR_RULES)
  })

  it('includes project context when provided', () => {
    const result = buildSystemPrompt({
      ...minimalInput,
      projectContext: 'Jamie owns a bakery in Portland',
    })
    expect(result).toContain('## Background')
    expect(result).toContain('Jamie owns a bakery in Portland')
  })

  it('omits background section when no context', () => {
    const result = buildSystemPrompt(minimalInput)
    expect(result).not.toContain('## Background')
  })

  it('includes numbered seed questions', () => {
    const result = buildSystemPrompt({
      ...minimalInput,
      seedQuestions: ['What does the app do?', 'Who uses it?'],
    })
    expect(result).toContain('## Topics to explore')
    expect(result).toContain('1. What does the app do?')
    expect(result).toContain('2. Who uses it?')
  })

  it('omits seed questions section when empty', () => {
    const result = buildSystemPrompt({ ...minimalInput, seedQuestions: [] })
    expect(result).not.toContain('## Topics to explore')
  })

  it('includes numbered builder directives', () => {
    const result = buildSystemPrompt({
      ...minimalInput,
      builderDirectives: ['Focus on data flow', 'Do not suggest architectures'],
    })
    expect(result).toContain('## Directives')
    expect(result).toContain('1. Focus on data flow')
    expect(result).toContain('2. Do not suggest architectures')
  })

  it('omits directives section when empty', () => {
    const result = buildSystemPrompt({ ...minimalInput, builderDirectives: [] })
    expect(result).not.toContain('## Directives')
  })

  it('includes layout mockups when provided', () => {
    const mockup = {
      title: 'Homepage',
      sections: [{ type: 'hero', label: 'Welcome', description: 'Hero section' }],
    }
    const result = buildSystemPrompt({
      ...minimalInput,
      layoutMockups: [mockup],
    })
    expect(result).toContain('## Layout mockups')
    expect(result).toContain('Homepage')
    expect(result).toContain('```wireframe')
  })

  it('includes generic layout visualization section when no mockups', () => {
    const result = buildSystemPrompt(minimalInput)
    expect(result).toContain('## Layout visualization')
    expect(result).not.toContain('## Layout mockups')
  })

  it('includes decisions when brief has them', () => {
    const result = buildSystemPrompt({
      ...minimalInput,
      briefContent: {
        ...emptyBrief,
        decisions: [{ topic: 'Payment', decision: 'Stripe only' }],
      },
    })
    expect(result).toContain('## Decisions already made')
    expect(result).toContain('**Payment:** Stripe only')
  })

  it('omits decisions section when brief has none', () => {
    const result = buildSystemPrompt({
      ...minimalInput,
      briefContent: emptyBrief,
    })
    expect(result).not.toContain('## Decisions already made')
  })

  it('includes formatted brief when it has content', () => {
    const result = buildSystemPrompt({
      ...minimalInput,
      briefContent: {
        ...emptyBrief,
        problem: 'Customers cannot order online',
        target_users: 'Local bakery customers',
        features: ['Online ordering', 'Pickup scheduling'],
        constraints: 'Must work on mobile',
      },
    })
    expect(result).toContain('## Current project brief')
    expect(result).toContain('**Problem:** Customers cannot order online')
    expect(result).toContain('**Target users:** Local bakery customers')
    expect(result).toContain('- Online ordering')
    expect(result).toContain('- Pickup scheduling')
    expect(result).toContain('**Constraints:** Must work on mobile')
  })

  it('omits brief section when all fields are empty', () => {
    const result = buildSystemPrompt({
      ...minimalInput,
      briefContent: emptyBrief,
    })
    expect(result).not.toContain('## Current project brief')
  })

  it('says first session for sessionNumber 1', () => {
    const result = buildSystemPrompt({ ...minimalInput, sessionNumber: 1 })
    expect(result).toContain('This is the first session')
    expect(result).not.toContain('session #')
  })

  it('says session number for subsequent sessions', () => {
    const result = buildSystemPrompt({ ...minimalInput, sessionNumber: 3 })
    expect(result).toContain('This is session #3')
    expect(result).toContain("pick up where things left off")
  })

  // Posture model tests
  it('includes posture vocabulary in discover mode', () => {
    const result = buildSystemPrompt(minimalInput)
    expect(result).toContain('Your postures:')
    expect(result).toContain('**Curious**')
    expect(result).toContain('**Deepening**')
    expect(result).toContain('**Challenging**')
    expect(result).toContain('**Confirming**')
    expect(result).toContain('**Yielding**')
    expect(result).toContain('**Closing**')
  })

  it('includes posture vocabulary in converge mode', () => {
    const result = buildSystemPrompt({ ...minimalInput, sessionMode: 'converge' })
    expect(result).toContain('Your postures:')
    expect(result).toContain('**Curious**')
    expect(result).toContain('**Challenging**')
  })

  it('includes signal-to-posture mapping', () => {
    const result = buildSystemPrompt(minimalInput)
    expect(result).toContain('Reading the user')
    expect(result).toContain('Rich, specific answer → Deepen')
    expect(result).toContain('Vague or optimistic answer → Challenge')
  })

  it('includes guardrails in both modes', () => {
    const discover = buildSystemPrompt(minimalInput)
    const converge = buildSystemPrompt({ ...minimalInput, sessionMode: 'converge' })
    expect(discover).toContain('One question per message')
    expect(discover).toContain('Two-strike rule')
    expect(discover).toContain('Accuracy before restatement')
    expect(converge).toContain('One question per message')
    expect(converge).toContain('Two-strike rule')
  })

  it('uses discover gravity in discover mode and converge gravity in converge mode', () => {
    const discover = buildSystemPrompt(minimalInput)
    const converge = buildSystemPrompt({ ...minimalInput, sessionMode: 'converge' })
    expect(discover).toContain('Session gravity: discover')
    expect(discover).not.toContain('Session gravity: converge')
    expect(converge).toContain('Session gravity: converge')
    expect(converge).not.toContain('Session gravity: discover')
  })

  it('uses quality gates instead of exchange count for closing', () => {
    const discover = buildSystemPrompt(minimalInput)
    const converge = buildSystemPrompt({ ...minimalInput, sessionMode: 'converge' })
    expect(discover).toContain('Do not close based on exchange count')
    expect(converge).toContain('Do not close based on exchange count')
    expect(discover).not.toContain('8–12 exchanges')
    expect(converge).not.toContain('8–12 exchanges')
  })
})
