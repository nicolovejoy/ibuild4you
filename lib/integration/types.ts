// Round-two group conversations for stars-demo (contract 08a). Four new
// top-level collections, server-only: the catch-all deny in firestore.rules
// covers them and nothing in sessions/messages/briefs/notify reads them.

export const ROUND = 'r2' as const
export type Round = typeof ROUND

export const TOPIC_IDS = ['star-data', 'admissions', 'self-service'] as const
export type TopicId = (typeof TOPIC_IDS)[number]

export function isTopicId(v: unknown): v is TopicId {
  return typeof v === 'string' && (TOPIC_IDS as readonly string[]).includes(v)
}

export interface GroupDoc {
  namespace: string
  round: Round
  topic_id: TopicId
  version: string // opaque, changes on every write to the group (08a §2)
  created_at: string
  updated_at: string
}

export interface ParticipantDoc {
  namespace: string
  round: Round
  participant_id: string // opaque, minted by stars-demo
  author_label: string // "Participant A", one per round (08a §3)
  topic_ids: TopicId[]
  created_at: string
}

interface MessageBase {
  namespace: string
  round: Round
  topic_id: TopicId
  group_id: string
  body: string
  created_at: string
}

export interface ParticipantMessageDoc extends MessageBase {
  kind: 'participant'
  author_id: string
  author_label: string
  idempotency_key: string
  // Generation claim (08a §2): set in a transaction when a send starts
  // generating; the reply write is a compare-and-set on the token. A retry
  // inside REPLY_CLAIM_MS with a live token answers reply_pending.
  reply_claimed_at: string | null
  reply_claim_token: string | null
}

export interface FacilitatorMessageDoc extends MessageBase {
  kind: 'facilitator'
  depends_on_message_ids: string[] // the participant turn it answers
  depends_on_participant_ids: string[] // everyone whose text was in context
}

export type MessageDoc = ParticipantMessageDoc | FacilitatorMessageDoc
export type MessageRow = MessageDoc & { id: string }

export type WireMessage =
  | { id: string; kind: 'participant'; author_id: string; author_label: string; body: string; created_at: string }
  | {
      id: string
      kind: 'facilitator'
      body: string
      created_at: string
      depends_on_message_ids: string[]
      depends_on_participant_ids: string[]
    }

// What leaves the server (08a §2). Internal fields (key, claim, group) stay.
export function toWireMessage(m: MessageRow): WireMessage {
  if (m.kind === 'participant') {
    return {
      id: m.id,
      kind: 'participant',
      author_id: m.author_id,
      author_label: m.author_label,
      body: m.body,
      created_at: m.created_at,
    }
  }
  return {
    id: m.id,
    kind: 'facilitator',
    body: m.body,
    created_at: m.created_at,
    depends_on_message_ids: m.depends_on_message_ids,
    depends_on_participant_ids: m.depends_on_participant_ids,
  }
}

// Durable order: created_at, then document ID (08a §2).
export function compareMessages(
  a: { created_at: string; id: string },
  b: { created_at: string; id: string }
): number {
  if (a.created_at !== b.created_at) return a.created_at < b.created_at ? -1 : 1
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
}

export interface OpDoc {
  namespace: string
  round: Round
  kind: 'delete' | 'erase' | 'namespace_erase'
  response: Record<string, unknown> // IDs and statuses only, never content
  created_at: string
}
