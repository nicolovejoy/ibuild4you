import { describe, it, expect } from 'vitest'
import { buildNextConvoPrompt, NEXT_CONVO_SYSTEM_PROMPT } from '../next-convo-prompt'
import { NEXT_CONVO_IMPORT_FIELDS } from '@/lib/api/import-payload'
import { BRIEF_CURATION_GUIDE } from '../curation-guide'
import type { BriefContent, BriefNote } from '@/lib/types'

// =============================================================================
// NEXT-CONVO PREP PROMPT TESTS
//
// Lockstep: every field accepted by parseNextConvoPayload must appear as a
// top-level key in the prompt's JSON schema block. Plus brief sub-fields,
// plus the _payload_type marker.
// =============================================================================

const emptyInput = {
  currentBrief: null,
  notes: [],
  stamp: { brief_version: 0, note_ids: [] },
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
  'shipped',
  'queued',
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

// =============================================================================
// #229: the prep asks the comms agent to CURATE the brief from the live brief
// plus the per-conversation notes, inside a size budget, and to copy back a
// _prep_stamp the paste guard reads.
// =============================================================================

const brief: BriefContent = {
  problem: 'Customers cannot order online',
  target_users: 'Cafe regulars',
  features: ['Online ordering'],
  constraints: '',
  additional_context: '',
  decisions: [{ topic: 'Payments', decision: 'Stripe only', locked: true }],
  open_risks: [{ text: 'Opening hours unclear', owner: 'maker' }],
}

const note = (over: Partial<BriefNote>): BriefNote => ({
  id: 'noteA1',
  session_id: 'sess1',
  created_at: '2026-10-28T03:30:00.000Z', // Oct 27 in Pacific
  folded_at: null,
  text: 'Maker wants gift cards.',
  decisions: [{ topic: 'Gift cards', decision: 'Sell gift cards online' }],
  risks_added: [{ text: 'Gift-card fraud path undefined', owner: 'builder' }],
  risks_resolved: ['Opening hours unclear'],
  lock_reversals: [{ topic: 'Payments', proposed: 'Add PayPal', reason: 'confirmed twice on Oct 27' }],
  ...over,
})

describe('curation prep (#229)', () => {
  const input = {
    currentBrief: brief,
    notes: [note({}), note({ id: 'noteB2', created_at: '2026-10-29T18:00:00.000Z', text: 'Second chat.', decisions: [], risks_added: [], risks_resolved: [], lock_reversals: [] })],
    stamp: { brief_version: 7, note_ids: ['noteA1', 'noteB2'] },
    projectTitle: "Sam's Cafe",
    sessionCount: 3,
  }

  it('prep carries the brief, every unfolded note and the stamp JSON', () => {
    const p = buildNextConvoPrompt(input)
    expect(p).toContain('<current_brief version="7"')
    expect(p).toContain('Customers cannot order online')
    // Each note with its id, Pacific day and fields
    expect(p).toContain('<note id="noteA1" day="Oct 27">')
    expect(p).toContain('<note id="noteB2" day="Oct 29">')
    expect(p).toContain('Maker wants gift cards.')
    expect(p).toContain('Gift cards: Sell gift cards online')
    expect(p).toContain('Gift-card fraud path undefined (owner: builder)')
    expect(p).toContain('Opening hours unclear')
    expect(p).toContain('Payments')
    expect(p).toContain('Add PayPal')
    // The stamp, verbatim, in its own block and named in the schema
    expect(p).toContain('<prep_stamp>\n{"brief_version":7,"note_ids":["noteA1","noteB2"]}\n</prep_stamp>')
    expect(p).toMatch(/"_prep_stamp"\s*:/)
  })

  it('renders a placeholder when there are no notes', () => {
    const p = buildNextConvoPrompt(emptyInput)
    expect(p).toMatch(/<notes>\s*No new notes/)
  })

  it('prep no longer carries conversation history', () => {
    const p = buildNextConvoPrompt(input)
    expect(p).not.toContain('<conversation_history>')
    expect(p).not.toMatch(/^User: /m)
  })

  it('prep states the 20000 char budget and the current brief size', () => {
    const p = buildNextConvoPrompt(input)
    expect(p).toContain('20,000')
    expect(p).toContain(`Current size: ${JSON.stringify(brief).length.toLocaleString('en-US')} characters`)
    expect(buildNextConvoPrompt(emptyInput)).toContain('Current size: 0 characters')
  })

  it('prep says the readers are agents, not the builder', () => {
    const p = buildNextConvoPrompt(input)
    expect(p).toMatch(/Sam/)
    expect(p).toMatch(/Claude Code/)
    expect(p).not.toMatch(/the builder reads it/)
  })

  it('embeds the curation guide in full', () => {
    expect(NEXT_CONVO_SYSTEM_PROMPT).toContain(BRIEF_CURATION_GUIDE)
  })

  it('asks for the whole brief, rewritten, folding in every note', () => {
    expect(NEXT_CONVO_SYSTEM_PROMPT).toMatch(/rewrite the brief whole/i)
    expect(NEXT_CONVO_SYSTEM_PROMPT).toMatch(/every note/i)
  })

  it('carries locks verbatim and contests as is, and keeps a revised topic', () => {
    expect(NEXT_CONVO_SYSTEM_PROMPT).toMatch(/NEVER drop, reword, or unset a locked decision/)
    expect(NEXT_CONVO_SYSTEM_PROMPT).toMatch(/already on the brief as `contested`/)
    expect(NEXT_CONVO_SYSTEM_PROMPT).toMatch(/keep(s)? its `topic` text exactly/)
  })

  it('tells the comms agent to carry shipped and queued forward', () => {
    const result = buildNextConvoPrompt(emptyInput)
    expect(result).toMatch(/carry `?shipped`? and `?queued`? forward/i)
    expect(result).toMatch(/out of `?additional_context`?/)
  })
})
