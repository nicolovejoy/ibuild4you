import { describe, it, expect } from 'vitest'
import { buildNewProjectPrompt } from '../new-project-prompt'

// =============================================================================
// NEW-PROJECT PREP PROMPT TESTS
//
// Lockstep: every field accepted by POST /api/projects (and parsed by
// parseNewProjectPayload) must appear as a top-level key in the prompt's
// JSON schema block. Plus brief sub-fields, plus the _payload_type marker.
// =============================================================================

// Mirrors what POST /api/projects accepts. Keep in sync with route.ts.
const NEW_PROJECT_FIELDS = [
  'title',
  'requester_email',
  'requester_first_name',
  'requester_last_name',
  'context',
  'welcome_message',
  'nudge_message',
  'voice_sample',
  'identity',
  'session_mode',
  'seed_questions',
  'builder_directives',
  'layout_mockups',
  'brief',
]

const BRIEF_FIELDS = [
  'problem',
  'target_users',
  'features',
  'constraints',
  'additional_context',
  'decisions',
  'open_risks',
]

describe('buildNewProjectPrompt', () => {
  it('declares _payload_type as the first key in the schema', () => {
    const result = buildNewProjectPrompt()
    expect(result).toMatch(/"_payload_type":\s*"new-project"/)
    const payloadTypeIdx = result.indexOf('"_payload_type"')
    const titleKeyIdx = result.indexOf('"title"')
    expect(payloadTypeIdx).toBeGreaterThan(-1)
    expect(titleKeyIdx).toBeGreaterThan(payloadTypeIdx)
  })

  it('opens with the NEW-PROJECT PREP header', () => {
    const result = buildNewProjectPrompt()
    expect(result.startsWith('NEW-PROJECT PREP')).toBe(true)
  })

  it('flags title as required', () => {
    const result = buildNewProjectPrompt()
    expect(result).toMatch(/`title` is required/)
  })

  it.each(NEW_PROJECT_FIELDS)('documents top-level field "%s"', (field) => {
    const result = buildNewProjectPrompt()
    const regex = new RegExp(`"${field}"\\s*:`)
    expect(result).toMatch(regex)
  })

  it.each(BRIEF_FIELDS)('documents brief sub-field "%s"', (field) => {
    const result = buildNewProjectPrompt()
    const regex = new RegExp(`"${field}"\\s*:`)
    expect(result).toMatch(regex)
  })
})
