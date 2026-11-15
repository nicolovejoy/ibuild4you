// Open risks on a brief (#220).
//
// Canonical form: an unowned risk is a plain string; an owned one is
// { text, owner } with owner exactly 'maker' | 'builder'. An object without a
// valid owner collapses to its string. That keeps every pre-#220 brief valid
// and semantically unchanged after normalization (strings are trimmed, empties
// dropped). This is the only module that knows
// the shape; everything else goes through these helpers.
import type { BriefContent, BriefNoteResolvedRisk, BriefRisk, BriefRiskOwner } from '@/lib/types'

type Risk = string | BriefRisk

export function riskText(r: Risk): string {
  return typeof r === 'string' ? r : r.text
}

export function riskOwner(r: Risk): BriefRiskOwner | undefined {
  return typeof r === 'string' ? undefined : r.owner
}

// Coerce untrusted input (model output, pasted JSON) into canonical form.
export function normalizeRisks(raw: unknown): Risk[] {
  if (!Array.isArray(raw)) return []
  const out: Risk[] = []
  for (const item of raw) {
    if (typeof item === 'string') {
      const text = item.trim()
      if (text) out.push(text)
    } else if (item && typeof item === 'object') {
      const { text, owner } = item as { text?: unknown; owner?: unknown }
      if (typeof text !== 'string' || !text.trim()) continue
      if (owner === 'maker' || owner === 'builder') out.push({ text: text.trim(), owner })
      else out.push(text.trim())
    }
  }
  return out
}

// Texts of the risks owned by the maker, in order.
export function makerQuestions(content: BriefContent | undefined): string[] {
  return normalizeRisks(content?.open_risks).filter((r) => riskOwner(r) === 'maker').map(riskText)
}

const key = (r: Risk) => riskText(r).trim().toLowerCase()

// A regenerated list may drop owners. Restore an owner from the current list
// when the next entry is unowned and its text matches (case/whitespace
// insensitive). Entries are otherwise returned unchanged.
export function carryRiskOwners(current: Risk[] | undefined, next: Risk[]): Risk[] {
  const owners = new Map<string, BriefRiskOwner>()
  for (const r of current ?? []) {
    const o = riskOwner(r)
    if (o) owners.set(key(r), o)
  }
  return next.map((r) => {
    if (riskOwner(r)) return r
    const o = owners.get(key(r))
    return o ? { text: riskText(r), owner: o } : r
  })
}

// --- Settled risks on a note ---
//
// Canonical form: a settled risk with no recorded answer is a plain string
// (its text); one with an answer is { text, resolution }. Same idea as the
// owner on an open risk: old notes stay valid and read unchanged.
type Resolved = string | BriefNoteResolvedRisk

export function resolvedText(r: Resolved): string {
  return typeof r === 'string' ? r : r.text
}

export function resolvedAnswer(r: Resolved): string | undefined {
  return typeof r === 'string' ? undefined : r.resolution
}

// One line for prompts and the Brief tab: the risk, then its answer if any.
export function resolvedLine(r: Resolved): string {
  const answer = resolvedAnswer(r)
  return answer ? `${resolvedText(r)} → ${answer}` : resolvedText(r)
}

// Coerce untrusted input (model output) into canonical form.
export function normalizeResolvedRisks(raw: unknown): Resolved[] {
  if (!Array.isArray(raw)) return []
  const out: Resolved[] = []
  for (const item of raw) {
    if (typeof item === 'string') {
      const text = item.trim()
      if (text) out.push(text)
    } else if (item && typeof item === 'object') {
      const { text, resolution } = item as { text?: unknown; resolution?: unknown }
      if (typeof text !== 'string' || !text.trim()) continue
      if (typeof resolution === 'string' && resolution.trim()) {
        out.push({ text: text.trim(), resolution: resolution.trim() })
      } else out.push(text.trim())
    }
  }
  return out
}
