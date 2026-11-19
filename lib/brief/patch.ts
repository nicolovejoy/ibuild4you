// brief_patch: only what changed in a brief (relay project 4).
//
// Pure functions, no I/O. normalizeBriefPatch coerces untrusted input (pasted
// JSON) into a BriefPatch; applyBriefPatch merges it into the live brief and
// reports what it did. The route (PUT /api/briefs) and the Brief tab preview
// both call these, so they cannot disagree about what a patch does.
//
// Every match inside a patch goes by matchKey: case, punctuation and spacing are
// ignored. Stored text can hold curly quotes that the comms agent is told not to
// write, and "sign-up" must meet "sign up". Drops run first, then additions.
import { normalizeDecisionText, topicKey } from '@/lib/api/brief-merge'
import { normalizeRisks, riskOwner, riskText } from '@/lib/brief/risks'
import { normalizeQueued, normalizeShipped } from '@/lib/brief/shipped'
import type {
  BriefContent,
  BriefDecision,
  BriefPatch,
  BriefPatchDrop,
  BriefPatchSummary,
  BriefRisk,
  BriefShipped,
} from '@/lib/types'

type Risk = string | BriefRisk

const TEXT_FIELDS = ['problem', 'target_users', 'constraints', 'additional_context'] as const

// The matching key: lowercase, then every Unicode punctuation mark and every
// whitespace character removed. An entry whose key is '' (it was only
// punctuation or spaces) matches nothing: a drop of it is unmatched, and an
// added one is appended as sent.
function matchKey(text: string): string {
  return text.toLowerCase().replace(/[\p{P}\s]/gu, '')
}

// --- Parsing ---

// A list of non-blank strings, trimmed. Anything that is not a list gives [].
function cleanStrings(raw: unknown): string[] {
  if (!Array.isArray(raw)) return []
  return raw
    .filter((s): s is string => typeof s === 'string')
    .map((s) => s.trim())
    .filter((s) => s !== '')
}

function normalizeDecisions(raw: unknown): BriefDecision[] {
  if (!Array.isArray(raw)) return []
  const out: BriefDecision[] = []
  for (const item of raw) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue
    const { topic, decision, locked } = item as Record<string, unknown>
    if (typeof topic !== 'string' || typeof decision !== 'string') continue
    if (!topic.trim() || !decision.trim()) continue
    // Only topic, decision and the lock come from a patch. Provenance and
    // contest fields are code's to set, never the patch's.
    out.push({ topic: topic.trim(), decision: decision.trim(), ...(locked === true ? { locked: true } : {}) })
  }
  return out
}

// null unless raw is a plain object. Wrong-typed parts are left out, so an
// empty result ({}) means "nothing usable", which is a valid no-op patch.
export function normalizeBriefPatch(raw: unknown): BriefPatch | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const r = raw as Record<string, unknown>
  const patch: BriefPatch = {}

  for (const field of TEXT_FIELDS) {
    if (typeof r[field] === 'string') patch[field] = r[field] as string
  }
  const decisions = normalizeDecisions(r.decisions)
  if (decisions.length > 0) patch.decisions = decisions
  const features = cleanStrings(r.features)
  if (features.length > 0) patch.features = features
  const risks = normalizeRisks(r.open_risks)
  if (risks.length > 0) patch.open_risks = risks
  const shipped = normalizeShipped(r.shipped)
  if (shipped.length > 0) patch.shipped = shipped
  const queued = normalizeQueued(r.queued)
  if (queued.length > 0) patch.queued = queued

  if (r.drop && typeof r.drop === 'object' && !Array.isArray(r.drop)) {
    const d = r.drop as Record<string, unknown>
    const drop: BriefPatchDrop = {}
    for (const key of ['decisions', 'features', 'open_risks', 'queued'] as const) {
      const list = cleanStrings(d[key])
      if (list.length > 0) drop[key] = list
    }
    if (Object.keys(drop).length > 0) patch.drop = drop
  }
  return patch
}

// --- Applying ---

export interface ApplyBriefPatchResult {
  content: BriefContent
  unmatched: Required<BriefPatchDrop> // drop entries that matched nothing, as sent
  locksTouched: string[] // stored topics of locked decisions a patch tried to replace or drop
  summary: BriefPatchSummary
  changed: boolean // false when content equals live
}

