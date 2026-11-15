import { describe, it, expect } from 'vitest'
import { NOTE_SYSTEM_PROMPT, buildNoteUserContent } from '../note-prompt'

// #245: an owner/builder can post into the conversation. Those turns are
// context for the note writer, never the maker's own words.
describe('buildNoteUserContent speaker labels (#245)', () => {
  it('labels a builder-side turn Builder: and a maker turn User:', () => {
    const text = buildNoteUserContent({
      currentBrief: null,
      notesSinceCuration: [],
      earlierContext: [],
      newMessages: [
        { role: 'user', content: 'I want pickup only' },
        { role: 'user', content: 'Ask about opening hours', builder: true },
        { role: 'agent', content: 'Got it' },
      ],
    })
    expect(text).toContain('User: I want pickup only')
    expect(text).toContain('Builder: Ask about opening hours')
    expect(text).not.toContain('User: Ask about opening hours')
    expect(text).toContain('Assistant: Got it')
  })

  it('tells the model Builder lines are context only', () => {
    expect(NOTE_SYSTEM_PROMPT).toContain('Builder:')
    expect(NOTE_SYSTEM_PROMPT).toMatch(/never record a decision, risk owner change or lock_reversal from a Builder line/i)
  })
})

describe('buildNoteUserContent brief', () => {
  it('leaves decision provenance stamps out of the brief the note writer reads', () => {
    const content = buildNoteUserContent({
      currentBrief: {
        problem: 'p',
        target_users: '',
        features: [],
        constraints: '',
        additional_context: '',
        decisions: [
          {
            topic: 'Payments',
            decision: 'Stripe only',
            locked: true,
            decided_in_session: 'sessOrigin',
            decided_at: '2026-10-12T00:00:00.000Z',
          },
        ],
        open_risks: [],
      },
      notesSinceCuration: [],
      earlierContext: [],
      newMessages: [{ role: 'user', content: 'hello' }],
    })
    expect(content).toContain('Stripe only')
    expect(content).toContain('"locked": true')
    expect(content).not.toMatch(/decided_in_session|decided_at/)
  })
})

describe('NOTE_SYSTEM_PROMPT keeps what the maker said', () => {
  // "Start over button?" was closed with nothing recording what was decided.
  it('asks for the answer on every settled risk', () => {
    expect(NOTE_SYSTEM_PROMPT).toMatch(/risks_resolved: .*\{ text, resolution \}/)
    expect(NOTE_SYSTEM_PROMPT).toMatch(/Never mark a risk settled without saying how/)
  })

  // "The two games stay separate" was noted as a revision of a decision that
  // also held bar ranges; applied literally it would have erased them.
  it('has a revised decision restated whole, and a separate point given its own topic', () => {
    expect(NOTE_SYSTEM_PROMPT).toMatch(/write the whole decision as it now stands/)
    expect(NOTE_SYSTEM_PROMPT).toMatch(/keeping everything in the brief's text that still holds/)
    expect(NOTE_SYSTEM_PROMPT).toMatch(/give it its own topic/)
  })

  // "Details to follow" and "will report back" were noted with nothing to follow up on.
  it('turns a promise to follow up into an open risk with an owner', () => {
    expect(NOTE_SYSTEM_PROMPT).toMatch(/will send, check or decide something later/)
    expect(NOTE_SYSTEM_PROMPT).toMatch(/worded as what is still owed/)
  })
})
