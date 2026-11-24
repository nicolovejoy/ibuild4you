import { describe, it, expect } from 'vitest'
import { nextRound } from '../next-round'

const session = (id: string, welcome?: string) => ({ id, welcome_message: welcome })

describe('nextRound: what the next conversation would open with', () => {
  it('opens a first conversation with the builder welcome, word for word', () => {
    const r = nextRound({
      project: { welcome_message: 'Hi Maya!' },
      sessions: [],
      unusedSessionId: null,
    })
    expect(r.opening).toEqual({ kind: 'welcome', text: 'Hi Maya!' })
  })

  it('falls back to the default welcome on a first conversation with none set', () => {
    const r = nextRound({ project: {}, sessions: [], unusedSessionId: null })
    expect(r.opening).toEqual({ kind: 'default' })
  })

  it('posts a welcome on a return conversation only when no earlier one used it', () => {
    const fresh = nextRound({
      project: { welcome_message: 'Round two' },
      sessions: [session('s1', 'Round one')],
      unusedSessionId: null,
    })
    expect(fresh.opening).toEqual({ kind: 'welcome', text: 'Round two' })

    // Something was pasted since the maker last spoke: Sam greets with it.
    const used = nextRound({
      project: {
        welcome_message: 'Round one',
        payload_pasted_at: '2026-11-23T10:00:00.000Z',
        last_maker_message_at: '2026-11-22T10:00:00.000Z',
      },
      sessions: [session('s1', 'Round one')],
      unusedSessionId: null,
    })
    expect(used.opening).toEqual({ kind: 'kickoff' })
  })

  it('opens with the canned note when nothing was pasted since the maker last spoke', () => {
    const base = { welcome_message: 'Round one' }
    const sessions = [session('s1', 'Round one')]
    // Never pasted.
    expect(nextRound({ project: base, sessions, unusedSessionId: null }).opening).toEqual({ kind: 'nothing_queued' })
    // Pasted, but before the maker's last message.
    expect(
      nextRound({
        project: { ...base, payload_pasted_at: '2026-11-21T10:00:00.000Z', last_maker_message_at: '2026-11-22T10:00:00.000Z' },
        sessions,
        unusedSessionId: null,
      }).opening
    ).toEqual({ kind: 'nothing_queued' })
  })

  it('does not count a conversation the maker never spoke in as having used its welcome', () => {
    const r = nextRound({
      project: { welcome_message: 'Round two' },
      sessions: [session('s2', 'Round two'), session('s1', 'Round one')],
      unusedSessionId: 's2',
    })
    expect(r.opening).toEqual({ kind: 'welcome', text: 'Round two' })
  })

  it('lists seed questions in discover mode and directives in converge mode', () => {
    const project = { seed_questions: ['q1', 'q2'], builder_directives: ['d1'] }
    expect(nextRound({ project, sessions: [], unusedSessionId: null })).toMatchObject({
      mode: 'discover',
      points: ['q1', 'q2'],
    })
    expect(
      nextRound({
        project: { ...project, session_mode: 'converge' },
        sessions: [],
        unusedSessionId: null,
      })
    ).toMatchObject({ mode: 'converge', points: ['d1'] })
  })

  it('carries the nudge override and the paste stamp, or null for each', () => {
    const none = nextRound({ project: {}, sessions: [], unusedSessionId: null })
    expect(none.nudge).toBeNull()
    expect(none.pastedAt).toBeNull()
    expect(none.pastedVersion).toBeNull()

    const set = nextRound({
      project: {
        nudge_message: ' Come back! ',
        payload_pasted_at: '2026-11-19T18:00:00.000Z',
        payload_pasted_version: 14,
      },
      sessions: [],
      unusedSessionId: null,
    })
    expect(set.nudge).toBe(' Come back! ')
    expect(set.pastedAt).toBe('2026-11-19T18:00:00.000Z')
    expect(set.pastedVersion).toBe(14)
  })

  it('treats a blank nudge as none', () => {
    expect(
      nextRound({ project: { nudge_message: '  ' }, sessions: [], unusedSessionId: null }).nudge
    ).toBeNull()
  })
})
