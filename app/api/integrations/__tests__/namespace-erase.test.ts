import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createFakeFirestore } from '@/lib/integration/__tests__/fake-firestore'
import { SECRET, UUID, postJson, errorCode } from './helpers'

let fake = createFakeFirestore()
vi.mock('@/lib/firebase/admin', () => ({ getAdminDb: () => fake.db }))

import { POST } from '../stars-demo/namespace/erase/route'

const PATH = '/api/integrations/stars-demo/namespace/erase'
const ns = { namespace: 'stars-demo', round: 'r2' }
const body = { round: 'r2', operation_key: `r2:namespace-erase:${UUID}` }

beforeEach(() => {
  vi.stubEnv('STARS_INTEGRATION_SECRET', SECRET)
  fake = createFakeFirestore()
  fake.seed('integration_groups', 'stars-demo:r2:star-data', {
    ...ns,
    topic_id: 'star-data',
    version: 'v1',
    created_at: '0',
    updated_at: '0',
  })
  fake.seed('integration_participants', 'stars-demo:r2:p_1', {
    ...ns,
    participant_id: 'p_1',
    author_label: 'Participant A',
    topic_ids: ['star-data'],
    created_at: '0',
  })
  fake.seed('integration_messages', 'u1', {
    ...ns,
    topic_id: 'star-data',
    group_id: 'stars-demo:r2:star-data',
    kind: 'participant',
    author_id: 'p_1',
    created_at: '1',
  })
  fake.seed('integration_ops', 'stars-demo:del:1', { ...ns, kind: 'delete', response: {}, created_at: '0' })
  fake.seed('integration_messages', 'x', {
    namespace: 'other',
    round: 'r2',
    topic_id: 'star-data',
    group_id: 'other:r2:star-data',
    kind: 'participant',
    author_id: 'p_1',
    created_at: '1',
  })
})

describe('POST namespace/erase', () => {
  it('401s without the secret', async () => {
    expect((await postJson(POST, PATH, body, {})).status).toBe(401)
  })
  it('400s a key of the wrong shape', async () => {
    expect(await errorCode(await postJson(POST, PATH, { round: 'r2', operation_key: `r2:erase:p_1:${UUID}` }))).toBe(
      'invalid_request'
    )
  })
  it('clears groups, participants, messages and ops for this namespace and round only', async () => {
    const res = await postJson(POST, PATH, body)
    expect(await res.json()).toEqual({ round: 'r2', status: 'confirmed', topics_cleared: ['star-data'] })
    expect(fake.all('integration_groups')).toHaveLength(0)
    expect(fake.all('integration_participants')).toHaveLength(0)
    expect(fake.all('integration_messages').map((m) => m.id)).toEqual(['x'])
    expect(fake.all('integration_ops').map((o) => o.id)).toEqual([`stars-demo:${body.operation_key}`])
  })
  it('replays with the original response', async () => {
    const first = await (await postJson(POST, PATH, body)).json()
    expect(await (await postJson(POST, PATH, body)).json()).toEqual(first)
  })
})
