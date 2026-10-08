// Pure decisions for the maker chat composer (#183). Kept free of React so
// the Enter-vs-newline rule and the auto-grow cap are unit-testable.

// Tallest the composer grows before it scrolls internally. ~8 lines at the
// 16px/24px line-height we use; past that the transcript would be crowded
// out on a phone.
export const COMPOSER_MAX_PX = 200

export interface EnterDecision {
  key: string
  // Cmd (Mac) / Ctrl (everywhere else) held with Enter is the keyboard send.
  metaKey: boolean
  ctrlKey: boolean
  // event.nativeEvent.isComposing — true while an IME (Japanese, Chinese,
  // Korean keyboards) is still choosing a candidate. Enter commits the
  // candidate there; it must never send the message.
  isComposing: boolean
}

// Enter inserts a newline on every device; only Cmd/Ctrl+Enter or the Send
// button sends. One rule everywhere — the first cut keyed this on
// (pointer: coarse) and still sent on Nico's phone test, and a device sniff
// also had no answer for an iPad with a keyboard.
export function shouldSendOnEnter({ key, metaKey, ctrlKey, isComposing }: EnterDecision): boolean {
  if (key !== 'Enter') return false
  if (isComposing) return false
  return metaKey || ctrlKey
}

// Auto-grow: the textarea's would-be border-box height (scrollHeight plus its
// borders) clamped to the cap.
export function composerHeightPx(borderBoxPx: number): number {
  return Math.max(0, Math.min(borderBoxPx, COMPOSER_MAX_PX))
}
