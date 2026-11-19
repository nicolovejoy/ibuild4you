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

  // A bundled risk ("does the piano play? which phrases sound musical, in C
  // major and A minor?") was half answered. The note listed the whole risk as
  // settled and, word for word, as new (2026-11-17).
  it('has a partly settled risk closed with its answer and reopened as only what is left', () => {
    expect(NOTE_SYSTEM_PROMPT).toMatch(/settle only part of an open risk/)
    expect(NOTE_SYSTEM_PROMPT).toMatch(/worded as only what is still open/)
    expect(NOTE_SYSTEM_PROMPT).toMatch(/The same text never appears in both risks_added and risks_resolved/)
    expect(NOTE_SYSTEM_PROMPT).toMatch(/Never add a risk that is already in the brief's open risks or in a note's risks_added/)
  })

  // "Builder placeholders to react to: big star never says Start…" was an open
  // risk; the maker's one-line answer was noted as a decision with the risk's
  // whole text as its topic (2026-11-16).
  it('keeps a new topic a short label, never the text of an open risk', () => {
    expect(NOTE_SYSTEM_PROMPT).toMatch(/A new topic is a short label of a few words/)
    expect(NOTE_SYSTEM_PROMPT).toMatch(/never a question and never the text of an open risk/)
  })

  it('records an answer to an open risk as a settled risk, and as a decision only for a lasting choice', () => {
    // The first wording ("record it here; add a decision as well only when…")
    // was read as either/or on preview: the answer became a decision and the
    // risk was left open. The settled-risk entry is unconditional.
    expect(NOTE_SYSTEM_PROMPT).toMatch(/An answer that settles an open risk is always listed here, even when it is also recorded as a decision/)
    expect(NOTE_SYSTEM_PROMPT).toMatch(/only when they committed to a lasting choice, under a short topic of its own/)
    // Still either/or in one preview run of two, so the decisions rule says it
    // too, where the writer is when it makes the choice.
    expect(NOTE_SYSTEM_PROMPT).toMatch(/A decision that answers one of the open risks does not replace that risk's risks_resolved entry: list it in both/)
  })

  // "Details to follow" and "will report back" were noted with nothing to follow up on.
  it('turns a promise to follow up into an open risk with an owner', () => {
    expect(NOTE_SYSTEM_PROMPT).toMatch(/will send, check or decide something later/)
    expect(NOTE_SYSTEM_PROMPT).toMatch(/worded as what is still owed/)
  })
})
