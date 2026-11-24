import { describe, it, expect } from 'vitest'
import {
  makerAnsweredOpening,
  makerRepliedSinceReopen,
  reopenPoint,
  type ReplyCheckMessage,
} from '../maker-replied'

const T0 = '2026-11-01T10:00:00.000Z'
const T1 = '2026-11-01T11:00:00.000Z'
const T2 = '2026-11-01T12:00:00.000Z'
const T3 = '2026-11-01T13:00:00.000Z'
const T4 = '2026-11-01T14:00:00.000Z'

const user = (created_at: string): ReplyCheckMessage => ({ role: 'user', created_at })
const agent = (created_at: string, kind?: string): ReplyCheckMessage => ({ role: 'agent', kind, created_at })

describe('makerAnsweredOpening', () => {
  it('no messages → false', () => {
    expect(makerAnsweredOpening([])).toBe(false)
  })

  it('an untagged welcome only → false', () => {
    expect(makerAnsweredOpening([agent(T1)])).toBe(false)
  })

  it('any maker message counts when no welcome is tagged', () => {
    expect(makerAnsweredOpening([agent(T1), user(T2)])).toBe(true)
    // A maker message before an untagged agent message counts too (today's rule).
    expect(makerAnsweredOpening([user(T0), agent(T1)])).toBe(true)
  })

  it('a maker message before a tagged welcome does not count', () => {
    expect(makerAnsweredOpening([user(T1), agent(T2), agent(T3, 'welcome')])).toBe(false)
  })

  it('a maker message after a tagged welcome counts', () => {
    expect(makerAnsweredOpening([user(T1), agent(T2), agent(T3, 'welcome'), user(T4)])).toBe(true)
  })

  it('the newest tagged welcome is the one that counts', () => {
    expect(makerAnsweredOpening([agent(T1, 'welcome'), user(T2), agent(T3, 'welcome')])).toBe(false)
  })

  it('a canned greeting is not an opening here', () => {
    expect(makerAnsweredOpening([user(T1), agent(T2), agent(T3, 'unqueued_greeting')])).toBe(true)
  })
})

describe('makerRepliedSinceReopen', () => {
  it('a maker message before the greeting does not count', () => {
    expect(makerRepliedSinceReopen([user(T1), agent(T2, 'unqueued_greeting')])).toBe(false)
  })

  it('a maker message after the greeting counts', () => {
    expect(makerRepliedSinceReopen([agent(T1, 'unqueued_greeting'), user(T2)])).toBe(true)
  })

  it('a maker message before a tagged welcome does not count', () => {
    expect(makerRepliedSinceReopen([user(T1), agent(T2, 'welcome')])).toBe(false)
  })

  it('uses the newer of greeting and welcome', () => {
    expect(
      makerRepliedSinceReopen([agent(T1, 'welcome'), user(T2), agent(T3, 'unqueued_greeting')])
    ).toBe(false)
    expect(
      makerRepliedSinceReopen([agent(T1, 'unqueued_greeting'), agent(T2, 'welcome'), user(T3)])
    ).toBe(true)
  })

  it('no greeting and no welcome: any maker message counts', () => {
    expect(makerRepliedSinceReopen([user(T1)])).toBe(true)
  })
})

describe('reopenPoint', () => {
  it('returns null with neither kind present', () => {
    expect(reopenPoint([user(T1), agent(T2)])).toBeNull()
  })

  it('returns the newest created_at among welcome and greeting messages, in any array order', () => {
    expect(
      reopenPoint([agent(T3, 'unqueued_greeting'), user(T4), agent(T1, 'welcome'), agent(T2, 'welcome')])
    ).toBe(T3)
  })
})
