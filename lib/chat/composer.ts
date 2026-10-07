// Pure decisions for the maker chat composer (#183). Kept free of React so
// the Enter-vs-newline rule and the auto-grow cap are unit-testable.

// Tallest the composer grows before it scrolls internally. ~8 lines at the
// 16px/24px line-height we use; past that the transcript would be crowded
// out on a phone.
export const COMPOSER_MAX_PX = 200

export interface EnterDecision {
  key: string
  shiftKey: boolean
  // event.nativeEvent.isComposing — true while an IME (Japanese, Chinese,
  // Korean keyboards) is still choosing a candidate. Enter commits the
  // candidate there; it must never send the message.
  isComposing: boolean
  // (pointer: coarse) — a touch screen. There is no Shift key worth relying
  // on, so Enter means "new line" and the send button is the only submit.
  coarsePointer: boolean
}

export function shouldSendOnEnter({
  key,
  shiftKey,
  isComposing,
  coarsePointer,
}: EnterDecision): boolean {
  if (key !== 'Enter') return false
  if (isComposing) return false
  if (coarsePointer) return false
  return !shiftKey
}

// Auto-grow: the textarea's scrollHeight (content height) clamped to the cap.
export function composerHeightPx(scrollHeight: number): number {
  return Math.max(0, Math.min(scrollHeight, COMPOSER_MAX_PX))
}
