import { describe, it, expect } from 'vitest'
import { groupBriefs, shouldFlatten, type SectionKey } from '../group-briefs'
import type { Project } from '@/lib/types'

// Minimal enriched-project fixture. Defaults make a "your turn for the maker"
// brief; override per case. Timestamps drive within-section activity sort.
function brief(over: Partial<Project> = {}): Project {
  return {
    id: 'p1',
    requester_id: 'u1',
    title: 'A brief',
    status: 'active',
    created_at: '2026-06-01T00:00:00.000Z',
    updated_at: '2026-06-01T00:00:00.000Z',
    // enrichment fields that getTurnIndicator reads
    requester_email: 'm@x.com',
    session_count: 1,
    viewer_role: 'maker',
    viewer_brief_role: 'originator',
    ...over,
  } as Project
}

function section(sections: ReturnType<typeof groupBriefs>, key: SectionKey) {
  return sections.find((s) => s.key === key)!
}
function ids(sections: ReturnType<typeof groupBriefs>, key: SectionKey) {
  return section(sections, key).briefs.map((b) => b.id)
}

describe('groupBriefs', () => {
  it('returns the six sections in fixed order', () => {
    const out = groupBriefs([])
    expect(out.map((s) => s.key)).toEqual([
      'awaiting',
      'yours',
      'reviewing',
      'contributing',
      'done',
      'archived',
    ])
  })

  it('puts a your-turn brief in Awaiting you regardless of role', () => {
    // maker who hasn't responded => your_turn
    const out = groupBriefs([brief({ id: 'mine', viewer_role: 'maker' })])
    expect(ids(out, 'awaiting')).toEqual(['mine'])
    expect(ids(out, 'yours')).toEqual([])
  })

  it('routes an operator needs-setup brief to Awaiting you', () => {
    const out = groupBriefs([
      brief({ id: 'setup', viewer_role: 'builder', requester_email: undefined, session_count: 0 }),
    ])
    expect(ids(out, 'awaiting')).toEqual(['setup'])
  })

  it('groups non-awaiting briefs by stored brief role', () => {
    // waiting-state briefs (maker has responded => operator waiting; here we make
    // the viewer a non-maker waiting on the maker, i.e. maker has NOT messaged)
    const reviewing = brief({
      id: 'rev',
      viewer_role: 'builder',
      viewer_brief_role: 'reviewer',
    })
    const contributing = brief({
      id: 'con',
      viewer_role: 'apprentice',
      viewer_brief_role: 'contributor',
    })
    const out = groupBriefs([reviewing, contributing])
    expect(ids(out, 'reviewing')).toEqual(['rev'])
    expect(ids(out, 'contributing')).toEqual(['con'])
    expect(ids(out, 'awaiting')).toEqual([])
  })

  it('falls back to access-tier role when no stored brief_role', () => {
    const out = groupBriefs([
      brief({ id: 'r', viewer_role: 'builder', viewer_brief_role: null }),
    ])
    expect(ids(out, 'reviewing')).toEqual(['r'])
  })

  it('sends completed briefs to Done, overriding turn state', () => {
    const out = groupBriefs([
      brief({ id: 'done', status: 'completed', viewer_role: 'maker' }),
    ])
    expect(ids(out, 'done')).toEqual(['done'])
    expect(ids(out, 'awaiting')).toEqual([])
  })

  it('routes an archived brief to Archived, overriding turn state and role', () => {
    const out = groupBriefs([
      brief({ id: 'arch', viewer_role: 'maker', viewer_archived: true }),
    ])
    expect(ids(out, 'archived')).toEqual(['arch'])
    expect(ids(out, 'awaiting')).toEqual([])
  })

  it('archived overrides completed', () => {
    const out = groupBriefs([
      brief({ id: 'both', status: 'completed', viewer_archived: true }),
    ])
    expect(ids(out, 'archived')).toEqual(['both'])
    expect(ids(out, 'done')).toEqual([])
  })

  it('carries the Archived section title from copy', () => {
    expect(section(groupBriefs([]), 'archived').title).toBe('Archived')
  })

  it('sorts within a section by activity, newest first', () => {
    const older = brief({ id: 'old', viewer_role: 'maker', last_message_at: '2026-06-01T00:00:00.000Z' })
    const newer = brief({ id: 'new', viewer_role: 'maker', last_message_at: '2026-06-10T00:00:00.000Z' })
    const out = groupBriefs([older, newer])
    expect(ids(out, 'awaiting')).toEqual(['new', 'old'])
  })

  it('orders your-turn ahead of needs-setup inside Awaiting you', () => {
    const setup = brief({
      id: 'setup',
      viewer_role: 'builder',
      requester_email: undefined,
      session_count: 0,
      last_message_at: '2026-06-20T00:00:00.000Z', // newer, but lower urgency
    })
    const turn = brief({
      id: 'turn',
      viewer_role: 'maker',
      last_message_at: '2026-06-01T00:00:00.000Z',
    })
    const out = groupBriefs([setup, turn])
    expect(ids(out, 'awaiting')).toEqual(['turn', 'setup'])
  })

  it('carries section titles and role-section empty hints from copy', () => {
    const out = groupBriefs([])
    expect(section(out, 'awaiting').title).toBe('Awaiting you')
    expect(section(out, 'awaiting').emptyHint).toBeUndefined()
    expect(section(out, 'done').emptyHint).toBeUndefined()
    expect(section(out, 'reviewing').emptyHint).toBeTruthy()
  })
})

describe('shouldFlatten', () => {
  it('flattens when everything lands in one section', () => {
    const out = groupBriefs([
      brief({ id: 'a', viewer_role: 'maker', last_message_at: '2026-06-01T00:00:00.000Z' }),
      brief({ id: 'b', viewer_role: 'maker', last_message_at: '2026-06-02T00:00:00.000Z' }),
      brief({ id: 'c', viewer_role: 'maker', last_message_at: '2026-06-03T00:00:00.000Z' }),
      brief({ id: 'd', viewer_role: 'maker', last_message_at: '2026-06-04T00:00:00.000Z' }),
    ])
    expect(shouldFlatten(out)).toBe(true)
  })

  it('flattens a small total even when spread across sections', () => {
    const out = groupBriefs([
      brief({ id: 'a', viewer_role: 'maker' }), // awaiting
      brief({ id: 'b', viewer_role: 'builder', viewer_brief_role: 'reviewer' }), // reviewing
    ])
    expect(shouldFlatten(out)).toBe(true)
  })

  it('does not flatten when multiple sections each hold enough briefs', () => {
    const mk = (n: number, over: Partial<Project>) =>
      Array.from({ length: n }, (_, i) => brief({ id: `${i}`, ...over }))
    const out = groupBriefs([
      ...mk(2, { viewer_role: 'maker' }), // awaiting
      ...mk(2, { viewer_role: 'builder', viewer_brief_role: 'reviewer' }), // reviewing
    ])
    expect(shouldFlatten(out)).toBe(false)
  })

  it('does not flatten when any brief is archived, even on a small dashboard', () => {
    // 1 active + 1 archived: must stay sectioned so the archived folder is
    // separate and the archived brief never shows inline.
    const out = groupBriefs([
      brief({ id: 'a', viewer_role: 'maker' }),
      brief({ id: 'arch', viewer_role: 'maker', viewer_archived: true }),
    ])
    expect(shouldFlatten(out)).toBe(false)
  })
})
