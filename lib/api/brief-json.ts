import type { BriefContent, BriefDecision } from '@/lib/types'
import type { ParseResult } from './import-payload'
import { parseLooseJson } from '@/lib/utils'

// Pure validation + (de)serialization for the brief-as-document editor (#19
// Phase 3). The structured view and the raw-JSON view operate on ONE
// `BriefContent` document; these helpers are the bridge between them and the
// validation gate on save. Kept pure (no React, no I/O) so they're unit-tested.

const asString = (v: unknown): string => (typeof v === 'string' ? v : '')

const isStringArray = (v: unknown): v is string[] =>
  Array.isArray(v) && v.every((x) => typeof x === 'string')

export function emptyBrief(): BriefContent {
  return {
    problem: '',
    target_users: '',
    features: [],
    constraints: '',
    additional_context: '',
    decisions: [],
    open_risks: [],
  }
}

// Coerce an already-parsed value into a clean BriefContent, or explain why not.
// Tolerant of missing optional fields (filled with defaults); strict about the
// shape of anything present so a typo in the raw view fails loudly on save.
export function normalizeBriefContent(input: unknown): ParseResult<BriefContent> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return { ok: false, error: 'Brief must be a JSON object' }
  }
  const o = input as Record<string, unknown>

  if (o.features !== undefined && !isStringArray(o.features)) {
    return { ok: false, error: '"features" must be a list of strings' }
  }
  if (o.open_risks !== undefined && !isStringArray(o.open_risks)) {
    return { ok: false, error: '"open_risks" must be a list of strings' }
  }

  const decisions: BriefDecision[] = []
  if (o.decisions !== undefined) {
    if (!Array.isArray(o.decisions)) {
      return { ok: false, error: '"decisions" must be a list' }
    }
    for (const d of o.decisions) {
      if (!d || typeof d !== 'object' || Array.isArray(d)) {
        return { ok: false, error: 'Each decision must be an object with "topic" and "decision"' }
      }
      const dd = d as Record<string, unknown>
      if (typeof dd.topic !== 'string' || typeof dd.decision !== 'string') {
        return { ok: false, error: 'Each decision needs a string "topic" and "decision"' }
      }
      decisions.push({
        topic: dd.topic,
        decision: dd.decision,
        ...(dd.locked === true ? { locked: true } : {}),
        // #121: provenance stamps must survive the raw-view round-trip — the
        // server would restore dropped ones via carry-forward, but the raw view
        // should show what's really stored.
        ...(typeof dd.decided_at === 'string' ? { decided_at: dd.decided_at } : {}),
        ...(typeof dd.decided_in_session === 'string' || dd.decided_in_session === null
          ? { decided_in_session: dd.decided_in_session as string | null }
          : {}),
      })
    }
  }

  const value: BriefContent = {
    problem: asString(o.problem),
    target_users: asString(o.target_users),
    features: isStringArray(o.features) ? o.features.filter((s) => s.trim() !== '') : [],
    constraints: asString(o.constraints),
    additional_context: asString(o.additional_context),
    decisions,
    open_risks: isStringArray(o.open_risks) ? o.open_risks.filter((s) => s.trim() !== '') : [],
  }
  return { ok: true, value }
}

// Parse a raw JSON string from the editor's raw view (tolerant of smart quotes
// etc. via parseLooseJson), then validate the shape.
export function parseBriefJson(raw: string): ParseResult<BriefContent> {
  let parsed: unknown
  try {
    parsed = parseLooseJson(raw)
  } catch {
    return { ok: false, error: 'Invalid JSON — check the format and try again' }
  }
  return normalizeBriefContent(parsed)
}

// Stable field order so the raw view round-trips cleanly and diffs stay readable.
export function serializeBriefContent(b: BriefContent): string {
  return JSON.stringify(
    {
      problem: b.problem ?? '',
      target_users: b.target_users ?? '',
      features: b.features ?? [],
      constraints: b.constraints ?? '',
      additional_context: b.additional_context ?? '',
      decisions: b.decisions ?? [],
      open_risks: b.open_risks ?? [],
    },
    null,
    2,
  )
}
