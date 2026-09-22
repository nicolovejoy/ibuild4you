import { createHash, randomUUID } from 'node:crypto'
import {
  compareMessages,
  type FacilitatorMessageDoc,
  type GroupDoc,
  type MessageDoc,
  type MessageRow,
  type OpDoc,
  type ParticipantDoc,
  type ParticipantMessageDoc,
  type Round,
  type TopicId,
} from './types'

export const GROUPS = 'integration_groups'
export const PARTICIPANTS = 'integration_participants'
export const MESSAGES = 'integration_messages'
export const OPS = 'integration_ops'

// How long a send holds the "reply being generated" claim before a retry may
// re-claim instead of answering reply_pending (08a §2).
export const REPLY_CLAIM_MS = 90_000
const BATCH_LIMIT = 500 // Firestore's per-batch write cap

type Db = FirebaseFirestore.Firestore
type Ref = FirebaseFirestore.DocumentReference
export type GroupRow = GroupDoc & { id: string }
export type ParticipantRow = ParticipantDoc & { id: string }
export type ParticipantMessageRow = ParticipantMessageDoc & { id: string }
export type FacilitatorMessageRow = FacilitatorMessageDoc & { id: string }

export const groupDocId = (ns: string, round: Round, topic: TopicId) => `${ns}:${round}:${topic}`
export const participantDocId = (ns: string, round: Round, pid: string) => `${ns}:${round}:${pid}`
export const messageDocId = (ns: string, key: string) =>
  createHash('sha256').update(`${ns}\n${key}`).digest('hex')
export const opDocId = (ns: string, key: string) => `${ns}:${key}`

const isAlreadyExists = (err: unknown) => (err as { code?: number } | null)?.code === 6

// --- groups ---

export async function getGroup(db: Db, ns: string, round: Round, topic: TopicId): Promise<GroupRow | null> {
  const snap = await db.collection(GROUPS).doc(groupDocId(ns, round, topic)).get()
  return snap.exists ? { id: snap.id, ...(snap.data() as GroupDoc) } : null
}

export async function ensureGroup(db: Db, ns: string, round: Round, topic: TopicId, now: string): Promise<GroupRow> {
  const id = groupDocId(ns, round, topic)
  const doc: GroupDoc = { namespace: ns, round, topic_id: topic, version: randomUUID(), created_at: now, updated_at: now }
  try {
    await db.collection(GROUPS).doc(id).create(doc)
    return { id, ...doc }
  } catch (err) {
    if (!isAlreadyExists(err)) throw err
    return (await getGroup(db, ns, round, topic))!
  }
}

export async function bumpVersion(db: Db, groupId: string, now: string): Promise<string> {
  const version = randomUUID()
  await db.collection(GROUPS).doc(groupId).update({ version, updated_at: now })
  return version
}

// --- participants ---

export async function getParticipant(db: Db, ns: string, round: Round, pid: string): Promise<ParticipantRow | null> {
  const snap = await db.collection(PARTICIPANTS).doc(participantDocId(ns, round, pid)).get()
  return snap.exists ? { id: snap.id, ...(snap.data() as ParticipantDoc) } : null
}

// true = created now, false = already existed and was left untouched (08a §7).
export async function createParticipant(db: Db, doc: ParticipantDoc): Promise<boolean> {
  try {
    await db.collection(PARTICIPANTS).doc(participantDocId(doc.namespace, doc.round, doc.participant_id)).create(doc)
    return true
  } catch (err) {
    if (!isAlreadyExists(err)) throw err
    return false
  }
}

// --- messages ---

const row = (d: FirebaseFirestore.DocumentSnapshot): MessageRow => ({ id: d.id, ...(d.data() as MessageDoc) })

export async function listMessages(db: Db, groupId: string): Promise<MessageRow[]> {
  const snap = await db.collection(MESSAGES).where('group_id', '==', groupId).orderBy('created_at').get()
  return snap.docs.map(row).sort(compareMessages)
}

export async function getMessage(db: Db, messageId: string): Promise<MessageRow | null> {
  const snap = await db.collection(MESSAGES).doc(messageId).get()
  return snap.exists ? row(snap) : null
}

export async function findReplyTo(db: Db, groupId: string, messageId: string): Promise<FacilitatorMessageRow | null> {
  const snap = await db
    .collection(MESSAGES)
    .where('group_id', '==', groupId)
    .where('depends_on_message_ids', 'array-contains', messageId)
    .limit(1)
    .get()
  return snap.empty ? null : (row(snap.docs[0]) as FacilitatorMessageRow)
}

