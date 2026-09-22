import { ROUND, isTopicId, type Round, type TopicId } from './types'

// Body parsers for contract 08a. Each returns the typed input or null; the
// route maps null to 400 invalid_request. No partial acceptance.

const OPAQUE_ID = /^[A-Za-z0-9_-]{1,128}$/
const UUID_V4 = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-4[0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$/
const KEY_MAX = 160
const BODY_MAX = 4000
const LABEL_MAX = 40
const TITLE_MAX = 200
const PROMPT_MAX = 4000

export type SendInput = {
  round: Round
  topic_id: TopicId
  participant_id: string
  author_label: string
  idempotency_key: string
  body: string
  seen_version?: string
  topic_title: string
  topic_prompt: string
}
export type DeleteInput = {
  round: Round
  topic_id: TopicId
  participant_id: string
  message_id: string
  idempotency_key: string
}
export type EnsureInput = { round: Round; participant_id: string; author_label: string; topic_ids: TopicId[] }
export type EraseInput = { round: Round; participant_id: string; operation_key: string }
export type NamespaceEraseInput = { round: Round; operation_key: string }
export type ListInput = { round: Round; topic_id: TopicId }

const obj = (v: unknown): Record<string, unknown> | null =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null
const isRound = (v: unknown): v is Round => v === ROUND
const id = (v: unknown): v is string => typeof v === 'string' && OPAQUE_ID.test(v)
const text = (v: unknown, max: number): string | null =>
  typeof v === 'string' && v.trim().length > 0 && v.trim().length <= max ? v.trim() : null

// Key shapes (08a §1): the segments before the uuid must agree with the body.
function keyMatches(v: unknown, ...segments: string[]): v is string {
  if (typeof v !== 'string' || v.length > KEY_MAX) return false
  const parts = v.split(':')
  if (parts.length !== segments.length + 1) return false
  return segments.every((s, i) => parts[i] === s) && UUID_V4.test(parts[segments.length])
}

export function parseSend(raw: unknown): SendInput | null {
  const b = obj(raw)
  if (!b || !isRound(b.round) || !isTopicId(b.topic_id) || !id(b.participant_id)) return null
  const author_label = text(b.author_label, LABEL_MAX)
  const body = text(b.body, BODY_MAX)
  const topic_title = text(b.topic_title, TITLE_MAX)
  const topic_prompt = text(b.topic_prompt, PROMPT_MAX)
  if (!author_label || !body || !topic_title || !topic_prompt) return null
  if (!keyMatches(b.idempotency_key, b.round, b.topic_id, b.participant_id)) return null
  if (
    b.seen_version !== undefined &&
    (typeof b.seen_version !== 'string' || b.seen_version.length === 0 || b.seen_version.length > KEY_MAX)
  ) {
    return null
  }
  return {
    round: b.round,
    topic_id: b.topic_id,
    participant_id: b.participant_id,
    author_label,
    idempotency_key: b.idempotency_key,
    body,
    topic_title,
    topic_prompt,
    ...(b.seen_version !== undefined && { seen_version: b.seen_version as string }),
  }
}

export function parseDelete(raw: unknown): DeleteInput | null {
  const b = obj(raw)
  if (!b || !isRound(b.round) || !isTopicId(b.topic_id) || !id(b.participant_id) || !id(b.message_id)) return null
  if (!keyMatches(b.idempotency_key, b.round, b.topic_id, b.participant_id)) return null
  return {
    round: b.round,
    topic_id: b.topic_id,
    participant_id: b.participant_id,
    message_id: b.message_id,
    idempotency_key: b.idempotency_key,
  }
}

export function parseEnsure(raw: unknown): EnsureInput | null {
  const b = obj(raw)
  if (!b || !isRound(b.round) || !id(b.participant_id)) return null
  const author_label = text(b.author_label, LABEL_MAX)
  if (!author_label) return null
  if (!Array.isArray(b.topic_ids) || b.topic_ids.length === 0 || !b.topic_ids.every(isTopicId)) return null
  if (new Set(b.topic_ids).size !== b.topic_ids.length) return null
  return { round: b.round, participant_id: b.participant_id, author_label, topic_ids: b.topic_ids as TopicId[] }
}

export function parseErase(raw: unknown): EraseInput | null {
  const b = obj(raw)
  if (!b || !isRound(b.round) || !id(b.participant_id)) return null
  if (!keyMatches(b.operation_key, b.round, 'erase', b.participant_id)) return null
  return { round: b.round, participant_id: b.participant_id, operation_key: b.operation_key }
}

export function parseNamespaceErase(raw: unknown): NamespaceEraseInput | null {
  const b = obj(raw)
  if (!b || !isRound(b.round)) return null
  if (!keyMatches(b.operation_key, b.round, 'namespace-erase')) return null
  return { round: b.round, operation_key: b.operation_key }
}

export function parseListQuery(url: URL): ListInput | null {
  const round = url.searchParams.get('round')
  const topic_id = url.searchParams.get('topic_id')
  if (!isRound(round) || !isTopicId(topic_id)) return null
  return { round, topic_id }
}
