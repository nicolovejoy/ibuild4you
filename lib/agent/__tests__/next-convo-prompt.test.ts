import { describe, it, expect } from 'vitest'
import { buildNextConvoPrompt } from '../next-convo-prompt'
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
    const result = buildNextConvoPrompt({ ...emptyInput, projectTitle: 'Jamie Bakery', sessionCount: 3 })
    expect(result).toContain('Jamie Bakery')
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
        target_users: 'bakery customers',
        features: ['catalog'],
        constraints: '',
        additional_context: '',
        decisions: [],
      },
    })
    expect(result).toContain('no online ordering')
    expect(result).toContain('catalog')
  })
})
