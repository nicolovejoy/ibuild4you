import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createFakeFirestore } from '@/lib/integration/__tests__/fake-firestore'
import { SECRET, UUID, UUID2, postJson, errorCode } from './helpers'

let fake = createFakeFirestore()
vi.mock('@/lib/firebase/admin', () => ({ getAdminDb: () => fake.db }))

import { POST } from '../stars-demo/messages/delete/route'

const PATH = '/api/integrations/stars-demo/messages/delete'
const G = 'stars-demo:r2:star-data'
const base = { namespace: 'stars-demo', round: 'r2', topic_id: 'star-data', group_id: G }
const del = {
  round: 'r2',
  topic_id: 'star-data',
  participant_id: 'p_1',
  message_id: 'u1',
  idempotency_key: `r2:star-data:p_1:${UUID}`,
}
const participant = (id: string, label: string, topics: string[]) => ({
  namespace: 'stars-demo',
  round: 'r2',
  participant_id: id,
  author_label: label,
  topic_ids: topics,
  created_at: '0',
})

beforeEach(() => {
  vi.stubEnv('STARS_INTEGRATION_SECRET', SECRET)
  fake = createFakeFirestore()
  fake.seed('integration_groups', G, { ...base, version: 'v1', created_at: '0', updated_at: '0' })
  fake.seed('integration_participants', 'stars-demo:r2:p_1', participant('p_1', 'Participant A', ['star-data']))
  fake.seed('integration_participants', 'stars-demo:r2:p_2', participant('p_2', 'Participant B', ['star-data']))
  fake.seed('integration_messages', 'u1', {
    ...base,
    kind: 'participant',
    author_id: 'p_1',
    author_label: 'Participant A',
    idempotency_key: 'k1',
    reply_claimed_at: null,
    reply_claim_token: null,
    body: 'synthetic one',
    created_at: '1',
  })
  fake.seed('integration_messages', 'u2', {
    ...base,
    kind: 'participant',
    author_id: 'p_2',
    author_label: 'Participant B',
    idempotency_key: 'k2',
    reply_claimed_at: null,
    reply_claim_token: null,
    body: 'synthetic two',
    created_at: '2',
  })
  fake.seed('integration_messages', 'r1', {
    ...base,
    kind: 'facilitator',
    body: 'reply one',
    depends_on_message_ids: ['u1'],
    depends_on_participant_ids: ['p_1'],
    created_at: '3',
  })
  fake.seed('integration_messages', 'r2', {
    ...base,
    kind: 'facilitator',
    body: 'reply two',
    depends_on_message_ids: ['u2'],
    depends_on_participant_ids: ['p_1', 'p_2'],
    created_at: '4',
  })
})

describe('POST messages/delete', () => {
  it('401s without the secret', async () => {
    expect((await postJson(POST, PATH, del, {})).status).toBe(401)
    expect(fake.all('integration_messages')).toHaveLength(4)
  })
  it('400s a malformed body or a key of the wrong shape', async () => {
    expect(await errorCode(await postJson(POST, PATH, { ...del, message_id: '' }))).toBe('invalid_request')
    expect(await errorCode(await postJson(POST, PATH, { ...del, idempotency_key: 'del:1' }))).toBe('invalid_request')
  })
  it('403s forbidden for an unmapped participant, another owner, or a facilitator message', async () => {
    expect(
      await errorCode(
        await postJson(POST, PATH, { ...del, participant_id: 'p_9', idempotency_key: `r2:star-data:p_9:${UUID}` })
      )
    ).toBe('forbidden')
    expect(
      await errorCode(
        await postJson(POST, PATH, { ...del, participant_id: 'p_2', idempotency_key: `r2:star-data:p_2:${UUID}` })
      )
    ).toBe('forbidden')
    expect(await errorCode(await postJson(POST, PATH, { ...del, message_id: 'r1' }))).toBe('forbidden')
    expect(fake.all('integration_messages')).toHaveLength(4)
  })
  it('treats an unknown message or one in another topic as already gone', async () => {
    expect(await (await postJson(POST, PATH, { ...del, message_id: 'nope' })).json()).toMatchObject({
      removed_message_ids: [],
    })
    fake.seed(
      'integration_participants',
      'stars-demo:r2:p_1',
      participant('p_1', 'Participant A', ['star-data', 'admissions'])
    )
    fake.seed('integration_groups', 'stars-demo:r2:admissions', {
      namespace: 'stars-demo',
      round: 'r2',
      topic_id: 'admissions',
      version: 'a1',
      created_at: '0',
      updated_at: '0',
    })
    const res = await postJson(POST, PATH, {
      ...del,
      topic_id: 'admissions',
      idempotency_key: `r2:admissions:p_1:${UUID2}`,
    })
    expect(await res.json()).toMatchObject({ topic_id: 'admissions', removed_message_ids: [] })
    expect(fake.all('integration_messages')).toHaveLength(4)
  })
  it('removes the owned message and its dependent reply, bumps the version, keeps the rest', async () => {
    const res = await postJson(POST, PATH, del)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.round).toBe('r2')
    expect(body.topic_id).toBe('star-data')
    expect(body.version).not.toBe('v1')
    expect(body.removed_message_ids.sort()).toEqual(['r1', 'u1'])
    expect(fake.all('integration_messages').map((m) => m.id).sort()).toEqual(['r2', 'u2'])
  })
  it('replays the same key with the original removed ids and the CURRENT version', async () => {
    const first = await (await postJson(POST, PATH, del)).json()
    fake.seed('integration_groups', G, { ...fake.get('integration_groups', G)!, version: 'v-later' })
    const again = await (await postJson(POST, PATH, del)).json()
    expect(again.removed_message_ids.sort()).toEqual(first.removed_message_ids.sort())
    expect(again.version).toBe('v-later')
  })
})
