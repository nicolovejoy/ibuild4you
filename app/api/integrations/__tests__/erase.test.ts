import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createFakeFirestore } from '@/lib/integration/__tests__/fake-firestore'
import { SECRET, UUID, postJson, errorCode } from './helpers'

let fake = createFakeFirestore()
vi.mock('@/lib/firebase/admin', () => ({ getAdminDb: () => fake.db }))

import { POST } from '../stars-demo/participants/erase/route'

const PATH = '/api/integrations/stars-demo/participants/erase'
const ns = { namespace: 'stars-demo', round: 'r2' }
const erase = { round: 'r2', participant_id: 'p_1', operation_key: `r2:erase:p_1:${UUID}` }
const SD = 'stars-demo:r2:star-data'
const AD = 'stars-demo:r2:admissions'

beforeEach(() => {
  vi.stubEnv('STARS_INTEGRATION_SECRET', SECRET)
  fake = createFakeFirestore()
  fake.seed('integration_groups', SD, { ...ns, topic_id: 'star-data', version: 'v1', created_at: '0', updated_at: '0' })
  fake.seed('integration_groups', AD, { ...ns, topic_id: 'admissions', version: 'a1', created_at: '0', updated_at: '0' })
  fake.seed('integration_participants', 'stars-demo:r2:p_1', {
    ...ns,
    participant_id: 'p_1',
    author_label: 'Participant A',
    topic_ids: ['star-data', 'admissions'],
    created_at: '0',
  })
  fake.seed('integration_participants', 'stars-demo:r2:p_2', {
    ...ns,
    participant_id: 'p_2',
    author_label: 'Participant B',
    topic_ids: ['star-data'],
    created_at: '0',
  })
  fake.seed('integration_messages', 'u1', { ...ns, topic_id: 'star-data', group_id: SD, kind: 'participant', author_id: 'p_1', created_at: '1' })
  fake.seed('integration_messages', 'u2', { ...ns, topic_id: 'admissions', group_id: AD, kind: 'participant', author_id: 'p_1', created_at: '2' })
  fake.seed('integration_messages', 'u3', { ...ns, topic_id: 'star-data', group_id: SD, kind: 'participant', author_id: 'p_2', created_at: '3' })
  fake.seed('integration_messages', 'r1', { ...ns, topic_id: 'star-data', group_id: SD, kind: 'facilitator', depends_on_message_ids: ['u3'], depends_on_participant_ids: ['p_1', 'p_2'], created_at: '4' })
  fake.seed('integration_messages', 'r2', { ...ns, topic_id: 'star-data', group_id: SD, kind: 'facilitator', depends_on_message_ids: ['u3'], depends_on_participant_ids: ['p_2'], created_at: '5' })
})

describe('POST participants/erase', () => {
  it('401s without the secret and deletes nothing', async () => {
    expect((await postJson(POST, PATH, erase, {})).status).toBe(401)
    expect(fake.all('integration_messages')).toHaveLength(5)
  })
  it('400s a key of the wrong shape', async () => {
    expect(await errorCode(await postJson(POST, PATH, { ...erase, operation_key: 'op:1' }))).toBe('invalid_request')
  })
  it('erases messages, replies that saw them, and the record; bumps touched groups', async () => {
    const res = await postJson(POST, PATH, erase)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toMatchObject({ round: 'r2', participant_id: 'p_1', status: 'confirmed' })
    expect(body.topics_cleared.sort()).toEqual(['admissions', 'star-data'])
    expect(fake.all('integration_messages').map((m) => m.id).sort()).toEqual(['r2', 'u3'])
    expect(fake.get('integration_participants', 'stars-demo:r2:p_1')).toBeNull()
    expect(fake.get('integration_participants', 'stars-demo:r2:p_2')).not.toBeNull()
    expect(fake.get('integration_groups', SD)!.version).not.toBe('v1')
  })
  it('an unknown participant is confirmed with no topics (job-safe)', async () => {
    expect(
      await (await postJson(POST, PATH, { ...erase, participant_id: 'p_9', operation_key: `r2:erase:p_9:${UUID}` })).json()
    ).toEqual({ round: 'r2', participant_id: 'p_9', status: 'confirmed', topics_cleared: [] })
  })
  it('replays a confirmed key with the original response', async () => {
    const first = await (await postJson(POST, PATH, erase)).json()
    expect(await (await postJson(POST, PATH, erase)).json()).toEqual(first)
  })
  it('answers pending on a storage failure so the job retries', async () => {
    ;(fake.db as unknown as { batch: unknown }).batch = () => {
      throw new Error('storage detail')
    }
    const res = await postJson(POST, PATH, erase)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ round: 'r2', participant_id: 'p_1', status: 'pending', topics_cleared: [] })
    expect(fake.all('integration_ops')).toHaveLength(0)
  })
})
