import { describe, it, expect } from 'vitest'
import { getTurnIndicator } from '../turn-indicator'
import type { Project } from '@/lib/types'

function makeProject(overrides: Partial<Project> = {}): Project {
  return {
    id: 'proj-1',
    requester_id: 'user-1',
    title: 'Test Project',
    status: 'active',
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    requester_email: 'sam@example.com',
    requester_first_name: 'Sam',
    session_count: 1,
    latest_session_created_at: '2026-01-01T00:00:00Z',
    last_maker_message_at: null,
    ...overrides,
  }
}

describe('getTurnIndicator', () => {
  it('returns null for undefined project', () => {
    expect(getTurnIndicator(undefined, 'builder')).toBeNull()
  })

  it('returns Completed when project status is completed', () => {
    const result = getTurnIndicator(makeProject({ status: 'completed' }), 'builder')
    expect(result?.label).toBe('Completed')
    expect(result?.state).toBe('completed')
  })

  it('returns Needs setup when no requester email', () => {
    const result = getTurnIndicator(makeProject({ requester_email: undefined }), 'builder')
    expect(result?.label).toBe('Needs setup')
    expect(result?.state).toBe('needs_setup')
  })

  it('returns Needs setup when no sessions', () => {
    const result = getTurnIndicator(makeProject({ session_count: 0 }), 'builder')
    expect(result?.label).toBe('Needs setup')
    expect(result?.state).toBe('needs_setup')
  })

  it('hides the Needs setup badge from makers (builder-side concern)', () => {
    expect(
      getTurnIndicator(makeProject({ requester_email: undefined }), 'maker')
    ).toBeNull()
    expect(
      getTurnIndicator(makeProject({ session_count: 0 }), 'maker')
    ).toBeNull()
  })

  describe('maker has NOT messaged in current session', () => {
    const project = makeProject({ last_maker_message_at: null })

    it('builder sees "Waiting on {name}"', () => {
      const result = getTurnIndicator(project, 'builder')
      expect(result?.label).toBe('Waiting on Sam')
      expect(result?.className).toContain('blue')
      expect(result?.state).toBe('waiting')
    })

    it('admin sees "Waiting on {name}"', () => {
      const result = getTurnIndicator(project, 'admin')
      expect(result?.label).toBe('Waiting on Sam')
      expect(result?.state).toBe('waiting')
    })

    it('maker sees "Your turn"', () => {
      const result = getTurnIndicator(project, 'maker')
      expect(result?.label).toBe('Your turn')
      expect(result?.className).toContain('amber')
      expect(result?.state).toBe('your_turn')
    })
  })

  describe('maker HAS messaged in current session', () => {
    const project = makeProject({
      latest_session_created_at: '2026-01-01T00:00:00Z',
      last_maker_message_at: '2026-01-01T01:00:00Z',
    })

    it('builder sees "Your turn"', () => {
      const result = getTurnIndicator(project, 'builder')
      expect(result?.label).toBe('Your turn')
      expect(result?.className).toContain('amber')
      expect(result?.state).toBe('your_turn')
    })

    it('maker sees "Waiting for builder"', () => {
      const result = getTurnIndicator(project, 'maker')
      expect(result?.label).toBe('Waiting for builder')
      expect(result?.className).toContain('blue')
      expect(result?.state).toBe('waiting')
    })
  })

  it('falls back to email prefix when no first name', () => {
    const project = makeProject({
      requester_first_name: undefined,
      last_maker_message_at: null,
    })
    const result = getTurnIndicator(project, 'builder')
    expect(result?.label).toBe('Waiting on sam')
  })
})

describe('getTurnIndicator in French', () => {
  it('translates the maker-facing labels and keeps the state', () => {
    const yours = getTurnIndicator(makeProject(), 'maker', 'fr')
    expect(yours?.label).toBe('À vous')
    expect(yours?.state).toBe('your_turn')
    const waiting = getTurnIndicator(
      makeProject({ last_maker_message_at: '2026-01-02T00:00:00Z' }),
      'maker',
      'fr'
    )
    expect(waiting?.label).toBe('En attente du développeur')
    expect(getTurnIndicator(makeProject(), 'builder', 'fr')?.label).toBe('En attente de Sam')
    expect(getTurnIndicator(makeProject({ status: 'completed' }), 'maker', 'fr')?.label).toBe('Terminé')
  })
  describe('maker_waiting', () => {
    const waiting = { maker_waiting_since: '2026-01-02T00:00:00Z' }

    it('shows a builder viewer maker_waiting when set', () => {
      const result = getTurnIndicator(makeProject(waiting), 'builder')
      expect(result?.state).toBe('maker_waiting')
      expect(result?.label).toBe('Maker waiting — nothing queued')
      expect(result?.className).toBe('bg-rose-100 text-rose-700')
    })

    it('never shows the maker viewer maker_waiting', () => {
      expect(getTurnIndicator(makeProject(waiting), 'maker')?.state).toBe('your_turn')
    })

    it('is your_turn once the maker messaged and the flag is cleared', () => {
      const result = getTurnIndicator(
        makeProject({
          maker_waiting_since: null,
          last_maker_message_at: '2026-01-03T00:00:00Z',
        }),
        'builder'
      )
      expect(result?.state).toBe('your_turn')
    })

    it('yields to completed and needs_setup', () => {
      expect(getTurnIndicator(makeProject({ ...waiting, status: 'completed' }), 'builder')?.state).toBe('completed')
      expect(getTurnIndicator(makeProject({ ...waiting, session_count: 0 }), 'builder')?.state).toBe('needs_setup')
    })

    it('has a French label', () => {
      expect(getTurnIndicator(makeProject(waiting), 'builder', 'fr')?.label).toBe('Maker en attente — rien de prévu')
    })
  })
})
