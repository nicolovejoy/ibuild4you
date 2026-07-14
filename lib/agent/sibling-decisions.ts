// #142 — surface locked decisions settled in *sibling* briefs (same product,
// same github_repo) so the agent doesn't ask a maker to re-litigate something
// already decided in a related conversation. Prompt-context only: no schema
// change, no brief merge, explicitly NOT #122 inheritance. Pure helpers here
// (selection + rendering); lib/api/sibling-decisions.ts does the Firestore work.
// Modeled on artifact-context.ts.

export interface SiblingDecision {
  topic: string
  decision: string
  // Title of the sibling brief this decision came from (shown for provenance).
  briefTitle: string
}

// Cap so the block stays small + high-signal even for a large brief family.
const MAX_DECISIONS = 20

// Select locked decisions across sibling briefs. v1 is locked-only (durable
// constraints — the highest-signal thing to carry). Malformed rows are skipped;
// ordered by sibling title; capped at MAX_DECISIONS total.
export function selectSiblingDecisions(
  siblings: { title: string; decisions: unknown[] }[],
): SiblingDecision[] {
  const ordered = [...siblings].sort((a, b) => (a.title || '').localeCompare(b.title || ''))
  const out: SiblingDecision[] = []
  for (const sib of ordered) {
    const title = (sib.title || '').trim() || 'Untitled brief'
    for (const raw of sib.decisions ?? []) {
      if (out.length >= MAX_DECISIONS) return out
      const d = raw as { topic?: unknown; decision?: unknown; locked?: unknown }
      if (d?.locked !== true) continue
      const topic = typeof d.topic === 'string' ? d.topic.trim() : ''
      const decision = typeof d.decision === 'string' ? d.decision.trim() : ''
      if (!topic || !decision) continue
      out.push({ topic, decision, briefTitle: title })
    }
  }
  return out
}

// Render the system-prompt block, or '' when there's nothing to add.
export function renderSiblingDecisionsBlock(items: SiblingDecision[]): string {
  if (items.length === 0) return ''
  const lines = items.map(
    (it) => `- **${it.topic}** — ${it.decision} _(from "${it.briefTitle}")_`,
  )
  return `
## Decisions settled in related conversations

These were locked in other conversations about the same product. Treat them as already decided — don't re-open them or re-ask about them:

${lines.join('\n')}

If the maker says something that **contradicts** one of these, don't silently go along with it and don't silently keep the old decision either — surface the conflict plainly (name the decision) and confirm explicitly before treating it as changed. These live on sibling briefs, so they inform this conversation but aren't part of this brief's own record.
`.trim()
}
