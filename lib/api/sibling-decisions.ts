// #142 — fetch locked decisions from sibling briefs (same github_repo) for the
// agent system prompt. Thin Firestore layer over the pure selector in
// lib/agent/sibling-decisions.ts; shared by /api/chat and /api/chat/kickoff.
//
// Firestore can't query on the *normalized* repo (stored values are messy —
// "byside" vs "nicolovejoy/byside"), so we fetch the small set of briefs that
// have any github_repo (single-field where, no composite index; ~dozens of docs)
// and match in memory with reposMatch. A failure here must never break chat.

import { reposMatch } from '@/lib/github/repo'
import { selectSiblingDecisions, type SiblingDecision } from '@/lib/agent/sibling-decisions'
import type { BriefContent, BriefDecision } from '@/lib/types'

// Cap the number of sibling briefs we open (each is one brief read).
const MAX_SIBLINGS = 8

export async function fetchSiblingDecisions(
  db: FirebaseFirestore.Firestore,
  project: { id: string; github_repo?: string | null } | null | undefined,
): Promise<SiblingDecision[]> {
  const repo = project?.github_repo
  if (!project || !repo) return []

  try {
    // All projects that carry any github_repo. `> ''` excludes empty/missing.
    const snap = await db.collection('projects').where('github_repo', '>', '').get()

    const siblings = snap.docs
      .filter((d) => d.id !== project.id && reposMatch(d.data().github_repo as string, repo))
      .slice(0, MAX_SIBLINGS)

    if (siblings.length === 0) return []

    // Latest brief per sibling (same lookup the chat route uses for the
    // project's own brief: briefs.project_id == doc id, highest version).
    const briefs = await Promise.all(
      siblings.map(async (sib) => {
        const briefSnap = await db
          .collection('briefs')
          .where('project_id', '==', sib.id)
          .orderBy('version', 'desc')
          .limit(1)
          .get()
        const content = briefSnap.empty
          ? null
          : (briefSnap.docs[0].data().content as BriefContent | null)
        return {
          title: (sib.data().title as string) || 'Untitled brief',
          decisions: (content?.decisions as BriefDecision[] | undefined) ?? [],
        }
      }),
    )

    return selectSiblingDecisions(briefs)
  } catch (err) {
    // Bonus context — a query failure must never break chat.
    console.error('[sibling-decisions] fetch failed:', err)
    return []
  }
}
