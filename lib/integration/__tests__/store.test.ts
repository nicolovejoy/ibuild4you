import { describe, it, expect, beforeEach } from 'vitest'
import { createFakeFirestore } from './fake-firestore'
import {
  GROUPS,
  PARTICIPANTS,
  MESSAGES,
  OPS,
  REPLY_CLAIM_MS,
  groupDocId,
  participantDocId,
  messageDocId,
  getGroup,
  ensureGroup,
  bumpVersion,
  getParticipant,
  createParticipant,
  listMessages,
  getMessage,
  findReplyTo,
  claimSend,
  releaseClaim,
  writeReply,
  deleteMessageCascade,
  eraseParticipant,
  eraseNamespaceRound,
  getOp,
  putOp,
  type GroupRow,
} from '../store'

const NS = 'stars-demo'
const T0 = '2026-09-22T10:00:00.000Z'
const at = (ms: number) => new Date(Date.parse(T0) + ms).toISOString()
let fake: ReturnType<typeof createFakeFirestore>

beforeEach(() => {
  fake = createFakeFirestore()
})

describe('ids', () => {
  it('are deterministic and namespaced', () => {
    expect(groupDocId(NS, 'r2', 'star-data')).toBe('stars-demo:r2:star-data')
    expect(participantDocId(NS, 'r2', 'p_1')).toBe('stars-demo:r2:p_1')
    expect(messageDocId(NS, 'k1')).toMatch(/^[a-f0-9]{64}$/)
    expect(messageDocId(NS, 'k1')).not.toBe(messageDocId('other', 'k1'))
  })
})

describe('groups', () => {
  it('ensureGroup creates once with a version, getGroup reads it, bumpVersion changes it', async () => {
    expect(await getGroup(fake.db, NS, 'r2', 'star-data')).toBeNull()
    const a = await ensureGroup(fake.db, NS, 'r2', 'star-data', T0)
    const b = await ensureGroup(fake.db, NS, 'r2', 'star-data', T0)
    expect(a.id).toBe(b.id)
    expect(fake.all(GROUPS)).toHaveLength(1)
    const g = (await getGroup(fake.db, NS, 'r2', 'star-data'))!
    expect(g).toMatchObject({ namespace: NS, round: 'r2', topic_id: 'star-data' })
    const v2 = await bumpVersion(fake.db, g.id, T0)
    expect(v2).not.toBe(g.version)
    expect((await getGroup(fake.db, NS, 'r2', 'star-data'))!.version).toBe(v2)
  })
})

describe('participants', () => {
  it('createParticipant is idempotent by id and getParticipant reads it', async () => {
    expect(
      await createParticipant(fake.db, {
        namespace: NS,
        round: 'r2',
        participant_id: 'p_1',
        author_label: 'Participant A',
        topic_ids: ['star-data'],
        created_at: T0,
      })
    ).toBe(true)
    expect(
      await createParticipant(fake.db, {
        namespace: NS,
        round: 'r2',
        participant_id: 'p_1',
        author_label: 'Participant Z',
        topic_ids: ['admissions'],
        created_at: T0,
      })
    ).toBe(false)
    const p = (await getParticipant(fake.db, NS, 'r2', 'p_1'))!
    expect(p.author_label).toBe('Participant A')
    expect(p.topic_ids).toEqual(['star-data'])
  })
})

