// lib/chat/__tests__/composer.test.ts
import { describe, it, expect } from 'vitest'
import { shouldSendOnEnter, composerHeightPx, COMPOSER_MAX_PX } from '../composer'

const base = { key: 'Enter', metaKey: false, ctrlKey: false, isComposing: false }

describe('shouldSendOnEnter', () => {
  it('does not send on plain Enter (newline on every device)', () => {
    expect(shouldSendOnEnter(base)).toBe(false)
  })
  it('sends on Cmd+Enter (Mac)', () => {
    expect(shouldSendOnEnter({ ...base, metaKey: true })).toBe(true)
  })
  it('sends on Ctrl+Enter (Windows, Linux, Chromebook)', () => {
    expect(shouldSendOnEnter({ ...base, ctrlKey: true })).toBe(true)
  })
  it('does not send while an IME composition is in progress, even with a modifier', () => {
    expect(shouldSendOnEnter({ ...base, metaKey: true, isComposing: true })).toBe(false)
  })
  it('ignores every other key', () => {
    expect(shouldSendOnEnter({ ...base, key: 'a', metaKey: true })).toBe(false)
    expect(shouldSendOnEnter({ ...base, key: 'Tab', ctrlKey: true })).toBe(false)
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
