// Pure helpers for reconciling an incoming brief (a stamped ferry-desk paste,
// #229; formerly the whole-brief regen) against the prior one. Kept separate
// from lib/api/briefs.ts so the merge logic is unit-testable without an
// Anthropic or Firestore mock.
//
// Background — issue #71 (brief↔build reconciliation): a *locked* decision is a
// durable constraint (the build's "do-not-use" / locked-convention list). The
// comms agent that curates the brief is told to keep locked decisions, but a
// model can always drop or reword one — and across many sessions that silent
// loss is exactly the bug. So durability can't depend on the model: on a
// stamped paste, PUT /api/briefs re-injects every locked decision the paste
// dropped or altered, verbatim, with its contest state (restoreLocksOnPaste).
// Only a builder's deliberate, unstamped save (the structured editor,
// Accept/Dismiss, Restore) ever unlocks or rewrites one.

import type {
  BriefContent,
  BriefContestDismissed,
  BriefDecision,
  BriefDecisionContest,
} from '@/lib/types'

// Decisions are identified by their topic label (case-insensitive, trimmed).
// Two decisions with the same topic are "the same decision"; regen reusing a
// topic but changing the text counts as an alteration we must revert when locked.
export function topicKey(d: BriefDecision): string {
  return d.topic.trim().toLowerCase()
}

// Loose text comparison for contest proposals (#197): case and surrounding
// whitespace don't make a proposal different.
const normText = (s: string) => s.trim().toLowerCase()

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

  if (lockedPrev.length === 0) return nextList.map(withoutContestFields)

  const lockedKeys = new Set(lockedPrev.map(topicKey))
  const nextByKey = new Map(nextList.map((d) => [topicKey(d), d]))

  // Keep regen's non-locked-topic decisions in order; drop any that collide with
  // a locked topic (regen may have reworded a locked decision under its topic —
  // the locked verbatim version wins). A contest only makes sense on a lock, so
  // it is stripped from everything else (#197).
  const fromNext = nextList.filter((d) => !lockedKeys.has(topicKey(d))).map(withoutContestFields)

  // Locked decisions first (durable, prominent), then regen's contributions.
  // #197: a locked decision keeps its text verbatim but picks up `contested`
  // when regen emitted one for its topic; an existing contest is carried
  // forward until a builder rules on it (regen never clears a contest).
  // A contest is ignored when it repeats a proposal the builder already
  // dismissed (regen re-reads the whole transcript and would raise it again),
  // or when it proposes the decision's current text (meaningless).
  return [
    ...lockedPrev.map((d) => {
      const incoming = nextByKey.get(topicKey(d))?.contested
      const ignore =
        !incoming ||
        (d.contest_dismissed !== undefined &&
          normText(incoming.proposed) === normText(d.contest_dismissed.proposed)) ||
        normText(incoming.proposed) === normText(d.decision)
      return { ...d, locked: true, ...(ignore ? {} : { contested: incoming }) }
    }),
    ...fromNext,
  ]
}

// #229: a stamped ferry-desk paste (the comms agent rewrote the brief) can't
// drop a lock, reword one, or change its contest state. Same as
// mergeLockedDecisions except the paste's own `contested` is ignored: prev is
// the authority for contest state (the note writer sets `contested` on the
// live brief; only the Brief tab's Accept/Dismiss, an unstamped save, clears
// it), so every lock comes back with prev's `contested`/`contest_dismissed`.
// Pasted non-locked decisions pass through with contest fields stripped.
export function restoreLocksOnPaste(
  prev: BriefDecision[] | undefined,
  next: BriefDecision[] | undefined
): BriefDecision[] {
  return mergeLockedDecisions(prev, (next ?? []).map(withoutContestFields))
}

