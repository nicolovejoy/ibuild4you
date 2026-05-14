import { describe, it, expect } from 'vitest'
import { sortProjectsByActivity, projectActivityKey } from '../sort-projects-by-activity'

describe('projectActivityKey', () => {
  it('returns the latest of last_message_at, last_builder_activity_at, created_at', () => {
    expect(
      projectActivityKey({
        created_at: '2026-01-01T00:00:00.000Z',
        last_message_at: '2026-03-01T00:00:00.000Z',
        last_builder_activity_at: '2026-02-01T00:00:00.000Z',
      })
    ).toBe('2026-03-01T00:00:00.000Z')

    expect(
      projectActivityKey({
        created_at: '2026-01-01T00:00:00.000Z',
        last_message_at: '2026-02-01T00:00:00.000Z',
        last_builder_activity_at: '2026-04-01T00:00:00.000Z',
      })
    ).toBe('2026-04-01T00:00:00.000Z')
  })

  it('falls back to created_at when no activity timestamps are set', () => {
    expect(
      projectActivityKey({
        created_at: '2026-01-01T00:00:00.000Z',
        last_message_at: null,
        last_builder_activity_at: undefined,
      })
    ).toBe('2026-01-01T00:00:00.000Z')
  })

  it('treats nulls and undefineds as missing (does not coerce them as smallest)', () => {
    expect(
      projectActivityKey({
        created_at: '2026-01-01T00:00:00.000Z',
        last_message_at: null,
        last_builder_activity_at: '2026-02-01T00:00:00.000Z',
      })
    ).toBe('2026-02-01T00:00:00.000Z')
  })

  it('returns empty string when even created_at is missing (sort to bottom)', () => {
    expect(projectActivityKey({})).toBe('')
  })
})

describe('sortProjectsByActivity', () => {
  it('sorts projects newest-activity-first', () => {
    const projects = [
      { id: 'a', created_at: '2026-01-01', last_message_at: '2026-02-01' },
      { id: 'b', created_at: '2026-01-15', last_message_at: null, last_builder_activity_at: '2026-04-01' },
      { id: 'c', created_at: '2026-03-01' },
    ]
    const sorted = sortProjectsByActivity(projects)
    // b: builder activity 2026-04-01 → first
    // c: created 2026-03-01, no other activity → second
    // a: last message 2026-02-01 → last
    expect(sorted.map((p) => p.id)).toEqual(['b', 'c', 'a'])
  })

  it('uses created_at to break ties between two same-activity projects', () => {
    const projects = [
      { id: 'older', created_at: '2026-01-01', last_message_at: '2026-05-01' },
      { id: 'newer', created_at: '2026-04-01', last_message_at: '2026-05-01' },
    ]
    const sorted = sortProjectsByActivity(projects)
    expect(sorted.map((p) => p.id)).toEqual(['newer', 'older'])
  })

  it('does not mutate the input array', () => {
    const input = [
      { id: 'a', created_at: '2026-01-01' },
      { id: 'b', created_at: '2026-02-01' },
    ]
    const before = input.map((p) => p.id)
    sortProjectsByActivity(input)
    expect(input.map((p) => p.id)).toEqual(before)
  })

  it('handles an empty list', () => {
    expect(sortProjectsByActivity([])).toEqual([])
  })
})
