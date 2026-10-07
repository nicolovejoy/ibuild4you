// lib/chat/__tests__/composer.test.ts
import { describe, it, expect } from 'vitest'
import { shouldSendOnEnter, composerHeightPx, COMPOSER_MAX_PX } from '../composer'

const base = { key: 'Enter', shiftKey: false, isComposing: false, coarsePointer: false }

describe('shouldSendOnEnter', () => {
  it('sends on plain Enter with a fine pointer (desktop)', () => {
    expect(shouldSendOnEnter(base)).toBe(true)
  })
  it('does not send on Shift+Enter (desktop newline)', () => {
    expect(shouldSendOnEnter({ ...base, shiftKey: true })).toBe(false)
  })
  it('does not send on Enter with a coarse pointer (phone newline)', () => {
    expect(shouldSendOnEnter({ ...base, coarsePointer: true })).toBe(false)
  })
  it('does not send while an IME composition is in progress', () => {
    expect(shouldSendOnEnter({ ...base, isComposing: true })).toBe(false)
  })
  it('ignores every other key', () => {
    expect(shouldSendOnEnter({ ...base, key: 'a' })).toBe(false)
    expect(shouldSendOnEnter({ ...base, key: 'Tab' })).toBe(false)
  })
})

describe('composerHeightPx', () => {
  it('returns the content height when under the cap', () => {
    expect(composerHeightPx(44)).toBe(44)
  })
  it('clamps to the cap so a wall of text cannot push the chat off screen', () => {
    expect(composerHeightPx(900)).toBe(COMPOSER_MAX_PX)
  })
  it('never returns a negative height', () => {
    expect(composerHeightPx(-10)).toBe(0)
  })
})
