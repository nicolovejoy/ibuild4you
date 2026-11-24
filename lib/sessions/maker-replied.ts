// One rule for "has the maker answered this conversation's opening" (Project 5).
// Asked by the import (apply-import), POST /api/sessions and the builder's
// Conversations header, so the three never disagree.
//
// 1. A welcome posted by an import carries kind 'welcome'. Welcomes posted at
//    creation stay untagged.
// 2. "The opening point" of a conversation is the created_at of its newest
//    kind 'welcome' message. With none, it is the start of the conversation.
// 3. "The maker answered the opening" = there is a role 'user' message with
//    created_at after the opening point. With no opening point, any role 'user'
//    message counts (today's behaviour for every conversation with no tagged
//    welcome).
// 4. The import also treats the canned greeting as a re-opening (#214): its
//    point is the newer of the opening point and the newest 'unqueued_greeting'.
// 5. A builder's own note is role 'user' and counts, as it always has. The
//    kickoff keeps its own exclusion (#254) and is not touched here.
//
// Timestamps are UTC ISO strings, so string comparison is time order (as in
// lib/sessions/queued.ts).

export type ReplyCheckMessage = {
  role: 'user' | 'agent'
  kind?: string | null
  created_at?: string | null
}

// Newest created_at among messages of the given kinds, or null.
function newestAt(messages: ReplyCheckMessage[], kinds: string[]): string | null {
  let newest: string | null = null
  for (const m of messages) {
    if (!m.kind || !kinds.includes(m.kind)) continue
    const at = String(m.created_at ?? '')
    if (newest === null || at > newest) newest = at
  }
  return newest
}

// True when some maker message is after `since`; any maker message when null.
function userMessageAfter(messages: ReplyCheckMessage[], since: string | null): boolean {
  return messages.some(
    (m) => m.role === 'user' && (since === null || String(m.created_at ?? '') > since)
  )
}

// Where the import judges a reply from: the newer of the newest import-posted
// welcome (kind 'welcome') and the newest canned greeting. null = the start.
export function reopenPoint(messages: ReplyCheckMessage[]): string | null {
  return newestAt(messages, ['welcome', 'unqueued_greeting'])
}

// Asked by POST /api/sessions and the builder Conversations header.
export function makerAnsweredOpening(messages: ReplyCheckMessage[]): boolean {
  return userMessageAfter(messages, newestAt(messages, ['welcome']))
}

// Asked by the import (lib/sessions/apply-import.ts).
export function makerRepliedSinceReopen(messages: ReplyCheckMessage[]): boolean {
  return userMessageAfter(messages, reopenPoint(messages))
}
