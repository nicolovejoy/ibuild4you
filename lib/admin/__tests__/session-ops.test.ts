import { describe, it, expect } from 'vitest'
import {
  recomputeCounters,
  planReopen,
  planArchive,
  planResetToFresh,
  planAddSyntheticMessage,
} from '../session-ops'

const NOW = '2026-07-01T00:00:00.000Z'

// Minimal session shapes the planners operate on. `messageCount` is supplied by
// the caller (the API route counts messages per session before planning).
const sess = (id: string, created_at: string, status = 'active', messageCount = 0) => ({
  id,
  status,
  created_at,
  messageCount,
})

describe('recomputeCounters', () => {
  it('counts survivors and picks the latest created_at', () => {
    const r = recomputeCounters([
      { id: 'a', created_at: '2026-01-01T00:00:00Z' },
      { id: 'c', created_at: '2026-03-01T00:00:00Z' },
      { id: 'b', created_at: '2026-02-01T00:00:00Z' },
    ])
    expect(r.session_count).toBe(3)
    expect(r.latest_session_created_at).toBe('2026-03-01T00:00:00Z')
  })

  it('returns 0 / null for an empty set', () => {
    expect(recomputeCounters([])).toEqual({ session_count: 0, latest_session_created_at: null })
  })
})

describe('planReopen', () => {
  const sessions = [
    sess('s1', '2026-01-01T00:00:00Z', 'completed', 5),
    sess('s2', '2026-02-01T00:00:00Z', 'active', 0), // accidental empty displacer
  ]

  it('reactivates the target and archives the displaced empty session', () => {
    const plan = planReopen({ sessions, reopenId: 's1', archiveId: 's2', now: NOW })
    if ('error' in plan) throw new Error(plan.error)
    expect(plan.sessionUpdates).toContainEqual({ id: 's1', patch: { status: 'active', updated_at: NOW } })
    expect(plan.sessionUpdates).toContainEqual({
      id: 's2',
      patch: { status: 'archived', archived_at: NOW, updated_at: NOW },
    })
    // Counters recomputed over survivors (s1 only).
    expect(plan.projectPatch).toEqual({
      session_count: 1,
      latest_session_created_at: '2026-01-01T00:00:00Z',
      updated_at: NOW,
    })
    expect(plan.audit).toMatchObject({
      action: 'reopen_conversation',
      reopened_session_id: 's1',
      archived_session_id: 's2',
    })
  })

  it('reopens without archiving when no archiveId given', () => {
    const plan = planReopen({ sessions, reopenId: 's1', now: NOW })
    if ('error' in plan) throw new Error(plan.error)
    expect(plan.sessionUpdates).toEqual([{ id: 's1', patch: { status: 'active', updated_at: NOW } }])
    expect(plan.projectPatch!.session_count).toBe(2)
    expect(plan.audit.archived_session_id).toBeNull()
  })

  it('REFUSES to archive a session that has messages (non-destructive guard)', () => {
    const withMsgs = [sess('s1', '2026-01-01T00:00:00Z', 'completed', 5), sess('s2', '2026-02-01T00:00:00Z', 'active', 3)]
    const plan = planReopen({ sessions: withMsgs, reopenId: 's1', archiveId: 's2', now: NOW })
    expect('error' in plan && plan.error).toMatch(/messages/i)
  })

  it('errors when the reopen target does not exist', () => {
    const plan = planReopen({ sessions, reopenId: 'nope', now: NOW })
    expect('error' in plan && plan.error).toMatch(/not found/i)
  })

  it('errors when the archive target does not exist', () => {
    const plan = planReopen({ sessions, reopenId: 's1', archiveId: 'nope', now: NOW })
    expect('error' in plan && plan.error).toMatch(/not found/i)
  })
})