// Contest state (`contested`, `contest_dismissed`) only lives on a lock; strip
// both from anything else.
function withoutContestFields(d: BriefDecision): BriefDecision {
  if (d.contested === undefined && d.contest_dismissed === undefined) return d
  const rest = { ...d }
  delete rest.contested
  delete rest.contest_dismissed
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
// (the note writer's lock reversals, PUT /api/briefs, the raw-JSON normaliser).
export function contestFor(locked: boolean, raw: unknown): BriefDecisionContest | undefined {
  if (!locked || !raw || typeof raw !== 'object') return undefined
  const c = raw as Record<string, unknown>
  if (typeof c.proposed !== 'string' || !c.proposed.trim()) return undefined
  if (typeof c.reason !== 'string' || !c.reason.trim()) return undefined
  return { proposed: c.proposed, reason: c.reason }
}

// Same gate for `contest_dismissed` (#197): only on a lock, only when
// well-formed. Used by PUT /api/briefs and the raw-JSON normaliser; regen never
// accepts it from the model (prev carries it).
export function dismissedFor(locked: boolean, raw: unknown): BriefContestDismissed | undefined {
  if (!locked || !raw || typeof raw !== 'object') return undefined
  const c = raw as Record<string, unknown>
  if (typeof c.proposed !== 'string' || !c.proposed.trim()) return undefined
  if (typeof c.at !== 'string') return undefined
  return { proposed: c.proposed, at: c.at }
}

// --- #197 Part A: builder rules on a contested lock ---
export type ContestAction = 'accept' | 'accept_unlock' | 'dismiss'

// accept        → decision text becomes the proposal, lock kept
// accept_unlock → decision text becomes the proposal, lock removed
// dismiss       → the contest is cleared and remembered as
//                 `contest_dismissed { proposed, at: now }` so the next regen
//                 does not raise the same proposal again
// Accepting clears any older `contest_dismissed` too (the lock changed).
// Pure; a topic with no contest returns the list unchanged.
export function resolveContest(
  decisions: BriefDecision[],
  topic: string,
  action: ContestAction,
  now: string // ISO
): BriefDecision[] {
  const key = topic.trim().toLowerCase()
  return decisions.map((d) => {
    if (topicKey(d) !== key || !d.contested) return d
    const base = withoutContestFields(d)
    if (action === 'dismiss') {
      return { ...base, contest_dismissed: { proposed: d.contested.proposed, at: now } }
    }
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
// sees stamps in its prompt and will echo or hallucinate them. Since #229 the
// paste/import PUT is the only write path; on a stamped paste it runs AFTER
// restoreLocksOnPaste, so locked decisions arrive verbatim from prev and rule 2
// preserves their stamps automatically.

// Text comparison for "did this decision actually change?" (#228 part 2):
// lowercase, drop all Unicode punctuation (quotes, dashes, .,;:!?()[]-),
// collapse whitespace. Rewording that only touches these is not a revision.
export function normalizeDecisionText(s: string): string {
  return s.toLowerCase().replace(/\p{P}/gu, '').replace(/\s+/g, ' ').trim()
}

const hasExplicitProvenance = (d: BriefDecision): boolean => typeof d.decided_at === 'string'

// A decision without its decided_* fields — for stripping model echo and for
// carrying prev stamps onto an incoming decision cleanly.
function withoutProvenance(d: BriefDecision): BriefDecision {
  const rest = { ...d }
  delete rest.decided_in_session
  delete rest.decided_at
  delete rest.revised_in_session
  delete rest.revised_at
  return rest
}

const hasExplicitRevision = (d: BriefDecision): boolean => typeof d.revised_at === 'string'

// Remove decided_* and revised_* everywhere. Regen callers run this over the model output
// before stamping — prev-carry-forward is the only source of truth there.
export function stripDecisionProvenance(decisions: BriefDecision[]): BriefDecision[] {
  return decisions.map(withoutProvenance)
}

// Stamp provenance onto the post-reconcile decision list:
//   1. New topic (no prev match): stamp { decided_in_session: sessionId,
//      decided_at: now } — unless the incoming decision already carries
//      explicit provenance (the paste path may legitimately supply it). When
//      `originByTopic` has the topic (a note introduced it), that note's
//      session and time are used instead of sessionId/now (#229).
//   2. Unchanged (prev match, same decision text after normalizeDecisionText,
//      so case/punctuation/whitespace rewording does not count, #228 pt 2): carry prev stamps forward
//      verbatim — including "no stamps"; never fabricate. Incoming stamps are
//      ignored (prev is the source of truth). This also restores stamps an
//      outside agent dropped when round-tripping the brief JSON.
//   3. Changed (prev match, different text) — a revision (#218): the origin
//      (prev decided_*) is kept verbatim, never overwritten by regen or paste,
//      and revised_* is stamped with the current context — an incoming
//      revised_* that differs from prev's wins (the paste path may know the
//      real revision), while one that merely echoes prev's stamp (prep chat,
//      the structured editor and contest-accept all copy the stored decision
//      back) is replaced by sessionId + now. Only the latest revision is
//      kept. A prev decision with no origin stamp gets revised_* only — the
//      origin is not invented — unless the incoming decision supplies an
//      explicit origin, which is honored. Incoming decided_* are otherwise
//      ignored: prev's origin is the source of truth. When `originByTopic`
//      has the topic (a folded note revised it, #229), that note's session
//      and time stamp the revision instead of sessionId + now; an explicit
//      differing revised_* still wins.
// Idempotent: regenerating an unchanged brief never moves a stamp, so
// decided_at means "decided", not "last regenerated".
export function stampDecisionProvenance(args: {
  prev: BriefDecision[] | undefined // decisions on the previous brief version
  next: BriefDecision[] // post-reconcile list about to be persisted
  sessionId: string | null // stamping context (null on paste path)
  now: string // ISO
  // #229: where a new topic first came from, keyed by topicKey (trimmed,
  // lowercased topic); built from the notes a paste folds.
  originByTopic?: Map<string, { session_id: string | null; at: string }>
}): BriefDecision[] {
  const prevByKey = new Map((args.prev ?? []).map((d) => [topicKey(d), d]))

  return args.next.map((n) => {
    const p = prevByKey.get(topicKey(n))

    if (p && normalizeDecisionText(p.decision) === normalizeDecisionText(n.decision)) {
      // Rule 2 — unchanged: prev stamps verbatim (or none at all).
      const carried = withoutProvenance(n)
      if (p.decided_at !== undefined) carried.decided_at = p.decided_at
      if (p.decided_in_session !== undefined) carried.decided_in_session = p.decided_in_session
      if (p.revised_at !== undefined) carried.revised_at = p.revised_at
      if (p.revised_in_session !== undefined) carried.revised_in_session = p.revised_in_session
      return carried
    }

    if (p) {
      // Rule 3 — revised: keep the origin, stamp the revision.
      const revised = withoutProvenance(n)
      if (p.decided_at !== undefined) {
        revised.decided_at = p.decided_at
        if (p.decided_in_session !== undefined) revised.decided_in_session = p.decided_in_session
      } else if (hasExplicitProvenance(n)) {
        revised.decided_at = n.decided_at
        revised.decided_in_session = n.decided_in_session ?? null
      }
      const noteOrigin = args.originByTopic?.get(topicKey(n))
      if (hasExplicitRevision(n) && n.revised_at !== p.revised_at) {
        revised.revised_at = n.revised_at
        revised.revised_in_session = n.revised_in_session ?? null
      } else if (noteOrigin) {
        // #229: a folded note revised this topic; the revision happened in
        // that note's conversation, not at paste time.
        revised.revised_at = noteOrigin.at
        revised.revised_in_session = noteOrigin.session_id
      } else {
        revised.revised_at = args.now
        revised.revised_in_session = args.sessionId
      }
      return revised
    }

    // Rule 1 — new this round.
    if (hasExplicitProvenance(n)) {
      return { ...n, decided_in_session: n.decided_in_session ?? null }
    }
    const origin = args.originByTopic?.get(topicKey(n))
    if (origin) return { ...n, decided_in_session: origin.session_id, decided_at: origin.at }
    return { ...n, decided_in_session: args.sessionId, decided_at: args.now }
  })
}

// Order decisions with locked ones first so durable constraints read as
// constraints, not just another bullet (#71 — "surface locked decisions
// prominently"). Contested locks lead (#197) — they wait on a builder. Stable
// within each group. Pure; used by the brief view, the structured editor and
// the markdown export (the build↔brief copy-paste ferry).
export function lockedFirst(decisions: BriefDecision[] | undefined): BriefDecision[] {
  const list = decisions ?? []
  return [
    ...list.filter((d) => d.locked && d.contested),
    ...list.filter((d) => d.locked && !d.contested),
    ...list.filter((d) => !d.locked),
  ]
}

// Apply locked-decision durability to a regenerated brief. Pure — returns a new
// BriefContent; callers persist the result.
export function reconcileBrief(prev: BriefContent | null, next: BriefContent): BriefContent {
  return {
    ...next,
    decisions: mergeLockedDecisions(prev?.decisions, next.decisions),
  }
}
