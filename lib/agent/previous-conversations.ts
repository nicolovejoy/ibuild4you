// Previous conversations as agent context. The chat prompt carries the live
// brief and the current session's messages, nothing from earlier sessions. On
// F4FC session 7 that left the agent saying it "can't see the dates of past
// sessions" and guessing the maker had used a different brief. This block gives
// it one line per earlier conversation: when it happened, how long it was, and
// how it ended. Summaries only; the full text is still not in front of it.
//
// Everything here is deterministic across turns so the cached stable prompt
// block keeps hitting (lib/agent/prompt-cache.ts): calendar days, never
// relative words, nothing finer than a day. Pure helpers; the Firestore work is
// in lib/api/previous-conversations.ts. Modeled on sibling-decisions.ts.

export interface PreviousConversationMessage {
  role: 'user' | 'agent' | string
  content: string
  created_at: string
}

export interface PreviousConversationSource {
  // Position among the brief's non-archived sessions, 1-based (the same
  // ordinal the Context block calls "session #N").
  number: number
  messages: PreviousConversationMessage[]
}

export interface PreviousConversation {
  number: number
  // Pacific calendar day(s) the conversation spanned, e.g. "Oct 3, 2026" or
  // "Oct 3, 2026 to Oct 5, 2026".
  dateRange: string
  messageCount: number
  // How the agent left things, or null if the agent never spoke.
  lastAgentMessage: string | null
}

// Only the most recent conversations ride along; older ones are already
// folded into the brief.
export const MAX_PREVIOUS_CONVERSATIONS = 12
export const LAST_MESSAGE_MAX_CHARS = 300

// Calendar day in Pacific, Nico's day and the clock the work happened on.
// Never slice an ISO string for this: that is UTC and rolls over at 5pm PT.
const pacificDay = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/Los_Angeles',
  year: 'numeric',
  month: 'short',
  day: 'numeric',
})

function formatDay(iso: string): string | null {
  const t = new Date(iso).getTime()
  if (Number.isNaN(t)) return null
  return pacificDay.format(t)
}

// One short line of the agent's closing message: fenced blocks (the tappable
// `options` JSON) dropped, whitespace collapsed, cut at LAST_MESSAGE_MAX_CHARS.
export function truncateLastMessage(text: string, max: number = LAST_MESSAGE_MAX_CHARS): string {
  const flat = text
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  if (flat.length <= max) return flat
  return `${flat.slice(0, max).trimEnd()}…`
}

// Turn earlier sessions (oldest first, current one already excluded) into
// summary rows. Sessions without messages are skipped; the cap keeps the most
// recent MAX_PREVIOUS_CONVERSATIONS.
export function summarizePreviousConversations(sources: PreviousConversationSource[]): PreviousConversation[] {
  const rows: PreviousConversation[] = []
  for (const s of sources) {
    const messages = s.messages.filter((m) => m.content.trim().length > 0)
    if (messages.length === 0) continue
    const days = messages.map((m) => formatDay(m.created_at)).filter((d): d is string => d !== null)
    const first = days[0]
    const last = days[days.length - 1]
    const dateRange = !first ? 'date unknown' : first === last ? first : `${first} to ${last}`
    const lastAgent = [...messages].reverse().find((m) => m.role === 'agent')
    rows.push({
      number: s.number,
      dateRange,
      messageCount: messages.length,
      lastAgentMessage: lastAgent ? truncateLastMessage(lastAgent.content) : null,
    })
  }
  return rows.slice(-MAX_PREVIOUS_CONVERSATIONS)
}

// Render the system-prompt block, or '' when there is nothing to add.
export function renderPreviousConversationsBlock(items: PreviousConversation[]): string {
  if (items.length === 0) return ''
  const lines = items.map((c) => {
    const count = `${c.messageCount} message${c.messageCount === 1 ? '' : 's'}`
    const ending = c.lastAgentMessage ? ` Your last message: "${c.lastAgentMessage}"` : ''
    return `- **Conversation ${c.number}** (${c.dateRange}, ${count}).${ending}`
  })
  return `
## Previous conversations

Earlier conversations on this brief, oldest first. These are summaries: the full text of those conversations is not in front of you, only the brief above carries what was kept from them. Use the dates and endings to place what the user refers to; if they mention something that is not here or in the brief, say so and ask them to describe it again.

${lines.join('\n')}
`.trim()
}
