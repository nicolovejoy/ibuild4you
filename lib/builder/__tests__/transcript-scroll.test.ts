import { describe, it, expect } from 'vitest'
import { hiddenMessageCounts, offscreenLabel } from '../transcript-scroll'

// #146 — the builder transcript pane auto-scrolls to the newest message inside
// a fixed-height scroll box; without an affordance, earlier messages read as
// lost. hiddenMessageCounts says how many bubbles sit fully above/below the
// visible window so the overlay pills can label themselves.

// Five bubbles, 100px tall, stacked with no gaps: tops at 0..400.
const boxes = Array.from({ length: 5 }, (_, i) => ({ top: i * 100, height: 100 }))

describe('hiddenMessageCounts', () => {
  it('scrolled to bottom: everything before the window counts as above', () => {
    // Window shows the last two bubbles (300–500).
    expect(hiddenMessageCounts(boxes, 300, 200)).toEqual({ above: 3, below: 0 })
  })

  it('scrolled to top: everything after the window counts as below', () => {
    expect(hiddenMessageCounts(boxes, 0, 200)).toEqual({ above: 0, below: 3 })
  })

  it('mid-scroll counts both directions', () => {
    // Window 150–350: bubble 0 fully above; bubble 3 peeks in (visible); bubble 4 fully below.
    expect(hiddenMessageCounts(boxes, 150, 200)).toEqual({ above: 1, below: 1 })
  })

  it('partially visible bubbles count as visible, not hidden', () => {
    // Window 50–450: bubble 0 half-shown, bubble 4 half-shown — neither hidden.
    expect(hiddenMessageCounts(boxes, 50, 400)).toEqual({ above: 0, below: 0 })
  })

  it('everything visible → zero both ways', () => {
    expect(hiddenMessageCounts(boxes, 0, 500)).toEqual({ above: 0, below: 0 })
  })

  it('tolerates sub-pixel scroll positions (epsilon)', () => {
    // Browsers report fractional scrollTop; 299.6 must count like 300.
    expect(hiddenMessageCounts(boxes, 299.6, 200)).toEqual({ above: 3, below: 0 })
  })

  it('empty transcript → zeros', () => {
    expect(hiddenMessageCounts([], 0, 200)).toEqual({ above: 0, below: 0 })
  })
})

describe('offscreenLabel', () => {
  it('pluralizes', () => {
    expect(offscreenLabel(32, 'earlier')).toBe('↑ 32 earlier messages')
    expect(offscreenLabel(1, 'earlier')).toBe('↑ 1 earlier message')
    expect(offscreenLabel(2, 'later')).toBe('↓ 2 later messages')
    expect(offscreenLabel(1, 'later')).toBe('↓ 1 later message')
  })
})
