import type { BriefContent } from '@/lib/types'
import { stripCodeFences } from '@/lib/utils'

// Pure parsers for the two pasted JSON payload shapes:
//   - "new-project" → consumed by POST /api/projects (Dashboard's Import JSON modal)
//   - "next-convo"  → consumed by PATCH /api/projects + new brief revision (Brief tab)
//
// Both payloads may include `_payload_type` as their first key as a self-identifying
// marker. When present, parsers reject a mismatch with a clear "wrong place" error.
// When absent, parsers proceed (backward compatible with hand-rolled blobs).

export type ParseResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: string }

export interface NewProjectPayload {
  title: string
  [key: string]: unknown
}

export type NextConvoPayload =
  | { mode: 'multi'; brief: BriefContent; projectUpdate: Record<string, unknown> }
  | { mode: 'brief-only'; brief: unknown }

// Fields the next-convo import handler accepts and forwards to PATCH /api/projects.
// Kept here as a constant so tests can lockstep-check the prompt schema against this.
export const NEXT_CONVO_IMPORT_FIELDS = [
  'welcome_message',
  'nudge_message',
  'voice_sample',
  'identity',
  'context',
  'session_mode',
  'seed_questions',
  'builder_directives',
  'layout_mockups',
] as const

function parseJsonObject(raw: string): ParseResult<Record<string, unknown>> {
  let parsed: unknown
  try {
    parsed = JSON.parse(stripCodeFences(raw))
  } catch {
    return { ok: false, error: 'Invalid JSON — check the format and try again' }
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { ok: false, error: 'JSON must be an object' }
  }
  return { ok: true, value: parsed as Record<string, unknown> }
}

export function parseNewProjectPayload(raw: string): ParseResult<NewProjectPayload> {
  const parsed = parseJsonObject(raw)
  if (!parsed.ok) return parsed

  const obj = parsed.value
  if (obj._payload_type !== undefined && obj._payload_type !== 'new-project') {
    return {
      ok: false,
      error: `This is a "${obj._payload_type}" payload — paste it into the Brief tab inside the project, not the New Project modal.`,
    }
  }
  delete obj._payload_type

  if (!obj.title || typeof obj.title !== 'string' || !obj.title.trim()) {
    return { ok: false, error: 'JSON must include a "title" field' }
  }
  return { ok: true, value: obj as NewProjectPayload }
}

export function parseNextConvoPayload(raw: string): ParseResult<NextConvoPayload> {
  const parsed = parseJsonObject(raw)
  if (!parsed.ok) return parsed

  const obj = parsed.value
  if (obj._payload_type !== undefined && obj._payload_type !== 'next-convo') {
    return {
      ok: false,
      error: `This is a "${obj._payload_type}" payload — paste it into the Dashboard's "Import JSON" modal, not the Brief tab.`,
    }
  }
  delete obj._payload_type

  if (obj.brief) {
    const projectUpdate: Record<string, unknown> = {}
    // session_opener is a legacy alias for welcome_message; explicit welcome_message wins
    if (obj.session_opener !== undefined) projectUpdate.welcome_message = obj.session_opener
    for (const field of NEXT_CONVO_IMPORT_FIELDS) {
      if (obj[field] !== undefined) projectUpdate[field] = obj[field]
    }
    return {
      ok: true,
      value: { mode: 'multi', brief: obj.brief as BriefContent, projectUpdate },
    }
  }

  // Legacy: whole payload is brief content
  return { ok: true, value: { mode: 'brief-only', brief: obj } }
}
