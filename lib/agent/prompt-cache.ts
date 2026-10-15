import Anthropic from '@anthropic-ai/sdk'
import type { SystemPromptParts } from './system-prompt'

// Local, minimal shape for a message's content block — wide enough that the
// route's own ClaudeMessage/ContentBlock types satisfy it without a cast,
// but narrow enough to know whether a block already carries cache_control.
type CacheableBlock = { type: string; cache_control?: { type: 'ephemeral' } | null } & Record<string, unknown>

export type CacheableMessage = {
  role: 'user' | 'assistant'
  content: string | CacheableBlock[]
}

const CACHE_CONTROL = { type: 'ephemeral' as const }

// Anthropic 400s a request carrying more than 4 cache_control markers.
const MAX_CACHE_MARKERS = 4

// Wraps a system prompt into the text blocks Anthropic's `system` param
// expects. A plain string becomes one cache-marked block. SystemPromptParts
// becomes a cache-marked `stable` block followed by an UNMARKED `volatile`
// block: Anthropic caches the prefix up to the last marker, so the volatile
// tail (gap recap, prototype age labels - lib/agent/system-prompt.ts) can
// change every turn without invalidating the cached prefix. Shared by
// applyPromptCaching (chat), kickoff (app/api/chat/kickoff/route.ts) and
// the stars-demo facilitator (string form).
//
// Kickoff caches only its system block: it never advances
// last_maker_message_at, so its system prompt is very likely byte-identical
// to the maker's very next /api/chat turn - a real cache read. Kickoff's
// messages end in a synthetic turn that's never sent again, so marking them
// would only pay the cache-write premium for no read.
export function cacheSystemPrompt(system: string | SystemPromptParts): Anthropic.TextBlockParam[] {
  const stable = typeof system === 'string' ? system : system.stable
  const volatile = typeof system === 'string' ? null : system.volatile
  const blocks: Anthropic.TextBlockParam[] = [{ type: 'text', text: stable, cache_control: CACHE_CONTROL }]
  if (volatile) blocks.push({ type: 'text', text: volatile })
  return blocks
}

// Marks the chat prefix for Anthropic prompt caching: one marker on the
// system block and one on the last block of the last message. Turns in a
// live conversation arrive well inside the 5-minute cache TTL, so this makes
// every turn after the first read the (unchanged) prefix at ~0.1x input
// price instead of paying full price every time. See
// docs/superpowers/plans/2026-09-18-chat-prompt-caching.md.
//
// Never mutates its inputs — returns new arrays/objects for anything it
// changes, and returns `messages` untouched when it's empty.
export function applyPromptCaching<M extends CacheableMessage>(
  system: string | SystemPromptParts,
  messages: M[]
): { system: Anthropic.TextBlockParam[]; messages: M[] } {
  const systemBlocks = cacheSystemPrompt(system)

  if (messages.length === 0) {
    return { system: systemBlocks, messages }
  }

  const nextMessages = messages.slice()
  const lastIndex = nextMessages.length - 1
  const last = nextMessages[lastIndex]

  if (typeof last.content === 'string') {
    nextMessages[lastIndex] = {
      ...last,
      content: [{ type: 'text', text: last.content, cache_control: CACHE_CONTROL }],
    } as M
  } else {
    const blocks = last.content.slice()
    const lastBlockIndex = blocks.length - 1
    // Already-marked block (e.g. the attachment loop got here first) — leave
    // it as is, don't double count.
    if (!blocks[lastBlockIndex].cache_control) {
      blocks[lastBlockIndex] = { ...blocks[lastBlockIndex], cache_control: CACHE_CONTROL }
    }
    nextMessages[lastIndex] = { ...last, content: blocks } as M
  }

  // Guard: count every marker in the result (system + each message block).
  // In practice today this is ≤3 (system + last-message + at most one
  // attachment marker from the route's existing loop), but if it ever grows
  // past 4, drop markers from the earliest message blocks first — never the
  // system marker or the last-message marker just placed above.
  const markerLocations: { messageIndex: number; blockIndex: number }[] = []
  nextMessages.forEach((m, messageIndex) => {
    if (typeof m.content === 'string') return
    m.content.forEach((block, blockIndex) => {
      if (block.cache_control) markerLocations.push({ messageIndex, blockIndex })
    })
  })

  let excess = 1 + markerLocations.length - MAX_CACHE_MARKERS
  if (excess > 0) {
    for (const loc of markerLocations) {
      if (excess <= 0) break
      if (loc.messageIndex === lastIndex) continue
      const msg = nextMessages[loc.messageIndex]
      if (typeof msg.content === 'string') continue
      const blocks = msg.content.slice()
      const trimmed: CacheableBlock = { ...blocks[loc.blockIndex] }
      delete trimmed.cache_control
      blocks[loc.blockIndex] = trimmed
      nextMessages[loc.messageIndex] = { ...msg, content: blocks } as M
      excess--
    }
  }

  return { system: systemBlocks, messages: nextMessages }
}
