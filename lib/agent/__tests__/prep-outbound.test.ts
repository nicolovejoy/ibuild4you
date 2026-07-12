import { describe, it, expect } from 'vitest'
import { buildPrepUserContent, prepConfigHash, type PrepInput } from '../prep-outbound'

const base: PrepInput = {
  projectTitle: "Sam's Cafe App",
  makerNames: 'Sam',
  sessionMode: 'discover',
  seedQuestions: ['What does a typical day look like?'],
}

describe('buildPrepUserContent', () => {
  it('includes the maker name and title', () => {
    const out = buildPrepUserContent(base)
    expect(out).toContain("Sam's Cafe App")
    expect(out).toContain('Sam')
  })

  it('includes every maker name on a multi-maker brief', () => {
    const out = buildPrepUserContent({ ...base, makerNames: 'Matt and Scott' })
    expect(out).toContain('Matt and Scott')
  })

  it('keeps it general when no maker name', () => {
    const out = buildPrepUserContent({ ...base, makerNames: null })
    expect(out).toContain('keep it general')
  })

  it('surfaces seed questions in discover mode and directives in converge', () => {
    const discover = buildPrepUserContent(base)
    expect(discover).toContain('What does a typical day look like?')

    const converge = buildPrepUserContent({
      ...base,
      sessionMode: 'converge',
      builderDirectives: ['Lock the ordering flow'],
    })
    expect(converge).toContain('Lock the ordering flow')
    expect(converge).toContain('Mode: converge')
  })

  it('summarizes the brief when present', () => {
    const out = buildPrepUserContent({
      ...base,
      brief: {
        problem: 'No online ordering',
        target_users: 'Local customers',
        features: ['Online ordering'],
        constraints: 'Mobile only',
        additional_context: '',
        decisions: [{ topic: 'Payment', decision: 'Stripe only' }],
      },
    })
    expect(out).toContain('No online ordering')
    expect(out).toContain('Stripe only')
  })

  it('recaps the last session messages (tail only)', () => {
    const out = buildPrepUserContent({
      ...base,
      lastSessionMessages: [
        { role: 'agent', content: 'Welcome!' },
        { role: 'user', content: 'I want online ordering' },
      ],
    })
    expect(out).toContain('Maker: I want online ordering')
    expect(out).toContain('Sam: Welcome!')
  })

  it('notes a first invite when there is no prior session', () => {
    const out = buildPrepUserContent({ ...base, lastSessionMessages: [] })
    expect(out).toContain('first invite')
  })

  it('includes the voice sample when provided', () => {
    const out = buildPrepUserContent({ ...base, voiceSample: 'hey! quick one for you' })
    expect(out).toContain('hey! quick one for you')
    expect(out).toContain('texting voice')
  })
})

describe('prepConfigHash', () => {
  it('is stable for identical inputs', () => {
    expect(prepConfigHash(base)).toBe(prepConfigHash({ ...base }))
  })

  it('changes when config changes', () => {
    const a = prepConfigHash(base)
    expect(prepConfigHash({ ...base, sessionMode: 'converge' })).not.toBe(a)
    expect(prepConfigHash({ ...base, seedQuestions: ['different'] })).not.toBe(a)
    expect(prepConfigHash({ ...base, welcomeMessage: 'hi' })).not.toBe(a)
  })

  it('changes when the brief signal changes', () => {
    const a = prepConfigHash({ ...base, briefSignal: 1 })
    expect(prepConfigHash({ ...base, briefSignal: 2 })).not.toBe(a)
  })

  it('ignores whitespace-only differences in text fields', () => {
    const a = prepConfigHash({ ...base, welcomeMessage: 'hi' })
    const b = prepConfigHash({ ...base, welcomeMessage: '  hi  ' })
    expect(a).toBe(b)
  })
})
