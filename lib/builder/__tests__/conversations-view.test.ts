import { describe, it, expect } from 'vitest'
import {
  makerRoster,
  getDispatchState,
  conversationLabel,
  remindersStripLine,
} from '../conversations-view'
import type { ProjectMemberSummary } from '@/lib/types'

const member = (over: Partial<ProjectMemberSummary>): ProjectMemberSummary => ({
  id: 'm1',
  email: 'mae@example.com',
  display_name: 'Mae Lin',
  role: 'maker',
  brief_role: 'originator',
  added_by: null,
  created_at: null,
  removed_at: null,
  ...over,
})

describe('makerRoster', () => {
  it('joins active maker first names with +', () => {
    const roster = makerRoster(
      [
        member({ id: 'm1', email: 'mae@example.com', display_name: 'Mae Lin' }),
        member({ id: 'm2', email: 'sid@example.com', display_name: 'Sid Roy' }),
      ],
      { requester_email: 'mae@example.com', requester_first_name: 'Mae' }
    )
    expect(roster.names).toBe('Mae + Sid')
    expect(roster.emails).toEqual(['mae@example.com', 'sid@example.com'])
    expect(roster.canSend).toBe(true)
  })

  it('skips non-maker and removed members', () => {
    const roster = makerRoster(
      [
        member({ id: 'm1', display_name: 'Mae Lin' }),
        member({ id: 'm2', email: 'gone@example.com', display_name: 'Gone P', removed_at: '2026-01-01' }),
        member({ id: 'm3', email: 'b@example.com', display_name: 'Bea B', role: 'builder' }),
      ],
      {}
    )
    expect(roster.names).toBe('Mae')
    expect(roster.emails).toEqual(['mae@example.com'])
  })

  it('falls back to email prefix when display name is missing', () => {
    const roster = makerRoster([member({ display_name: '' })], {})
    expect(roster.names).toBe('mae')
  })

  it('falls back to legacy requester fields when there are no member rows', () => {
    const roster = makerRoster([], {
      requester_email: 'sam@example.com',
      requester_first_name: 'Sam',
    })
    expect(roster.names).toBe('Sam')
    expect(roster.emails).toEqual(['sam@example.com'])
    expect(roster.canSend).toBe(true)
  })

  it('reports nothing to send to on an unshared brief', () => {
    const roster = makerRoster([], {})
    expect(roster.names).toBe('the maker')
    expect(roster.emails).toEqual([])
    expect(roster.canSend).toBe(false)
  })
})

describe('getDispatchState', () => {
  const twoMakers = [
    member({ id: 'm1', display_name: 'Mae Lin' }),
    member({ id: 'm2', email: 'sid@example.com', display_name: 'Sid Roy' }),
  ]

  it('is invite when no maker has been shared with yet', () => {
    const s = getDispatchState({
      project: {},
      members: [],
      sessionCount: 0,
      hasActiveSession: false,
      makerRepliedInActive: false,
    })
    expect(s.kind).toBe('invite')
  })

  it('is nudge while the active conversation is waiting on the maker', () => {
    const s = getDispatchState({
      project: { requester_email: 'mae@example.com', requester_first_name: 'Mae' },
      members: twoMakers,
      sessionCount: 2,
      hasActiveSession: true,
      makerRepliedInActive: false,
    })
    expect(s).toEqual({ kind: 'nudge', makerNames: 'Mae + Sid', sessionNumber: 2 })
  })

  it('is start (next round) once the maker has replied', () => {
    const s = getDispatchState({
      project: { requester_email: 'mae@example.com' },
      members: twoMakers,
      sessionCount: 2,
      hasActiveSession: true,
      makerRepliedInActive: true,
    })
    expect(s).toEqual({ kind: 'start', sessionNumber: 3, makerNames: 'Mae + Sid', canSend: true })
  })

  it('is start when there is no active session at all', () => {
    const s = getDispatchState({
      project: { requester_email: 'mae@example.com' },
      members: twoMakers,
      sessionCount: 1,
      hasActiveSession: false,
      makerRepliedInActive: false,
    })
    expect(s).toEqual({ kind: 'start', sessionNumber: 2, makerNames: 'Mae + Sid', canSend: true })
  })
})

describe('conversationLabel', () => {
  it('labels the live conversation as in progress', () => {
    expect(conversationLabel(3, 'active')).toBe('Conversation 3 · in progress')
  })
  it('labels a closed conversation as completed', () => {
    expect(conversationLabel(2, 'completed')).toBe('Conversation 2 · completed')
  })
  it('labels an archived conversation', () => {
    expect(conversationLabel(1, 'archived')).toBe('Conversation 1 · archived')
  })
})

describe('remindersStripLine', () => {
  const NOW = Date.parse('2026-07-10T12:00:00Z')

  it('says off when reminders are disabled', () => {
    expect(remindersStripLine({}, NOW)).toBe('Reminders off')
  })

  it('shows the next send when one is scheduled', () => {
    const line = remindersStripLine(
      {
        auto_reminders_enabled: true,
        requester_email: 'mae@example.com',
        latest_session_created_at: '2026-07-09T12:00:00Z',
      },
      NOW
    )
    // 2-day cadence from the session start → ~1 day out
    expect(line).toBe('Reminders on · next in ~1 day')
  })

  it('says due now when the send date has passed', () => {
    const line = remindersStripLine(
      {
        auto_reminders_enabled: true,
        requester_email: 'mae@example.com',
        latest_session_created_at: '2026-07-01T12:00:00Z',
      },
      NOW
    )
    expect(line).toBe('Reminders on · due now')
  })

  it('says paused once the maker replied', () => {
    const line = remindersStripLine(
      {
        auto_reminders_enabled: true,
        requester_email: 'mae@example.com',
        latest_session_created_at: '2026-07-01T12:00:00Z',
        last_maker_message_at: '2026-07-02T12:00:00Z',
      },
      NOW
    )
    expect(line).toBe('Reminders on · paused (maker replied)')
  })

  it('says all sent at the cap', () => {
    const line = remindersStripLine(
      {
        auto_reminders_enabled: true,
        requester_email: 'mae@example.com',
        reminders_sent_count: 3,
      },
      NOW
    )
    expect(line).toBe('Reminders on · all 3 sent')
  })
})