// Drop entries that share a key count once (the first as sent), so a repeated
// entry neither double-counts nor lands in `unmatched` twice. An empty key has
// no match to share, so those entries are only collapsed when the text is identical.
function uniqueByKey(list: string[] | undefined): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const text of list ?? []) {
    const key = matchKey(text) || `\0${text}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push(text)
  }
  return out
}

// Structural equality that ignores key order inside objects. Firestore hands
// maps back in alphabetical order, so JSON.stringify would call equal briefs
// different.
function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (Array.isArray(a) || Array.isArray(b)) {
    return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((v, i) => sameValue(v, b[i]))
  }
  if (a && b && typeof a === 'object' && typeof b === 'object') {
    const ao = a as Record<string, unknown>
    const bo = b as Record<string, unknown>
    const keys = Object.keys(ao)
    return keys.length === Object.keys(bo).length && keys.every((k) => k in bo && sameValue(ao[k], bo[k]))
  }
  return false
}

// An empty shipped or queued list and an absent one are the same brief.
function withoutEmptyLists(c: BriefContent): BriefContent {
  const out = { ...c }
  if (!out.shipped?.length) delete out.shipped
  if (!out.queued?.length) delete out.queued
  return out
}

// Remove every item whose text matches `target`. Returns the kept items and
// how many went.
function removeMatching<T>(items: T[], text: (item: T) => string, target: string): { kept: T[]; removed: number } {
  const key = matchKey(target)
  if (key === '') return { kept: items, removed: 0 }
  const kept = items.filter((item) => matchKey(text(item)) !== key)
  return { kept, removed: items.length - kept.length }
}

// Append each incoming text unless a matching one is already there (this also
// collapses repeats inside the patch). An empty key is never "already there".
// Returns how many were added.
function appendNew(list: string[], incoming: string[] | undefined): number {
  let added = 0
  for (const text of incoming ?? []) {
    const key = matchKey(text)
    if (key !== '' && list.some((existing) => matchKey(existing) === key)) continue
    list.push(text)
    added++
  }
  return added
}

export function applyBriefPatch(live: BriefContent, patch: BriefPatch): ApplyBriefPatchResult {
  const drop = patch.drop ?? {}
  const unmatched: Required<BriefPatchDrop> = { decisions: [], features: [], open_risks: [], queued: [] }
  const locksTouched: string[] = []
  const noteLock = (topic: string) => {
    if (!locksTouched.includes(topic)) locksTouched.push(topic)
  }
  const summary: BriefPatchSummary = {
    fields_replaced: [],
    decisions_revised: 0,
    decisions_added: 0,
    decisions_dropped: 0,
    features_added: 0,
    features_dropped: 0,
    risks_added: 0,
    risks_changed: 0,
    risks_dropped: 0,
    queued_added: 0,
    queued_dropped: 0,
    shipped_added: 0,
  }

  // Working copies, so `live` is never touched.
  let decisions: BriefDecision[] = (live.decisions ?? []).map((d) => ({ ...d }))
  let features: string[] = [...(live.features ?? [])]
  let risks: Risk[] = (live.open_risks ?? []).map((r) => (typeof r === 'string' ? r : { ...r }))
  let queued: string[] = [...(live.queued ?? [])]
  const shipped: BriefShipped[] = (live.shipped ?? []).map((b) => ({ date: b.date, items: [...b.items] }))

  // Locked-ness is judged against the live brief, by topic key.
  const liveLocked = new Map<string, string>() // topic key -> stored topic
  for (const d of live.decisions ?? []) if (d.locked && matchKey(d.topic) !== '') liveLocked.set(matchKey(d.topic), d.topic)

  // --- Drops ---
  for (const topic of uniqueByKey(drop.decisions)) {
    const key = matchKey(topic)
    const matches = key === '' ? [] : decisions.filter((d) => matchKey(d.topic) === key)
    if (matches.length === 0) {
      unmatched.decisions.push(topic)
      continue
    }
    // A patch never removes a lock; any unlocked decision on the same topic goes.
    for (const d of matches) if (d.locked) noteLock(d.topic)
    const kept = decisions.filter((d) => matchKey(d.topic) !== key || d.locked)
    summary.decisions_dropped += decisions.length - kept.length
    decisions = kept
  }
  for (const text of uniqueByKey(drop.features)) {
    const { kept, removed } = removeMatching(features, (f) => f, text)
    if (removed === 0) unmatched.features.push(text)
    features = kept
    summary.features_dropped += removed
  }
  for (const text of uniqueByKey(drop.open_risks)) {
    const { kept, removed } = removeMatching(risks, riskText, text)
    if (removed === 0) unmatched.open_risks.push(text)
    risks = kept
    summary.risks_dropped += removed
  }
  for (const text of uniqueByKey(drop.queued)) {
    const { kept, removed } = removeMatching(queued, (q) => q, text)
    if (removed === 0) unmatched.queued.push(text)
    queued = kept
    summary.queued_dropped += removed
  }

  // --- Additions ---

  // Text fields: a non-blank string replaces the field; blank is ignored.
  const content: BriefContent = { ...live }
  delete content.shipped
  delete content.queued
  for (const field of TEXT_FIELDS) {
    const next = patch[field]
    if (typeof next !== 'string' || next.trim() === '' || next === live[field]) continue
    content[field] = next
    summary.fields_replaced.push(field)
  }

  // Decisions: one entry per topic, the last text wins, first position kept.
  // A topic with an empty key matches nothing, so each such decision stands alone.
  const incoming: Array<{ key: string; d: BriefDecision }> = []
  for (const d of patch.decisions ?? []) {
    const key = matchKey(d.topic)
    const seen = key === '' ? -1 : incoming.findIndex((x) => x.key === key)
    if (seen === -1) incoming.push({ key, d })
    else incoming[seen] = { key, d }
  }
  for (const { key, d } of incoming) {
    if (liveLocked.has(key)) {
      // The live brief locks this topic: the lock stays as it is.
      noteLock(liveLocked.get(key) as string)
      continue
    }
    const at = key === '' ? -1 : decisions.findIndex((existing) => matchKey(existing.topic) === key)
    const lockFlag = d.locked === true
    if (at === -1) {
      decisions.push({ topic: d.topic, decision: d.decision, ...(lockFlag ? { locked: true } : {}) })
      summary.decisions_added++
      continue
    }
    const stored = decisions[at]
    // Is this a real revision? The text of the decision itself is compared as the
    // server's provenance stamping does (case and punctuation ignored, spaces kept).
    if (normalizeDecisionText(stored.decision) === normalizeDecisionText(d.decision) && (stored.locked === true) === lockFlag) continue
    // Same position and stored topic spelling, so provenance stamping still
    // finds it. Stamps are not carried: code re-stamps a real revision.
    decisions[at] = { topic: stored.topic, decision: d.decision, ...(lockFlag ? { locked: true } : {}) }
    summary.decisions_revised++
  }

  summary.features_added = appendNew(features, patch.features)
  summary.queued_added = appendNew(queued, patch.queued)

  // Risks: a match keeps the stored text and only the owner can change (a sent
  // owner replaces the stored one; none sent keeps it), so a straight-quote
  // restatement of a curly-quoted risk rewrites nothing. Rewording is drop plus
  // add. No match appends.
  for (const r of patch.open_risks ?? []) {
    const key = matchKey(riskText(r))
    const at = key === '' ? -1 : risks.findIndex((existing) => matchKey(riskText(existing)) === key)
    if (at === -1) {
      risks.push(r)
      summary.risks_added++
      continue
    }
    const stored = risks[at]
    const owner = riskOwner(r)
    if (!owner || owner === riskOwner(stored)) continue
    risks[at] = { text: riskText(stored), owner }
    summary.risks_changed++
  }

  // Shipped: an item already in any batch is skipped. A new one joins the batch
  // with the same date, or a new batch is added (never an empty one).
  for (const batch of patch.shipped ?? []) {
    let target = shipped.find((b) => b.date === batch.date)
    const fresh = !target
    if (!target) target = { date: batch.date, items: [] }
    for (const text of batch.items) {
      const key = matchKey(text)
      if (key !== '' && shipped.some((b) => b.items.some((existing) => matchKey(existing) === key))) continue
      target.items.push(text)
      summary.shipped_added++
      if (fresh && target.items.length === 1) shipped.push(target)
    }
  }

  // Optional keys appear only when they hold something, or the live brief had
  // them: an empty patch on a bare brief must give back the same brief.
  content.features = features
  if (decisions.length > 0 || live.decisions !== undefined) content.decisions = decisions
  if (risks.length > 0 || live.open_risks !== undefined) content.open_risks = risks
  if (shipped.length > 0) content.shipped = shipped
  if (queued.length > 0) content.queued = queued

  return {
    content,
    unmatched,
    locksTouched,
    summary,
    changed: !sameValue(withoutEmptyLists(content), withoutEmptyLists(live)),
  }
}

// Topics (as stored in `live`) that a whole rewrite leaves out of `next`. A
// patch drops decisions by name; a rewrite drops them by silence, so the Brief
// tab uses this to name them. Matches on topicKey, as provenance stamping does.
export function removedDecisionTopics(live: BriefContent | null, next: BriefContent): string[] {
  if (!live) return []
  const kept = new Set((next.decisions ?? []).map(topicKey))
  return (live.decisions ?? []).filter((d) => !kept.has(topicKey(d))).map((d) => d.topic)
}
