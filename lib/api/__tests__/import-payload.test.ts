import { describe, it, expect } from 'vitest'
import {
  parseNewProjectPayload,
  parseNextConvoPayload,
  NEXT_CONVO_IMPORT_FIELDS,
} from '../import-payload'

// =============================================================================
// IMPORT PAYLOAD PARSER TESTS
//
// Pure functions that parse pasted JSON for the two project payload shapes.
// Tests cover _payload_type checks (accept, reject mismatch, allow missing),
// field forwarding for next-convo's multi mode, and legacy brief-only paste.
// =============================================================================

describe('parseNewProjectPayload', () => {
  it('rejects invalid JSON', () => {
    const r = parseNewProjectPayload('not json')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toMatch(/Invalid JSON/)
  })

  it('rejects non-object payloads', () => {
    const r = parseNewProjectPayload('[1,2,3]')
    expect(r.ok).toBe(false)
  })

  it('rejects payloads without a title', () => {
    const r = parseNewProjectPayload('{"requester_email":"x@y.com"}')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toMatch(/title/)
  })

  it('accepts payload with title', () => {
    const r = parseNewProjectPayload('{"title":"Test"}')
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.value.title).toBe('Test')
  })

  it('accepts payload with _payload_type: new-project', () => {
    const r = parseNewProjectPayload('{"_payload_type":"new-project","title":"Test"}')
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.value.title).toBe('Test')
      // Marker is stripped — should not be forwarded to the API
      expect(r.value._payload_type).toBeUndefined()
    }
  })

  it('rejects a next-convo payload pasted into the new-project flow', () => {
    const r = parseNewProjectPayload('{"_payload_type":"next-convo","brief":{}}')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toMatch(/Brief tab/)
  })

  it('strips markdown code fences', () => {
    const r = parseNewProjectPayload('```json\n{"title":"Test"}\n```')
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.value.title).toBe('Test')
  })
})

describe('parseNextConvoPayload', () => {
  it('rejects invalid JSON', () => {
    const r = parseNextConvoPayload('not json')
    expect(r.ok).toBe(false)
  })

  it('accepts payload with _payload_type: next-convo', () => {
    const r = parseNextConvoPayload('{"_payload_type":"next-convo","brief":{"problem":"p"}}')
    expect(r.ok).toBe(true)
    if (r.ok && r.value.mode === 'multi') {
      expect(r.value.brief).toEqual({ problem: 'p' })
      // Marker is stripped — should not appear in projectUpdate
      expect(r.value.projectUpdate._payload_type).toBeUndefined()
    }
  })

  it('rejects a new-project payload pasted into the next-convo flow', () => {
    const r = parseNextConvoPayload('{"_payload_type":"new-project","title":"X"}')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toMatch(/Import JSON/)
  })

  it('forwards all known fields into projectUpdate when brief is present', () => {
    const payload: Record<string, unknown> = { brief: { problem: 'p' } }
    for (const field of NEXT_CONVO_IMPORT_FIELDS) {
      payload[field] = field === 'seed_questions' || field === 'builder_directives' || field === 'layout_mockups'
        ? []
        : `value-for-${field}`
    }
    const r = parseNextConvoPayload(JSON.stringify(payload))
    expect(r.ok).toBe(true)
    if (r.ok && r.value.mode === 'multi') {
      for (const field of NEXT_CONVO_IMPORT_FIELDS) {
        expect(r.value.projectUpdate[field]).toBeDefined()
      }
    }
  })

  it('treats session_opener as a legacy alias for welcome_message', () => {
    const r = parseNextConvoPayload('{"brief":{},"session_opener":"hi there"}')
    expect(r.ok).toBe(true)
    if (r.ok && r.value.mode === 'multi') {
      expect(r.value.projectUpdate.welcome_message).toBe('hi there')
    }
  })

  it('lets explicit welcome_message win over session_opener when both present', () => {
    const r = parseNextConvoPayload('{"brief":{},"session_opener":"legacy","welcome_message":"explicit"}')
    expect(r.ok).toBe(true)
    if (r.ok && r.value.mode === 'multi') {
      expect(r.value.projectUpdate.welcome_message).toBe('explicit')
    }
  })

  it('returns brief-only mode for legacy paste without a brief wrapper', () => {
    const r = parseNextConvoPayload('{"problem":"raw problem","features":["a"]}')
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.value.mode).toBe('brief-only')
  })

  it('proceeds without _payload_type (backward compatible)', () => {
    const r = parseNextConvoPayload('{"brief":{"problem":"p"},"welcome_message":"hi"}')
    expect(r.ok).toBe(true)
    if (r.ok && r.value.mode === 'multi') {
      expect(r.value.projectUpdate.welcome_message).toBe('hi')
    }
  })
})