describe('messages', () => {
  const seedGroup = () => ensureGroup(fake.db, NS, 'r2', 'star-data', T0)
  const input = (g: GroupRow) => ({
    namespace: NS,
    group: g,
    participant_id: 'p_1',
    author_label: 'Participant A',
    idempotency_key: 'k1',
    body: 'synthetic one',
  })

  it('listMessages orders by created_at then id and scopes to the group', async () => {
    const g = await seedGroup()
    fake.seed(MESSAGES, 'b', { group_id: g.id, kind: 'participant', created_at: '2' })
    fake.seed(MESSAGES, 'a', { group_id: g.id, kind: 'participant', created_at: '2' })
    fake.seed(MESSAGES, 'c', { group_id: g.id, kind: 'participant', created_at: '1' })
    fake.seed(MESSAGES, 'z', { group_id: 'other', kind: 'participant', created_at: '0' })
    expect((await listMessages(fake.db, g.id)).map((m) => m.id)).toEqual(['c', 'a', 'b'])
  })

  it('claimSend creates once with a token, reports busy inside the window, re-claims after it', async () => {
    const g = await seedGroup()
    const first = await claimSend(fake.db, { ...input(g), now: T0 })
    expect(first.outcome).toBe('created')
    expect(first.token).toMatch(/^[0-9a-f-]{36}$/)
    expect(first.message).toMatchObject({
      kind: 'participant',
      author_id: 'p_1',
      author_label: 'Participant A',
      body: 'synthetic one',
      idempotency_key: 'k1',
      reply_claimed_at: T0,
      reply_claim_token: first.token,
      round: 'r2',
      topic_id: 'star-data',
      group_id: g.id,
    })
    expect(first.message.id).toBe(messageDocId(NS, 'k1'))

    const busy = await claimSend(fake.db, { ...input(g), body: 'ignored', now: at(1000) })
    expect(busy.outcome).toBe('busy')
    expect(busy.message.body).toBe('synthetic one')

    const later = at(REPLY_CLAIM_MS + 1)
    const reclaimed = await claimSend(fake.db, { ...input(g), now: later })
    expect(reclaimed.outcome).toBe('claimed')
    expect(reclaimed.token).not.toBe(first.token)
    expect(reclaimed.message.reply_claim_token).toBe(reclaimed.token)
    expect(fake.all(MESSAGES)).toHaveLength(1)
  })

  it('claimSend reports mismatch for the same key from another participant', async () => {
    const g = await seedGroup()
    await claimSend(fake.db, { ...input(g), now: T0 })
    const r = await claimSend(fake.db, { ...input(g), participant_id: 'p_2', author_label: 'Participant B', now: T0 })
    expect(r.outcome).toBe('mismatch')
  })

  it('releaseClaim clears both claim fields so a retry regenerates immediately', async () => {
    const g = await seedGroup()
    const { message } = await claimSend(fake.db, { ...input(g), now: T0 })
    await releaseClaim(fake.db, message.id)
    const stored = fake.get(MESSAGES, message.id) as unknown as { reply_claimed_at: string | null; reply_claim_token: string | null }
    expect(stored.reply_claimed_at).toBeNull()
    expect(stored.reply_claim_token).toBeNull()
    expect((await claimSend(fake.db, { ...input(g), now: at(1) })).outcome).toBe('claimed')
  })

  it('writeReply wins with the live token: stores dependencies, clears the claim, bumps the version', async () => {
    const g = await seedGroup()
    const { message, token } = await claimSend(fake.db, { ...input(g), now: T0 })
    expect(await findReplyTo(fake.db, g.id, message.id)).toBeNull()
    const r = await writeReply(fake.db, {
      group: g,
      messageId: message.id,
      token,
      body: 'synthetic reply',
      participantIds: ['p_1', 'p_2'],
      now: T0,
    })
    expect(r.won).toBe(true)
    if (!r.won) return
    expect(r.reply).toMatchObject({
      kind: 'facilitator',
      body: 'synthetic reply',
      depends_on_message_ids: [message.id],
      depends_on_participant_ids: ['p_1', 'p_2'],
      group_id: g.id,
      round: 'r2',
      topic_id: 'star-data',
    })
    expect(r.version).not.toBe(g.version)
    expect((await findReplyTo(fake.db, g.id, message.id))!.id).toBe(r.reply.id)
    const stored = fake.get(MESSAGES, message.id) as unknown as { reply_claim_token: string | null }
    expect(stored.reply_claim_token).toBeNull()
  })

  it('writeReply loses with a stale token and writes nothing', async () => {
    const g = await seedGroup()
    const first = await claimSend(fake.db, { ...input(g), now: T0 })
    const second = await claimSend(fake.db, { ...input(g), now: at(REPLY_CLAIM_MS + 1) })
    const lost = await writeReply(fake.db, {
      group: g,
      messageId: first.message.id,
      token: first.token,
      body: 'loser',
      participantIds: ['p_1'],
      now: T0,
    })
    expect(lost).toEqual({ won: false })
    expect(fake.all(MESSAGES)).toHaveLength(1)
    const won = await writeReply(fake.db, {
      group: g,
      messageId: first.message.id,
      token: second.token,
      body: 'winner',
      participantIds: ['p_1'],
      now: T0,
    })
    expect(won.won).toBe(true)
    expect(fake.all(MESSAGES)).toHaveLength(2)
  })

  it('deleteMessageCascade removes the message and replies answering it, bumps the version', async () => {
    const g = await seedGroup()
    const base = { group_id: g.id, namespace: NS, round: 'r2', topic_id: 'star-data' }
    fake.seed(MESSAGES, 'u1', { ...base, kind: 'participant', author_id: 'p_1', created_at: '1' })
    fake.seed(MESSAGES, 'u2', { ...base, kind: 'participant', author_id: 'p_2', created_at: '2' })
    fake.seed(MESSAGES, 'r1', { ...base, kind: 'facilitator', depends_on_message_ids: ['u1'], depends_on_participant_ids: ['p_1'], created_at: '3' })
    fake.seed(MESSAGES, 'r2', { ...base, kind: 'facilitator', depends_on_message_ids: ['u2'], depends_on_participant_ids: ['p_1', 'p_2'], created_at: '4' })
    const { removed, version } = await deleteMessageCascade(fake.db, g, (await getMessage(fake.db, 'u1'))!, T0)
    expect(removed.sort()).toEqual(['r1', 'u1'])
    expect(version).not.toBe(g.version)
    expect(fake.all(MESSAGES).map((m) => m.id).sort()).toEqual(['r2', 'u2'])
  })
})

