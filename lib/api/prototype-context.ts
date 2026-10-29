// #72 slice B2 — fetch recent structural page captures for a brief and shape
// them for the agent system prompt. Thin Firestore layer over the pure
// summarizer in lib/agent/prototype-context.ts; shared by /api/chat and
// /api/chat/kickoff.
//
// Rows are keyed like feedback: the linked app's canonical slug (or a legacy
// slug), else the brief's own slug (see feedbackIdsForBrief). The (project_id ASC, created_at DESC)
// composite index is in firestore.indexes.json. Status filtering (expired
// rows) happens in the summarizer, not the query, to keep the index simple.

import {
  summarizePrototypeContext,
  type PrototypeContextItem,
} from '@/lib/agent/prototype-context'
import { feedbackIdsForBrief } from '@/lib/api/apps'

export async function fetchPrototypeContext(
  db: FirebaseFirestore.Firestore,
  briefDocId: string,
  slug: string | undefined | null,
  nowMs: number,
  limit: number = 3,
): Promise<PrototypeContextItem[]> {
  if (!slug) return []
  try {
    // Over-fetch a bit so expired/stale rows filtered by the summarizer don't
    // starve the prompt of usable captures.
    const ids = await feedbackIdsForBrief(db, briefDocId, slug)
    const snaps = await Promise.all(
      ids.map((id) =>
        db
          .collection('prototype_context')
          .where('project_id', '==', id)
          .orderBy('created_at', 'desc')
          .limit(limit * 3)
          .get(),
      ),
    )
    // Merge, dedupe by doc id, newest first, then apply the over-fetch limit.
    const byId = new Map<string, Record<string, unknown>>()
    for (const snap of snaps) {
      for (const d of snap.docs) byId.set(d.id, d.data() as Record<string, unknown>)
    }
    const rows = [...byId.values()]
      .sort((a, b) => String(b.created_at ?? '').localeCompare(String(a.created_at ?? '')))
      .slice(0, limit * 3)
    if (rows.length === 0) return []
    return summarizePrototypeContext(rows, nowMs, limit)
  } catch (err) {
    // Captures are bonus context — a query failure (e.g. the composite index
    // not yet deployed to this Firebase project) must never break chat.
    console.error('[prototype-context] fetch failed:', err)
    return []
  }
}
