import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createFakeFirestore } from '@/lib/integration/__tests__/fake-firestore'
import { SECRET, getWith, errorCode } from './helpers'

let fake = createFakeFirestore()
vi.mock('@/lib/firebase/admin', () => ({ getAdminDb: () => fake.db }))

import { GET } from '../stars-demo/messages/route'

const PATH = '/api/integrations/stars-demo/messages'
const G = 'stars-demo:r2:star-data'

beforeEach(() => {
  vi.stubEnv('STARS_INTEGRATION_SECRET', SECRET)
  fake = createFakeFirestore()
  fake.seed('integration_groups', G, {
    namespace: 'stars-demo',
    round: 'r2',
    topic_id: 'star-data',
    version: 'v1',
    created_at: '0',
    updated_at: '0',
  })
  fake.seed('integration_messages', 'u1', {
    group_id: G,
    namespace: 'stars-demo',
    round: 'r2',
    topic_id: 'star-data',
    kind: 'participant',
    author_id: 'p_1',
    author_label: 'Participant A',
    idempotency_key: 'k',
    reply_claimed_at: null,
    reply_claim_token: null,
    body: 'synthetic one',
    created_at: '2026-09-22T01:00:00.000Z',
  })
  fake.seed('integration_messages', 'r1', {
    group_id: G,
    namespace: 'stars-demo',
    round: 'r2',
    topic_id: 'star-data',
    kind: 'facilitator',
    body: 'synthetic reply',
    depends_on_message_ids: ['u1'],
    depends_on_participant_ids: ['p_1'],
    created_at: '2026-09-22T01:00:01.000Z',
  })
})

describe('GET messages', () => {
  it('401s without the secret', async () => {
    expect((await getWith(GET, `${PATH}?round=r2&topic_id=star-data`, {})).status).toBe(401)
  })
  it('400s invalid_request for a missing or unknown topic', async () => {
    expect(await errorCode(await getWith(GET, `${PATH}?round=r2`))).toBe('invalid_request')
    expect(await errorCode(await getWith(GET, `${PATH}?round=r2&topic_id=nope`))).toBe('invalid_request')
  })
  it('returns an empty list with a version for a group that does not exist yet', async () => {
    const res = await getWith(GET, `${PATH}?round=r2&topic_id=admissions`)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toMatchObject({ round: 'r2', topic_id: 'admissions', messages: [] })
    expect(typeof body.version).toBe('string')
  })
  it('returns wire messages in order, with dependency fields and without internals', async () => {
    const body = await (await getWith(GET, `${PATH}?round=r2&topic_id=star-data`)).json()
    expect(body).toMatchObject({ round: 'r2', topic_id: 'star-data', version: 'v1' })
    expect(body.messages).toEqual([
      {
        id: 'u1',
        kind: 'participant',
        author_id: 'p_1',
        author_label: 'Participant A',
        body: 'synthetic one',
        created_at: '2026-09-22T01:00:00.000Z',
      },
      {
        id: 'r1',
        kind: 'facilitator',
        body: 'synthetic reply',
        created_at: '2026-09-22T01:00:01.000Z',
        depends_on_message_ids: ['u1'],
        depends_on_participant_ids: ['p_1'],
      },
    ])
  })
})
