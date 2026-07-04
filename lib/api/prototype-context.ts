// #72 slice B2 — fetch recent structural page captures for a brief and shape
// them for the agent system prompt. Thin Firestore layer over the pure
// summarizer in lib/agent/prototype-context.ts; shared by /api/chat and
// /api/chat/kickoff.
//
// Rows are keyed by the project SLUG (prototype_context.project_id === slug),
// matching the feedback convention. The (project_id ASC, created_at DESC)
// composite index is in firestore.indexes.json. Status filtering (expired
// rows) happens in the summarizer, not the query, to keep the index simple.

import {
  summarizePrototypeContext,
  type PrototypeContextItem,
} from '@/lib/agent/prototype-context'

export async function fetchPrototypeContext(
  db: FirebaseFirestore.Firestore,
  slug: string | undefined | null,
  nowMs: number,
  limit: number = 3,
): Promise<PrototypeContextItem[]> {
  if (!slug) return []
  try {
    // Over-fetch a bit so expired/stale rows filtered by the summarizer don't
    // starve the prompt of usable captures.
    const snap = await db
      .collection('prototype_context')
      .where('project_id', '==', slug)
      .orderBy('created_at', 'desc')
      .limit(limit * 3)
      .get()
    if (snap.empty) return []
    return summarizePrototypeContext(
      snap.docs.map((d) => d.data() as Record<string, unknown>),
      nowMs,
      limit,
    )
  } catch (err) {
    // Captures are bonus context — a query failure (e.g. the composite index
    // not yet deployed to this Firebase project) must never break chat.
    console.error('[prototype-context] fetch failed:', err)
    return []
  }
}
