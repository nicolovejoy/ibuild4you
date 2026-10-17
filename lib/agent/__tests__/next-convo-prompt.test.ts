import { describe, it, expect } from 'vitest'
import { buildNextConvoPrompt, NEXT_CONVO_SYSTEM_PROMPT } from '../next-convo-prompt'
import { NEXT_CONVO_IMPORT_FIELDS } from '@/lib/api/import-payload'

// =============================================================================
// NEXT-CONVO PREP PROMPT TESTS
//
// Lockstep: every field accepted by parseNextConvoPayload must appear as a
// top-level key in the prompt's JSON schema block. Plus brief sub-fields,
// plus the _payload_type marker.
// =============================================================================

const emptyInput = {
  currentBrief: null,
  conversationHistory: [],
  projectTitle: 'Test',
  sessionCount: 1,
}

const BRIEF_FIELDS = [
  'problem',
  'target_users',
  'features',
  'constraints',
  'additional_context',
  'decisions',
  'open_risks',
]

describe('buildNextConvoPrompt', () => {
  it('declares _payload_type as the first key in the schema', () => {
    const result = buildNextConvoPrompt(emptyInput)
    // _payload_type appears as a JSON key set to "next-convo" before any other key
    expect(result).toMatch(/"_payload_type":\s*"next-convo"/)
    const payloadTypeIdx = result.indexOf('"_payload_type"')
    const briefKeyIdx = result.indexOf('"brief"')
    expect(payloadTypeIdx).toBeGreaterThan(-1)
    expect(briefKeyIdx).toBeGreaterThan(payloadTypeIdx)
  })

  it('opens with the NEXT-CONVO PREP header', () => {
    const result = buildNextConvoPrompt(emptyInput)
    expect(result.startsWith('NEXT-CONVO PREP')).toBe(true)
  })

  it('tells the receiving Claude NOT to include create-only fields', () => {
    const result = buildNextConvoPrompt(emptyInput)
    expect(result).toMatch(/Do NOT include `title`/)
    expect(result).toMatch(/requester_email/)
  })

  it.each([...NEXT_CONVO_IMPORT_FIELDS])('documents top-level field "%s"', (field) => {
    const result = buildNextConvoPrompt(emptyInput)
    // Match as a quoted JSON key in the schema block
    const regex = new RegExp(`"${field}"\\s*:`)
    expect(result).toMatch(regex)
  })

  it.each(BRIEF_FIELDS)('documents brief sub-field "%s"', (field) => {
    const result = buildNextConvoPrompt(emptyInput)
    const regex = new RegExp(`"${field}"\\s*:`)
    expect(result).toMatch(regex)
  })

  it('embeds project title and session count', () => {
    const result = buildNextConvoPrompt({ ...emptyInput, projectTitle: 'Sam Cafe', sessionCount: 3 })
    expect(result).toContain('Sam Cafe')
    expect(result).toContain('Sessions so far: 3')
  })

  it('renders an empty brief placeholder when no current brief', () => {
    const result = buildNextConvoPrompt(emptyInput)
    expect(result).toContain('No brief yet')
  })

  it('serializes the current brief when present', () => {
    const result = buildNextConvoPrompt({
      ...emptyInput,
      currentBrief: {
        problem: 'no online ordering',
        target_users: 'cafe customers',
        features: ['catalog'],
        constraints: '',
        additional_context: '',
        decisions: [],
      },
    })
    expect(result).toContain('no online ordering')
    expect(result).toContain('catalog')
  })

  it('tells the prep Claude to write maker-facing text in the maker\'s language', () => {
    const result = buildNextConvoPrompt(emptyInput)
    expect(result).toMatch(/Write `welcome_message` and `nudge_message` in that language/)
  })

  it('passes the brief language in the project block', () => {
    expect(buildNextConvoPrompt({ ...emptyInput, language: 'fr' })).toMatch(/Maker's language: French/)
    expect(buildNextConvoPrompt(emptyInput)).toMatch(/Maker's language: English/)
    expect(buildNextConvoPrompt(emptyInput)).not.toMatch(/Converse in French/)
  })

  it('keeps the brief itself in English even when the conversation is not', () => {
    const result = buildNextConvoPrompt(emptyInput)
    expect(result).toMatch(/brief.*in English/i)
  })
})

// 5a (Weather & Tides, 2026-10-15): "Keep everything on server for now",
// answered to "which spots should forecast history cover?", became a
// standalone decision "All spots stored on server". This prompt drives brief
// regeneration too, so the scope rule lands in both places.
describe('decision scope', () => {
  it('keeps each decision within the question it answered, in the maker\'s words', () => {
    expect(NEXT_CONVO_SYSTEM_PROMPT).toContain('A decision answers the question it was given')
    expect(NEXT_CONVO_SYSTEM_PROMPT).toContain("Use the maker's own words")
    expect(NEXT_CONVO_SYSTEM_PROMPT).toContain("Don't record consequences or follow-on changes the maker didn't state")
  })

  it('tells the model about risk owners (#220)', () => {
    expect(NEXT_CONVO_SYSTEM_PROMPT).toContain('"owner": "maker"')
    expect(NEXT_CONVO_SYSTEM_PROMPT).toContain('Carry an existing owner forward')
  })
})
