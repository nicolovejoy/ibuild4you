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
    requester_email: 'jamie@example.com',
    requester_first_name: 'Jamie',
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
  })

  it('returns Needs setup when no requester email', () => {
    const result = getTurnIndicator(makeProject({ requester_email: undefined }), 'builder')
    expect(result?.label).toBe('Needs setup')
  })

  it('returns Needs setup when no sessions', () => {
    const result = getTurnIndicator(makeProject({ session_count: 0 }), 'builder')
    expect(result?.label).toBe('Needs setup')
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
      expect(result?.label).toBe('Waiting on Jamie')
      expect(result?.className).toContain('blue')
    })

    it('admin sees "Waiting on {name}"', () => {
      const result = getTurnIndicator(project, 'admin')
      expect(result?.label).toBe('Waiting on Jamie')
    })

    it('maker sees "Your turn"', () => {
      const result = getTurnIndicator(project, 'maker')
      expect(result?.label).toBe('Your turn')
      expect(result?.className).toContain('amber')
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
    })

    it('maker sees "Waiting for builder"', () => {
      const result = getTurnIndicator(project, 'maker')
      expect(result?.label).toBe('Waiting for builder')
      expect(result?.className).toContain('blue')
    })
  })

  it('falls back to email prefix when no first name', () => {
    const project = makeProject({
      requester_first_name: undefined,
      last_maker_message_at: null,
    })
    const result = getTurnIndicator(project, 'builder')
    expect(result?.label).toBe('Waiting on jamie')
  })
})