export type ClaimOutcome = 'created' | 'claimed' | 'busy' | 'mismatch'

// The heart of idempotent send (08a §2). One transaction on the key-derived
// document: create it with a fresh claim token, or re-claim an expired one
// with a new token, or report that another request holds a live claim. The
// message is never written twice. The token is what writeReply checks.
export async function claimSend(
  db: Db,
  input: {
    namespace: string
    group: GroupRow
    participant_id: string
    author_label: string
    idempotency_key: string
    body: string
    now: string
  }
): Promise<{ outcome: ClaimOutcome; message: ParticipantMessageRow; token: string }> {
  const id = messageDocId(input.namespace, input.idempotency_key)
  const ref = db.collection(MESSAGES).doc(id)
  const token = randomUUID()
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref)
    if (!snap.exists) {
      const doc: ParticipantMessageDoc = {
        namespace: input.namespace,
        round: input.group.round,
        topic_id: input.group.topic_id,
        group_id: input.group.id,
        kind: 'participant',
        author_id: input.participant_id,
        author_label: input.author_label,
        idempotency_key: input.idempotency_key,
        body: input.body,
        reply_claimed_at: input.now,
        reply_claim_token: token,
        created_at: input.now,
      }
      tx.create(ref, doc)
      // The participant message is itself a write, so the group version moves
      // now — a client that gets reply_pending still sees the change (08a §2).
      tx.update(db.collection(GROUPS).doc(input.group.id), { version: randomUUID(), updated_at: input.now })
      return { outcome: 'created', message: { id, ...doc }, token }
    }
    const existing = snap.data() as ParticipantMessageDoc
    if (existing.author_id !== input.participant_id) {
      return { outcome: 'mismatch', message: { id, ...existing }, token }
    }
    const claimedAt = existing.reply_claimed_at ? Date.parse(existing.reply_claimed_at) : NaN
    if (existing.reply_claim_token && !Number.isNaN(claimedAt) && Date.parse(input.now) - claimedAt < REPLY_CLAIM_MS) {
      return { outcome: 'busy', message: { id, ...existing }, token }
    }
    tx.update(ref, { reply_claimed_at: input.now, reply_claim_token: token })
    return {
      outcome: 'claimed',
      message: { id, ...existing, reply_claimed_at: input.now, reply_claim_token: token },
      token,
    }
  })
}

// A failed model attempt clears the claim at once so the next retry
// regenerates without waiting out the window (08a §2).
export async function releaseClaim(db: Db, messageId: string): Promise<void> {
  await db.collection(MESSAGES).doc(messageId).update({ reply_claimed_at: null, reply_claim_token: null })
}

// Compare-and-set on the claim token (08a §2): the reply is written only if
// this attempt still holds the claim. A loser writes nothing; the route then
// returns the winner's reply. Exactly one reply per participant message.
export async function writeReply(
  db: Db,
  input: { group: GroupRow; messageId: string; token: string; body: string; participantIds: string[]; now: string }
): Promise<{ won: true; reply: FacilitatorMessageRow; version: string } | { won: false }> {
  const messageRef = db.collection(MESSAGES).doc(input.messageId)
  const replyRef = db.collection(MESSAGES).doc()
  const version = randomUUID()
  const doc: FacilitatorMessageDoc = {
    namespace: input.group.namespace,
    round: input.group.round,
    topic_id: input.group.topic_id,
    group_id: input.group.id,
    kind: 'facilitator',
    body: input.body,
    depends_on_message_ids: [input.messageId],
    depends_on_participant_ids: input.participantIds,
    created_at: input.now,
  }
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(messageRef)
    if (!snap.exists || (snap.data() as ParticipantMessageDoc).reply_claim_token !== input.token) {
      return { won: false }
    }
    tx.set(replyRef, doc)
    tx.update(messageRef, { reply_claimed_at: null, reply_claim_token: null })
    tx.update(db.collection(GROUPS).doc(input.group.id), { version, updated_at: input.now })
    return { won: true, reply: { id: replyRef.id, ...doc }, version }
  })
}

