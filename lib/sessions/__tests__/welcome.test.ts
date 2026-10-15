import { describe, it, expect } from 'vitest'
import { welcomeToPost } from '../welcome'

// Which builder-written welcome (if any) becomes a conversation's first
// message. The first conversation always opens with one (the caller supplies
// a default when none is set). A return conversation opens with the
// builder's welcome word for word — but only a welcome written for this
// round: one already used by an earlier conversation is stale, and Sam's
// kickoff greeting takes over instead.
describe('welcomeToPost', () => {
  it('posts the welcome on the first conversation', () => {
    expect(welcomeToPost({ isFirstSession: true, welcome: 'Hi', earlierWelcomes: [] })).toBe('Hi')
  })

  it('returns null on the first conversation with no welcome (caller uses the default)', () => {
    expect(welcomeToPost({ isFirstSession: true, welcome: undefined, earlierWelcomes: [] })).toBeNull()
    expect(welcomeToPost({ isFirstSession: true, welcome: '  ', earlierWelcomes: [] })).toBeNull()
  })

  it('posts a new welcome on a return conversation, verbatim', () => {
    const welcome = 'Hi Elijah. Try https://tideline.ibuild4you.com on your iPhone.'
    expect(welcomeToPost({ isFirstSession: false, welcome, earlierWelcomes: ['Hi Elijah. Spec it here.'] })).toBe(welcome)
  })

  it('does not repeat a welcome an earlier conversation already used', () => {
    expect(welcomeToPost({ isFirstSession: false, welcome: 'Hi', earlierWelcomes: ['Old', 'Hi'] })).toBeNull()
  })

  it('treats whitespace-only differences as the same welcome', () => {
    expect(welcomeToPost({ isFirstSession: false, welcome: 'Hi there\n', earlierWelcomes: [' Hi there'] })).toBeNull()
  })

  it('posts nothing on a return conversation with no welcome', () => {
    expect(welcomeToPost({ isFirstSession: false, welcome: undefined, earlierWelcomes: [] })).toBeNull()
  })

  it('posts a return welcome when earlier conversations carried none', () => {
    expect(welcomeToPost({ isFirstSession: false, welcome: 'Hi', earlierWelcomes: [undefined, null] })).toBe('Hi')
  })
})
