import { describe, it, expect } from 'vitest'
import {
  sessionNumberById,
  decisionProvenanceSuffix,
  decisionProvenanceMarkdown,
} from '../decision-provenance'

// #121 — quiet provenance suffix on decisions in the builder brief view and the
// markdown exports. Session id → conversation number uses the same rules as
// everywhere else: archived sessions excluded, oldest first.

const sessions = [
  { id: 's1', created_at: '2026-06-01T00:00:00Z', status: 'completed' },
  { id: 's-arch', created_at: '2026-06-15T00:00:00Z', status: 'archived' },
  { id: 's2', created_at: '2026-07-01T00:00:00Z', status: 'active' },
]

describe('sessionNumberById', () => {
  it('numbers non-archived sessions oldest-first, skipping archived', () => {
    const map = sessionNumberById(sessions)
    expect(map.get('s1')).toBe(1)
    expect(map.get('s2')).toBe(2)
    expect(map.has('s-arch')).toBe(false)
  })

  it('sorts by created_at even if input order differs', () => {
    const map = sessionNumberById([sessions[2], sessions[0]])
    expect(map.get('s1')).toBe(1)
    expect(map.get('s2')).toBe(2)
  })
})

describe('decisionProvenanceSuffix', () => {
  const numbers = sessionNumberById(sessions)

  it('returns null for an unstamped decision', () => {
    expect(decisionProvenanceSuffix({ topic: 'A', decision: 'a' }, numbers)).toBeNull()
  })

  it('renders conv number + date when the session is known', () => {
    expect(
      decisionProvenanceSuffix(
        { topic: 'A', decision: 'a', decided_in_session: 's2', decided_at: '2026-07-11T20:00:00Z' },
        numbers,
      ),
    ).toBe('conv 2 · Jul 11')
  })

  it('renders "added <date>" when decided out-of-band (null session)', () => {
    expect(
      decisionProvenanceSuffix(
        { topic: 'A', decision: 'a', decided_in_session: null, decided_at: '2026-07-11T20:00:00Z' },
        numbers,
      ),
    ).toBe('added Jul 11')
  })

  it('falls back to "added <date>" when the session id is unknown (archived/deleted)', () => {
    expect(
      decisionProvenanceSuffix(
        { topic: 'A', decision: 'a', decided_in_session: 's-arch', decided_at: '2026-07-11T20:00:00Z' },
        numbers,
      ),
    ).toBe('added Jul 11')
  })
})

describe('decisionProvenanceMarkdown', () => {
  const numbers = sessionNumberById(sessions)

  it('returns empty string for an unstamped decision', () => {
    expect(decisionProvenanceMarkdown({ topic: 'A', decision: 'a' }, numbers)).toBe('')
  })

  it('renders (decided conv N, YYYY-MM-DD) when the session is known', () => {
    expect(
      decisionProvenanceMarkdown(
        { topic: 'A', decision: 'a', decided_in_session: 's2', decided_at: '2026-07-11T20:00:00Z' },
        numbers,
      ),
    ).toBe(' (decided conv 2, 2026-07-11)')
  })

  it('renders (added YYYY-MM-DD) when decided out-of-band', () => {
    expect(
      decisionProvenanceMarkdown(
        { topic: 'A', decision: 'a', decided_in_session: null, decided_at: '2026-07-11T20:00:00Z' },
        numbers,
      ),
    ).toBe(' (added 2026-07-11)')
  })
})