async function deleteRefs(db: Db, refs: Ref[]): Promise<void> {
  for (let i = 0; i < refs.length; i += BATCH_LIMIT) {
    const batch = db.batch()
    refs.slice(i, i + BATCH_LIMIT).forEach((r) => batch.delete(r))
    await batch.commit()
  }
}

// One participant message plus every facilitator reply answering it (08a §2).
export async function deleteMessageCascade(
  db: Db,
  group: GroupRow,
  message: MessageRow,
  now: string
): Promise<{ removed: string[]; version: string }> {
  const replies = await db
    .collection(MESSAGES)
    .where('group_id', '==', group.id)
    .where('depends_on_message_ids', 'array-contains', message.id)
    .get()
  const refs = [db.collection(MESSAGES).doc(message.id), ...replies.docs.map((d) => d.ref)]
  await deleteRefs(db, refs)
  const version = await bumpVersion(db, group.id, now)
  return { removed: refs.map((r) => r.id), version }
}

// Erase a person in this namespace+round: their messages, every reply whose
// context included them, and their participant record. Loops until nothing
// matches so an interrupted run finishes on retry (08a §2, job-safe).
export async function eraseParticipant(
  db: Db,
  ns: string,
  round: Round,
  pid: string,
  now: string
): Promise<{ topics_cleared: TopicId[] }> {
  const topics = new Set<TopicId>()
  const participant = await getParticipant(db, ns, round, pid)
  participant?.topic_ids.forEach((t) => topics.add(t))
  for (;;) {
    const [own, seen] = await Promise.all([
      db
        .collection(MESSAGES)
        .where('namespace', '==', ns)
        .where('round', '==', round)
        .where('author_id', '==', pid)
        .limit(BATCH_LIMIT)
        .get(),
      db
        .collection(MESSAGES)
        .where('namespace', '==', ns)
        .where('round', '==', round)
        .where('depends_on_participant_ids', 'array-contains', pid)
        .limit(BATCH_LIMIT)
        .get(),
    ])
    const byId = new Map<string, Ref>()
    for (const d of [...own.docs, ...seen.docs]) {
      byId.set(d.id, d.ref)
      topics.add((d.data() as MessageDoc).topic_id)
    }
    if (byId.size === 0) break
    await deleteRefs(db, [...byId.values()])
  }
  if (participant) await db.collection(PARTICIPANTS).doc(participant.id).delete()
  for (const t of topics) {
    const g = await getGroup(db, ns, round, t)
    if (g) await bumpVersion(db, g.id, now)
  }
  return { topics_cleared: [...topics] }
}

async function deleteWhere(
  db: Db,
  collection: string,
  ns: string,
  round: Round
): Promise<FirebaseFirestore.QueryDocumentSnapshot[]> {
  const removed: FirebaseFirestore.QueryDocumentSnapshot[] = []
  for (;;) {
    const snap = await db
      .collection(collection)
      .where('namespace', '==', ns)
      .where('round', '==', round)
      .limit(BATCH_LIMIT)
      .get()
    if (snap.empty) return removed
    removed.push(...snap.docs)
    await deleteRefs(db, snap.docs.map((d) => d.ref))
  }
}

// The retention erase (08a §7): everything in this namespace+round, including
// the ops records, which hold only IDs but belong to the round.
export async function eraseNamespaceRound(db: Db, ns: string, round: Round): Promise<{ topics_cleared: TopicId[] }> {
  await deleteWhere(db, MESSAGES, ns, round)
  await deleteWhere(db, PARTICIPANTS, ns, round)
  const groups = await deleteWhere(db, GROUPS, ns, round)
  await deleteWhere(db, OPS, ns, round)
  return { topics_cleared: groups.map((d) => (d.data() as GroupDoc).topic_id) }
}

// --- idempotent operation records (replays return the original result) ---

export async function getOp(db: Db, ns: string, key: string): Promise<Record<string, unknown> | null> {
  const snap = await db.collection(OPS).doc(opDocId(ns, key)).get()
  return snap.exists ? ((snap.data() as OpDoc).response ?? null) : null
}

export async function putOp(
  db: Db,
  input: { namespace: string; round: Round; key: string; kind: OpDoc['kind']; response: Record<string, unknown>; now: string }
): Promise<void> {
  const doc: OpDoc = {
    namespace: input.namespace,
    round: input.round,
    kind: input.kind,
    response: input.response,
    created_at: input.now,
  }
  await db.collection(OPS).doc(opDocId(input.namespace, input.key)).set(doc)
}
