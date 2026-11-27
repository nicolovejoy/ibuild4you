// What the app's own invitation draft must never say (lib/agent/prep-outbound.ts).
//
// To add a rule, add one line here. The rules are part of the prompt, and the
// prompt is part of the draft's cache key, so every brief drafts again on its
// next prep. A builder's own nudge_message is sent word for word and is not
// checked against these.
export const OUTBOUND_RULES: readonly string[] = [
  'how long it takes, or that it is short or quick ("~10 min", "a few minutes", "quick")',
  `anything about the maker's time or convenience ("whenever you've got a moment", "when you get a chance", "no rush")`,
  'praise, thanks in advance, enthusiasm or exclamation marks',
]
