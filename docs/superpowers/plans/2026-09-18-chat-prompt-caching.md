# Chat route prompt caching — plan

**Why.** Anthropic emailed that the org's prompt-cache hit rate is low. The
hottest path, `POST /api/chat` (`app/api/chat/route.ts`), only places a
`cache_control` marker when the latest user message carries an attachment
(route.ts ~L255-268). A text-only conversation therefore re-sends the whole
system prompt (living brief, directives, mockups, sibling decisions — well
over Sonnet 4.6's 1024-token cache minimum) plus full history at full input
price on every turn. Turns in a live conversation arrive well inside the
5-minute cache TTL, so caching the prefix makes every turn after the first
read it at ~0.1x.

**Spec (binding).**
- Every `/api/chat` request marks its prefix for caching so the next turn's
  request reads it: one marker on the (single) system text block and one on
  the last content block of the last message.
- Never exceed Anthropic's cap of 4 `cache_control` markers per request
  (a 5th → HTTP 400). The existing attachment marker stays; existing
  attachment tests must keep passing.
- No behaviour change to the prompt text, model, temperature, max_tokens, or
  message order/content other than wrapping string content into a single
  text block where a marker must be attached.
- SDK is `@anthropic-ai/sdk` 0.57.0 — its `MessageCreateParams` has NO
  top-level `cache_control` field, so use explicit block-level markers (do
  not bump the SDK in this change).

**Out of scope (Ruling, controller).** `/api/chat/kickoff` is NOT cached.
Kickoff only fires after a ≥1hr gap or on an empty return session, so its
system prompt carries the "coming back after a gap" block
(`lib/agent/system-prompt.ts` ~L218) that the maker's very next chat turn
will not — the prefix never matches, so a marker there would pay the 1.25x
cache-write premium for no read. Cost if wrong: kickoff stays uncached, a
single call per session.

**Global constraints.**
- TDD: failing test first, then implementation.
- Match surrounding code style (no semicolons, single quotes, 2-space,
  explanatory comments where non-obvious — see route.ts).
- Before claiming clean, run in the worktree: `npm test`, `npm run lint`,
  `npm run build` AND `npm run type-check` (in a fresh worktree, `type-check`
  alone is a false green — see CLAUDE.md).

## Task 1: Cache the chat prefix

Files:
- Create `lib/agent/prompt-cache.ts` exporting
  `applyPromptCaching(system: string, messages: M[]): { system: TextBlockParam-like[]; messages: M[] }`
  (use the Anthropic SDK types where they fit; `M` is the route's message
  shape `{ role: 'user' | 'assistant'; content: string | ContentBlock[] }`).
  Behaviour:
  1. `system` → `[{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }]`.
  2. Last message: if `content` is a string, convert to
     `[{ type: 'text', text: content, cache_control: { type: 'ephemeral' } }]`;
     if an array, set `cache_control: { type: 'ephemeral' }` on its last block
     (already-marked block → leave as is, don't double count).
  3. Count all markers in the result (system + every message block). If it
     would exceed 4, drop markers from the EARLIEST message blocks first,
     never the system or the last-message marker. (In practice today the
     count is ≤3; this is a guard.)
  4. Do not mutate the inputs (return new arrays/objects for anything
     changed).
  5. Empty `messages` → return messages unchanged.
- Create `lib/agent/__tests__/prompt-cache.test.ts` covering 1–5.
- Modify `app/api/chat/route.ts`: pass the result of
  `applyPromptCaching(systemPrompt, claudeMessages)` into
  `getAnthropic().messages.stream({...})` in place of `system`/`messages`.
  Keep the existing attachment-marker loop. Update the stale comment above
  that loop to say it now coexists with the system + last-message markers.
- Modify `app/api/chat/__tests__/chat.test.ts` (and/or
  `chat-attachments.test.ts`): assert the `messages.stream` call receives a
  system array whose single block has `cache_control: { type: 'ephemeral' }`,
  that the last message's last block is marked, and that the total marker
  count is ≤ 4 in the many-attachments case.
