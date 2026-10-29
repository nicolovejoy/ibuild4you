// #72 slice A — fetch recent Loop feedback for a brief and shape it for the
// agent system prompt. Thin Firestore layer over the pure summarizer in
// lib/agent/prototype-feedback.ts; shared by /api/chat and /api/chat/kickoff.
//
// Feedback rows are keyed by the linked app's canonical slug (or one of its
// legacy slugs); a brief with no app falls back to its own slug. See
// feedbackIdsForBrief. The (project_id ASC, created_at DESC) composite index
// already exists in firestore.indexes.json.

import {
  summarizePrototypeFeedback,
  type PrototypeFeedbackItem,
} from '@/lib/agent/prototype-feedback'
import { feedbackIdsForBrief } from '@/lib/api/apps'

export async function fetchPrototypeFeedback(
  db: FirebaseFirestore.Firestore,
  briefDocId: string,
  slug: string | undefined | null,
  nowMs: number,
  limit: number = 8,
): Promise<PrototypeFeedbackItem[]> {
  if (!slug) return []
  const ids = await feedbackIdsForBrief(db, briefDocId, slug)
  const snaps = await Promise.all(
    ids.map((id) =>
      db
        .collection('feedback')
        .where('project_id', '==', id)
        .orderBy('created_at', 'desc')
        .limit(limit)
        .get(),
    ),
  )
  // Merge, dedupe by doc id, newest first, then apply the limit.
  const byId = new Map<string, Record<string, unknown>>()
  for (const snap of snaps) {
    for (const d of snap.docs) byId.set(d.id, d.data() as Record<string, unknown>)
  }
  const rows = [...byId.values()]
    .sort((a, b) => String(b.created_at ?? '').localeCompare(String(a.created_at ?? '')))
    .slice(0, limit)
  if (rows.length === 0) return []
  return summarizePrototypeFeedback(rows, nowMs, limit)
}
