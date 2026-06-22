// Pure helpers for reconciling a freshly-regenerated brief against the prior
// one. Kept separate from lib/api/briefs.ts so the merge logic is unit-testable
// without an Anthropic or Firestore mock.
//
// Background — issue #71 (brief↔build reconciliation): a *locked* decision is a
// durable constraint (the build's "do-not-use" / locked-convention list). The
// regen model is told to preserve locked decisions, but a model can always drop
// or reword one — and across many sessions that silent loss is exactly the bug.
// So durability can't depend on the model: this code re-injects every locked
// decision the regen output dropped or altered, verbatim, before the brief is
// persisted. Locked decisions are immutable through regen; only an explicit
// maker confirm (a separate, deliberate flow) ever changes one.

import type { BriefContent, BriefDecision } from '@/lib/types'

// Decisions are identified by their topic label (case-insensitive, trimmed).
// Two decisions with the same topic are "the same decision"; regen reusing a
// topic but changing the text counts as an alteration we must revert when locked.
function topicKey(d: BriefDecision): string {
  return d.topic.trim().toLowerCase()
}

// Re-inject any decision that was locked in `prev` but dropped or reworded by
// `next`. Returns the reconciled decision list:
//   - every locked decision from `prev` appears verbatim (topic, decision, locked)
//   - a locked decision keeps its `prev` position relative to other locked ones
//   - non-locked decisions come from `next` (regen is free to revise those)
//   - regen's brand-new decisions are preserved
export function mergeLockedDecisions(
  prev: BriefDecision[] | undefined,
  next: BriefDecision[] | undefined,
): BriefDecision[] {
  const prevList = prev ?? []
  const nextList = next ?? []
  const lockedPrev = prevList.filter((d) => d.locked)

  if (lockedPrev.length === 0) return nextList

  const lockedKeys = new Set(lockedPrev.map(topicKey))

  // Keep regen's non-locked-topic decisions in order; drop any that collide with
  // a locked topic (regen may have reworded a locked decision under its topic —
  // the locked verbatim version wins).
  const fromNext = nextList.filter((d) => !lockedKeys.has(topicKey(d)))

  // Locked decisions first (durable, prominent), then regen's contributions.
  return [...lockedPrev.map((d) => ({ ...d, locked: true })), ...fromNext]
}

// Order decisions with locked ones first so durable constraints read as
// constraints, not just another bullet (#71 — "surface locked decisions
// prominently"). Stable within each group. Pure; used by the brief view and the
// markdown export (the build↔brief copy-paste ferry).
export function lockedFirst(
  decisions: BriefDecision[] | undefined,
): BriefDecision[] {
  const list = decisions ?? []
  return [...list.filter((d) => d.locked), ...list.filter((d) => !d.locked)]
}

// Apply locked-decision durability to a regenerated brief. Pure — returns a new
// BriefContent; callers persist the result.
export function reconcileBrief(
  prev: BriefContent | null,
  next: BriefContent,
): BriefContent {
  return {
    ...next,
    decisions: mergeLockedDecisions(prev?.decisions, next.decisions),
  }
}
