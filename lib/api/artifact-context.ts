// #83 Phase B — fetch pinned artifacts for a brief and shape them for the agent
// system prompt. Thin Firestore layer over the pure selector in
// lib/agent/artifact-context.ts; shared by /api/chat and /api/chat/kickoff.
//
// Files are keyed by the project DOC ID (files.project_id === project doc id),
// unlike prototype_context which keys by slug. Single-field where-clause, so no
// composite index is needed.

import { selectPinnedArtifacts, type ArtifactContextItem } from '@/lib/agent/artifact-context'

export async function fetchPinnedArtifacts(
  db: FirebaseFirestore.Firestore,
  projectId: string | undefined | null,
): Promise<ArtifactContextItem[]> {
  if (!projectId) return []
  try {
    const snap = await db.collection('files').where('project_id', '==', projectId).get()
    if (snap.empty) return []
    return selectPinnedArtifacts(snap.docs.map((d) => d.data() as Record<string, unknown>))
  } catch (err) {
    // Bonus context — a query failure must never break chat.
    console.error('[artifact-context] fetch failed:', err)
    return []
  }
}
