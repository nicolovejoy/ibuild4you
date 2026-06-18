// #72 slice A — fetch recent Loop feedback for a brief and shape it for the
// agent system prompt. Thin Firestore layer over the pure summarizer in
// lib/agent/prototype-feedback.ts; shared by /api/chat and /api/chat/kickoff.
//
// Feedback rows are keyed by the project SLUG (Feedback.project_id === slug),
// not the project doc id. The (project_id ASC, created_at DESC) composite index
// already exists in firestore.indexes.json.

import {
  summarizePrototypeFeedback,
  type PrototypeFeedbackItem,
} from '@/lib/agent/prototype-feedback'

export async function fetchPrototypeFeedback(
  db: FirebaseFirestore.Firestore,
  slug: string | undefined | null,
  nowMs: number,
  limit: number = 8,
): Promise<PrototypeFeedbackItem[]> {
  if (!slug) return []
  const snap = await db
    .collection('feedback')
    .where('project_id', '==', slug)
    .orderBy('created_at', 'desc')
    .limit(limit)
    .get()
  if (snap.empty) return []
  return summarizePrototypeFeedback(
    snap.docs.map((d) => d.data() as Record<string, unknown>),
    nowMs,
    limit,
  )
}
