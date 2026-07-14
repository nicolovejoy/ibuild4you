// #146 — scroll affordance for the builder transcript pane. The transcript
// lives in a fixed-height scroll box auto-scrolled to the newest message;
// these helpers tell the overlay pills how many bubbles are hidden in each
// direction so "↑ 32 earlier messages" can be exact.

export type BubbleBox = { top: number; height: number }

// How long the reader must stay still before the pills return.
export const TRANSCRIPT_PILL_IDLE_MS = 10_000

// Browsers report fractional scrollTop; treat near-boundary bubbles as hidden.
const EPSILON = 1

// Count bubbles fully above / fully below the visible window. Partially
// visible bubbles count as visible (the reader can already see them).
export function hiddenMessageCounts(
  boxes: BubbleBox[],
  scrollTop: number,
  clientHeight: number
): { above: number; below: number } {
  const viewTop = scrollTop
  const viewBottom = scrollTop + clientHeight
  let above = 0
  let below = 0
  for (const box of boxes) {
    if (box.top + box.height <= viewTop + EPSILON) above++
    else if (box.top >= viewBottom - EPSILON) below++
  }
  return { above, below }
}

export function offscreenLabel(count: number, direction: 'earlier' | 'later'): string {
  const arrow = direction === 'earlier' ? '↑' : '↓'
  return `${arrow} ${count} ${direction} ${count === 1 ? 'message' : 'messages'}`
}
