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

import type { BriefContent, BriefDecision, BriefDecisionContest } from '@/lib/types'

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
  next: BriefDecision[] | undefined
): BriefDecision[] {
  const prevList = prev ?? []
  const nextList = next ?? []
  const lockedPrev = prevList.filter((d) => d.locked)

  if (lockedPrev.length === 0) return nextList.map(withoutContest)

  const lockedKeys = new Set(lockedPrev.map(topicKey))
  const nextByKey = new Map(nextList.map((d) => [topicKey(d), d]))

  // Keep regen's non-locked-topic decisions in order; drop any that collide with
  // a locked topic (regen may have reworded a locked decision under its topic —
  // the locked verbatim version wins). A contest only makes sense on a lock, so
  // it is stripped from everything else (#197).
  const fromNext = nextList.filter((d) => !lockedKeys.has(topicKey(d))).map(withoutContest)

  // Locked decisions first (durable, prominent), then regen's contributions.
  // #197: a locked decision keeps its text verbatim but picks up `contested`
  // when regen emitted one for its topic; an existing contest is carried
  // forward until a builder rules on it (regen never clears a contest).
  return [
    ...lockedPrev.map((d) => {
      const incoming = nextByKey.get(topicKey(d))?.contested
      return { ...d, locked: true, ...(incoming ? { contested: incoming } : {}) }
    }),
    ...fromNext,
  ]
}

function withoutContest(d: BriefDecision): BriefDecision {
  if (d.contested === undefined) return d
  const rest = { ...d }
  delete rest.contested
  return rest
}

// --- #197 Part B: which locks would a save drop? ---
// Topics (spelled as in `prev`) locked in `prev` that `next` does not carry as
// locked — missing entirely or present but unlocked. Pure; the Brief tab and
// History → Restore use it to ask before submitting.
export function lostLocks(
  prev: BriefDecision[] | undefined,
  next: BriefDecision[] | undefined
): string[] {
  const nextLocked = new Set((next ?? []).filter((d) => d.locked).map(topicKey))
  return (prev ?? []).filter((d) => d.locked && !nextLocked.has(topicKey(d))).map((d) => d.topic)
}

// Accept a `contested` value only when it is well-formed AND the decision is
// locked (#197). Used by every write path that takes decisions from outside
// (regen coercion, PUT /api/briefs, the raw-JSON normaliser).
export function contestFor(locked: boolean, raw: unknown): BriefDecisionContest | undefined {
  if (!locked || !raw || typeof raw !== 'object') return undefined
  const c = raw as Record<string, unknown>
  if (typeof c.proposed !== 'string' || !c.proposed.trim()) return undefined
  if (typeof c.reason !== 'string' || !c.reason.trim()) return undefined
  return { proposed: c.proposed, reason: c.reason }
}

// --- #197 Part A: builder rules on a contested lock ---
export type ContestAction = 'accept' | 'accept_unlock' | 'dismiss'

// accept        → decision text becomes the proposal, lock kept
// accept_unlock → decision text becomes the proposal, lock removed
// dismiss       → nothing changes but the contest is cleared
// Pure; a topic with no contest returns the list unchanged.
export function resolveContest(
  decisions: BriefDecision[],
  topic: string,
  action: ContestAction
): BriefDecision[] {
  const key = topic.trim().toLowerCase()
  return decisions.map((d) => {
    if (topicKey(d) !== key || !d.contested) return d
    const base = withoutContest(d)
    if (action === 'dismiss') return base
    const accepted = { ...base, decision: d.contested.proposed }
    if (action === 'accept') return accepted
    const unlocked = { ...accepted }
    delete unlocked.locked
    return unlocked
  })
}

// --- Decision provenance (#121) ---
//
// Every decision carries where it came from (`decided_in_session` +
// `decided_at`), stamped HERE by code — never trusted from the model, which
// sees stamps in its prompt and will echo or hallucinate them. One function
// serves both write paths (regen and the paste/import PUT), run AFTER
// mergeLockedDecisions so locked decisions arrive verbatim from prev and rule 2
// preserves their stamps automatically.

const hasExplicitProvenance = (d: BriefDecision): boolean => typeof d.decided_at === 'string'

// A decision without its decided_* fields — for stripping model echo and for
// carrying prev stamps onto an incoming decision cleanly.
function withoutProvenance(d: BriefDecision): BriefDecision {
  const rest = { ...d }
  delete rest.decided_in_session
  delete rest.decided_at
  return rest
}

// Remove decided_* everywhere. Regen callers run this over the model output
// before stamping — prev-carry-forward is the only source of truth there.
export function stripDecisionProvenance(decisions: BriefDecision[]): BriefDecision[] {
  return decisions.map(withoutProvenance)
}

// Stamp provenance onto the post-reconcile decision list:
//   1. New topic (no prev match): stamp { decided_in_session: sessionId,
//      decided_at: now } — unless the incoming decision already carries
//      explicit provenance (the paste path may legitimately supply it).
//   2. Unchanged (prev match, same decision text): carry prev stamps forward
//      verbatim — including "no stamps"; never fabricate. Incoming stamps are
//      ignored (prev is the source of truth). This also restores stamps an
//      outside agent dropped when round-tripping the brief JSON.
//   3. Changed (prev match, different text): restamp with current context —
//      explicit incoming provenance wins (paste path), else sessionId + now.
// Idempotent: regenerating an unchanged brief never moves a stamp, so
// decided_at means "decided", not "last regenerated".
export function stampDecisionProvenance(args: {
  prev: BriefDecision[] | undefined // decisions on the previous brief version
  next: BriefDecision[] // post-reconcile list about to be persisted
  sessionId: string | null // stamping context (null on paste path)
  now: string // ISO
}): BriefDecision[] {
  const prevByKey = new Map((args.prev ?? []).map((d) => [topicKey(d), d]))

  return args.next.map((n) => {
    const p = prevByKey.get(topicKey(n))

    if (p && p.decision === n.decision) {
      // Rule 2 — unchanged: prev stamps verbatim (or none at all).
      const carried = withoutProvenance(n)
      if (p.decided_at !== undefined) carried.decided_at = p.decided_at
      if (p.decided_in_session !== undefined) carried.decided_in_session = p.decided_in_session
      return carried
    }

    // Rules 1 & 3 — new or changed this round.
    if (hasExplicitProvenance(n)) {
      return { ...n, decided_in_session: n.decided_in_session ?? null }
    }
    return { ...n, decided_in_session: args.sessionId, decided_at: args.now }
  })
}

// Order decisions with locked ones first so durable constraints read as
// constraints, not just another bullet (#71 — "surface locked decisions
// prominently"). Stable within each group. Pure; used by the brief view and the
// markdown export (the build↔brief copy-paste ferry).
export function lockedFirst(decisions: BriefDecision[] | undefined): BriefDecision[] {
  const list = decisions ?? []
  return [...list.filter((d) => d.locked), ...list.filter((d) => !d.locked)]
}

// Apply locked-decision durability to a regenerated brief. Pure — returns a new
// BriefContent; callers persist the result.
export function reconcileBrief(prev: BriefContent | null, next: BriefContent): BriefContent {
  return {
    ...next,
    decisions: mergeLockedDecisions(prev?.decisions, next.decisions),
  }
}
