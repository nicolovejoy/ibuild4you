import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createFakeFirestore } from '@/lib/integration/__tests__/fake-firestore'
import { SECRET, postJson, getWith } from './helpers'

let fake = createFakeFirestore()
vi.mock('@/lib/firebase/admin', () => ({
  getAdminDb: () => fake.db,
  getAdminAuth: () => ({
    verifyIdToken: vi.fn(async () => ({ uid: 'admin-uid', email: 'admin@ibuild4you.com' })),
  }),
}))

import { GET as list, POST as send } from '../stars-demo/messages/route'
import { POST as del } from '../stars-demo/messages/delete/route'
import { POST as ensure } from '../stars-demo/participants/ensure/route'
import { POST as erase } from '../stars-demo/participants/erase/route'
import { POST as nsErase } from '../stars-demo/namespace/erase/route'

// A valid Firebase ID token (even an admin's) carries no integration secret,
// so every integration route refuses it (08a §5).
const firebaseHeaders = {
  Authorization: 'Bearer valid-looking-id-token',
  'X-Integration-Namespace': 'stars-demo',
  'Content-Type': 'application/json',
}

beforeEach(() => {
  vi.stubEnv('STARS_INTEGRATION_SECRET', SECRET)
  fake = createFakeFirestore()
})

describe('integration routes with a Firebase token and no secret', () => {
  it('all six refuse with 401 and touch nothing', async () => {
    const results = await Promise.all([
      getWith(list, '/api/integrations/stars-demo/messages?round=r2&topic_id=star-data', firebaseHeaders),
      postJson(send, '/api/integrations/stars-demo/messages', {}, firebaseHeaders),
      postJson(del, '/api/integrations/stars-demo/messages/delete', {}, firebaseHeaders),
      postJson(ensure, '/api/integrations/stars-demo/participants/ensure', {}, firebaseHeaders),
      postJson(erase, '/api/integrations/stars-demo/participants/erase', {}, firebaseHeaders),
      postJson(nsErase, '/api/integrations/stars-demo/namespace/erase', {}, firebaseHeaders),
    ])
    for (const r of results) expect(r.status).toBe(401)
    for (const c of ['integration_groups', 'integration_participants', 'integration_messages', 'integration_ops']) {
      expect(fake.all(c)).toHaveLength(0)
    }
  })
})
