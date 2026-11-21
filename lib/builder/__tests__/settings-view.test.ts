import { describe, it, expect } from 'vitest'
import { samSummary, connectionsSummary, reminderDetail, pacificDay } from '../settings-view'

describe('samSummary', () => {
  it('names the language, the model and the reminders state', () => {
    expect(samSummary({})).toBe('English · Default model · reminders off')
    expect(
      samSummary({ language: 'fr', model: 'claude-opus-5-5', auto_reminders_enabled: true })
    ).toBe('French · Opus 5.5 · reminders on')
  })

  it('reads an unknown model id as Default', () => {
    expect(samSummary({ model: 'gpt-9' })).toBe('English · Default model · reminders off')
  })
})

describe('connectionsSummary', () => {
  it('shows the repo, or says none is linked', () => {
    expect(connectionsSummary({ github_repo: 'owner/cafe' })).toBe('owner/cafe')
    expect(connectionsSummary({ github_repo: '  ' })).toBe('No repo linked')
    expect(connectionsSummary({})).toBe('No repo linked')
  })
})

describe('pacificDay', () => {
  it('shows the Pacific calendar day, not the UTC one', () => {
    // 02:00 UTC on Nov 20 is still Nov 19 in Los Angeles.
    expect(pacificDay('2026-11-20T02:00:00.000Z')).toBe('Nov 19')
  })
})

describe('reminderDetail', () => {
  const now = Date.parse('2026-11-21T18:00:00.000Z')
  const base = {
    auto_reminders_enabled: true,
    requester_email: 'maya@example.com',
    latest_session_created_at: '2026-11-20T18:00:00.000Z',
  }

  it('is null when reminders are off', () => {
    expect(reminderDetail({ ...base, auto_reminders_enabled: false }, now)).toBeNull()
  })

  it('counts what was sent and says when the next one goes', () => {
    const d = reminderDetail(base, now)
    expect(d).toEqual({
      sent: '0 of 3 reminders sent this round',
      next: 'Next reminder: in about 1 day (Nov 22)',
    })
  })

  it('names the last send and says a due reminder goes on the next daily run', () => {
    const d = reminderDetail(
      {
        ...base,
        reminders_sent_count: 1,
        last_reminder_sent_at: '2026-11-10T18:00:00.000Z',
        latest_session_created_at: '2026-11-08T18:00:00.000Z',
      },
      now
    )
    expect(d?.sent).toBe('1 of 3 reminders sent this round · last Nov 10')
    expect(d?.next).toBe('Next reminder: due now (goes out on the next daily run)')
  })

  it('says why nothing is scheduled', () => {
    expect(reminderDetail({ ...base, requester_email: undefined }, now)?.next).toBe(
      'No maker email set. Add one to turn reminders on.'
    )
    expect(reminderDetail({ ...base, reminders_sent_count: 3 }, now)?.next).toBe(
      'All 3 reminders sent. Paused until the maker replies.'
    )
  })
})
