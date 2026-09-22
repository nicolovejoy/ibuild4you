import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createFakeFirestore } from '@/lib/integration/__tests__/fake-firestore'
import { SECRET, postJson, errorCode } from './helpers'

let fake = createFakeFirestore()
vi.mock('@/lib/firebase/admin', () => ({ getAdminDb: () => fake.db }))

import { POST } from '../stars-demo/participants/ensure/route'

const PATH = '/api/integrations/stars-demo/participants/ensure'
const body = { round: 'r2', participant_id: 'p_1', author_label: 'Participant A', topic_ids: ['star-data', 'admissions'] }

beforeEach(() => {
  vi.stubEnv('STARS_INTEGRATION_SECRET', SECRET)
  fake = createFakeFirestore()
})

describe('POST participants/ensure', () => {
  it('401s without the secret and writes nothing', async () => {
    expect((await postJson(POST, PATH, body, {})).status).toBe(401)
    expect(fake.all('integration_participants')).toHaveLength(0)
    expect(fake.all('integration_groups')).toHaveLength(0)
  })

  it('400s invalid_request for bad JSON or an unknown topic', async () => {
    expect(await errorCode(await postJson(POST, PATH, '{nope'))).toBe('invalid_request')
    expect(await errorCode(await postJson(POST, PATH, { ...body, topic_ids: ['x'] }))).toBe('invalid_request')
  })

  it('creates the participant and its groups lazily, echoes the request', async () => {
    const res = await postJson(POST, PATH, body)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({
      round: 'r2',
      participant_id: 'p_1',
      topic_ids: ['star-data', 'admissions'],
      created: true,
    })
    expect(fake.all('integration_groups').map((g) => g.topic_id).sort()).toEqual(['admissions', 'star-data'])
    const p = fake.all('integration_participants')[0]
    expect(p).toMatchObject({ namespace: 'stars-demo', round: 'r2', participant_id: 'p_1', author_label: 'Participant A' })
    expect(Object.keys(p).sort()).toEqual([
      'author_label',
      'created_at',
      'id',
      'namespace',
      'participant_id',
      'round',
      'topic_ids',
    ])
  })

  it('a re-run is a no-op: created false, stored topics and label untouched, no ops record', async () => {
    await postJson(POST, PATH, body)
    const res = await postJson(POST, PATH, { ...body, author_label: 'Participant Z', topic_ids: ['self-service'] })
    expect(await res.json()).toEqual({
      round: 'r2',
      participant_id: 'p_1',
      topic_ids: ['star-data', 'admissions'],
      created: false,
    })
    expect(fake.all('integration_participants')[0].author_label).toBe('Participant A')
    expect(fake.all('integration_groups')).toHaveLength(2)
    expect(fake.all('integration_ops')).toHaveLength(0)
  })

  it('never touches product collections', async () => {
    await postJson(POST, PATH, body)
    for (const c of ['sessions', 'messages', 'projects', 'project_members', 'users']) {
      expect(fake.all(c)).toHaveLength(0)
    }
  })
})