describe('erase', () => {
  beforeEach(async () => {
    await ensureGroup(fake.db, NS, 'r2', 'star-data', T0)
    await ensureGroup(fake.db, NS, 'r2', 'admissions', T0)
    await createParticipant(fake.db, { namespace: NS, round: 'r2', participant_id: 'p_1', author_label: 'Participant A', topic_ids: ['star-data', 'admissions'], created_at: T0 })
    await createParticipant(fake.db, { namespace: NS, round: 'r2', participant_id: 'p_2', author_label: 'Participant B', topic_ids: ['star-data'], created_at: T0 })
    const sd = groupDocId(NS, 'r2', 'star-data')
    const ad = groupDocId(NS, 'r2', 'admissions')
    fake.seed(MESSAGES, 'u1', { group_id: sd, namespace: NS, round: 'r2', topic_id: 'star-data', kind: 'participant', author_id: 'p_1', created_at: '1' })
    fake.seed(MESSAGES, 'u2', { group_id: ad, namespace: NS, round: 'r2', topic_id: 'admissions', kind: 'participant', author_id: 'p_1', created_at: '2' })
    fake.seed(MESSAGES, 'u3', { group_id: sd, namespace: NS, round: 'r2', topic_id: 'star-data', kind: 'participant', author_id: 'p_2', created_at: '3' })
    fake.seed(MESSAGES, 'r1', { group_id: sd, namespace: NS, round: 'r2', topic_id: 'star-data', kind: 'facilitator', depends_on_message_ids: ['u3'], depends_on_participant_ids: ['p_1', 'p_2'], created_at: '4' })
    fake.seed(MESSAGES, 'r2', { group_id: sd, namespace: NS, round: 'r2', topic_id: 'star-data', kind: 'facilitator', depends_on_message_ids: ['u3'], depends_on_participant_ids: ['p_2'], created_at: '5' })
    fake.seed(MESSAGES, 'x', { group_id: 'other:r2:star-data', namespace: 'other', round: 'r2', topic_id: 'star-data', kind: 'participant', author_id: 'p_1', created_at: '6' })
  })

  it('eraseParticipant removes their messages, replies that saw them, and their record; reports topics', async () => {
    const r = await eraseParticipant(fake.db, NS, 'r2', 'p_1', T0)
    expect(r.topics_cleared.sort()).toEqual(['admissions', 'star-data'])
    expect(fake.all(MESSAGES).map((m) => m.id).sort()).toEqual(['r2', 'u3', 'x'])
    expect(await getParticipant(fake.db, NS, 'r2', 'p_1')).toBeNull()
    expect(await getParticipant(fake.db, NS, 'r2', 'p_2')).not.toBeNull()
    expect((await eraseParticipant(fake.db, NS, 'r2', 'p_1', T0)).topics_cleared).toEqual([])
  })

  it('eraseNamespaceRound removes groups, participants, messages and ops of that namespace+round only', async () => {
    fake.seed(OPS, 'stars-demo:old', { namespace: NS, round: 'r2', kind: 'delete', response: {}, created_at: '0' })
    const r = await eraseNamespaceRound(fake.db, NS, 'r2')
    expect(r.topics_cleared.sort()).toEqual(['admissions', 'star-data'])
    expect(fake.all(GROUPS)).toHaveLength(0)
    expect(fake.all(PARTICIPANTS)).toHaveLength(0)
    expect(fake.all(MESSAGES).map((m) => m.id)).toEqual(['x'])
    expect(fake.all(OPS)).toHaveLength(0)
  })
})

describe('ops', () => {
  it('putOp then getOp returns the stored response, scoped by namespace', async () => {
    expect(await getOp(fake.db, NS, 'op:1')).toBeNull()
    await putOp(fake.db, { namespace: NS, round: 'r2', key: 'op:1', kind: 'delete', response: { removed_message_ids: ['m1'] }, now: T0 })
    expect(await getOp(fake.db, NS, 'op:1')).toEqual({ removed_message_ids: ['m1'] })
    expect(await getOp(fake.db, 'other', 'op:1')).toBeNull()
  })
})
