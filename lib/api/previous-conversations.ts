// Load the messages of a brief's earlier sessions for the agent's "Previous
// conversations" block. Thin Firestore layer over the pure summarizer in
// lib/agent/previous-conversations.ts; shared by /api/chat and
// /api/chat/kickoff (both must build the same stable prompt so the kickoff's
// cached system block is read back on the maker's first turn).
//
// One query per session (messages by session_id, ordered by created_at: the
// existing composite index). Callers pass the non-archived sessions in order
// with the current one removed; only the last MAX_PREVIOUS_CONVERSATIONS are
// read. A failure here must never break chat.

import {
  summarizePreviousConversations,
  MAX_PREVIOUS_CONVERSATIONS,
  type PreviousConversation,
} from '@/lib/agent/previous-conversations'

export async function fetchPreviousConversations(
  db: FirebaseFirestore.Firestore,
  // Non-archived session ids in creation order, current session included; the
  // ordinal of each is its conversation number.
  orderedSessionIds: string[],
  currentSessionId: string,
): Promise<PreviousConversation[]> {
  const currentIndex = orderedSessionIds.indexOf(currentSessionId)
  const prior = (currentIndex === -1 ? orderedSessionIds : orderedSessionIds.slice(0, currentIndex))
    .map((id, i) => ({ id, number: i + 1 }))
    .slice(-MAX_PREVIOUS_CONVERSATIONS)
  if (prior.length === 0) return []

  try {
    const sources = await Promise.all(
      prior.map(async ({ id, number }) => {
        const snap = await db.collection('messages').where('session_id', '==', id).orderBy('created_at', 'asc').get()
        const messages = snap.docs.map((d) => {
          const data = d.data()
          return {
            role: (data.role as string) || '',
            content: (data.content as string) || '',
            created_at: (data.created_at as string) || '',
          }
        })
        return { number, messages }
      }),
    )
    return summarizePreviousConversations(sources)
  } catch (err) {
    // Bonus context: a query failure must never break chat.
    console.error('[previous-conversations] fetch failed:', err)
    return []
  }
}