describe('planArchive', () => {
  const sessions = [
    sess('s1', '2026-01-01T00:00:00Z', 'active', 0),
    sess('s2', '2026-02-01T00:00:00Z', 'active', 4),
  ]

  it('archives an empty session without confirmation', () => {
    const plan = planArchive({ sessions, sessionId: 's1', briefTitle: 'Cafe App', now: NOW })
    if ('error' in plan) throw new Error(plan.error)
    expect(plan.sessionUpdates).toEqual([
      { id: 's1', patch: { status: 'archived', archived_at: NOW, updated_at: NOW } },
    ])
    expect(plan.projectPatch!.session_count).toBe(1)
    expect(plan.audit).toMatchObject({ action: 'archive_conversation', archived_session_id: 's1', had_messages: false })
  })

  it('requires a typed brief-title confirm to archive a session WITH messages', () => {
    const plan = planArchive({ sessions, sessionId: 's2', briefTitle: 'Cafe App', now: NOW })
    expect('error' in plan && plan.error).toMatch(/confirm/i)
  })

  it('archives a non-empty session when the typed confirm matches the brief title', () => {
    const plan = planArchive({ sessions, sessionId: 's2', briefTitle: 'Cafe App', typedConfirm: 'Cafe App', now: NOW })
    if ('error' in plan) throw new Error(plan.error)
    expect(plan.audit).toMatchObject({ had_messages: true })
  })

  it('rejects a mismatched typed confirm', () => {
    const plan = planArchive({ sessions, sessionId: 's2', briefTitle: 'Cafe App', typedConfirm: 'wrong', now: NOW })
    expect('error' in plan && plan.error).toMatch(/confirm/i)
  })

  it('errors when the target does not exist', () => {
    const plan = planArchive({ sessions, sessionId: 'nope', briefTitle: 'x', now: NOW })
    expect('error' in plan && plan.error).toMatch(/not found/i)
  })
})

describe('planResetToFresh', () => {
  it('archives ALL sessions (reversible) and zeroes the counters', () => {
    const sessions = [sess('s1', '2026-01-01T00:00:00Z', 'completed', 9), sess('s2', '2026-02-01T00:00:00Z', 'active', 0)]
    const plan = planResetToFresh({ sessions, now: NOW })
    expect(plan.sessionUpdates).toEqual([
      { id: 's1', patch: { status: 'archived', archived_at: NOW, updated_at: NOW } },
      { id: 's2', patch: { status: 'archived', archived_at: NOW, updated_at: NOW } },
    ])
    expect(plan.projectPatch).toEqual({ session_count: 0, latest_session_created_at: null, updated_at: NOW })
    expect(plan.audit).toMatchObject({ action: 'reset_to_fresh', archived_session_ids: ['s1', 's2'] })
  })

  it('ignores already-archived sessions', () => {
    const sessions = [sess('s1', '2026-01-01T00:00:00Z', 'archived', 9), sess('s2', '2026-02-01T00:00:00Z', 'active', 0)]
    const plan = planResetToFresh({ sessions, now: NOW })
    expect(plan.sessionUpdates).toEqual([
      { id: 's2', patch: { status: 'archived', archived_at: NOW, updated_at: NOW } },
    ])
    expect(plan.audit.archived_session_ids).toEqual(['s2'])
  })
})

describe('planAddSyntheticMessage', () => {
  const session = sess('s1', '2026-01-01T00:00:00Z', 'active', 2)

  it('inserts a maker (user) message', () => {
    const plan = planAddSyntheticMessage({ session, role: 'user', content: 'hi from the maker', now: NOW })
    if ('error' in plan) throw new Error(plan.error)
    expect(plan.messageInserts).toEqual([
      { session_id: 's1', role: 'user', content: 'hi from the maker', created_at: NOW, updated_at: NOW },
    ])
    expect(plan.audit).toMatchObject({ action: 'add_synthetic_message', session_id: 's1', role: 'user' })
  })

  it('inserts an agent message', () => {
    const plan = planAddSyntheticMessage({ session, role: 'agent', content: 'hello', now: NOW })
    if ('error' in plan) throw new Error(plan.error)
    expect(plan.messageInserts[0].role).toBe('agent')
  })

  it('rejects an empty message', () => {
    const plan = planAddSyntheticMessage({ session, role: 'user', content: '   ', now: NOW })
    expect('error' in plan && plan.error).toMatch(/empty|content/i)
  })

  it('rejects an invalid role', () => {
    // @ts-expect-error testing runtime guard
    const plan = planAddSyntheticMessage({ session, role: 'builder', content: 'x', now: NOW })
    expect('error' in plan && plan.error).toMatch(/role/i)
  })
})
