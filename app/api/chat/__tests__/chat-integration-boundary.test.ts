import { describe, it, expect, vi, beforeEach } from 'vitest'

// Spec 08 checklist, automated: the integration secret must not open the
// product chat route, and the product route never reads integration_*.
// getAuthenticatedUser is NOT mocked; only Firebase Admin is.
const collectionCalls: string[] = []
const verifyIdToken = vi.fn()
vi.mock('@/lib/firebase/admin', () => ({
  getAdminAuth: () => ({ verifyIdToken }),
  getAdminDb: () => ({
    collection: (name: string) => {
      collectionCalls.push(name)
      return {
        doc: () => ({ get: async () => ({ exists: false, data: () => undefined }) }),
        where: () => ({ orderBy: () => ({ get: async () => ({ docs: [] }) }) }),
      }
    },
  }),
}))
vi.mock('@/lib/garm', () => ({ resolveCanonicalEmail: async (e: string) => e, garmCheck: vi.fn(), GARM_PROJECT: 'x' }))
vi.mock('@/lib/garm-shadow', () => ({
  scheduleGarmShadowCheck: vi.fn(),
  shadowCheckApprovedEmail: vi.fn(),
  shadowCheckLocalAllowlist: vi.fn(),
}))

import { POST } from '../route'

beforeEach(() => {
  vi.stubEnv('STARS_INTEGRATION_SECRET', 'test-secret-value-not-real')
  collectionCalls.length = 0
  verifyIdToken.mockReset().mockRejectedValue(new Error('not a Firebase token'))
})

describe('POST /api/chat with integration credentials', () => {
  it('is rejected with 401 before any Firestore read', async () => {
    const res = await POST(
      new Request('http://localhost/api/chat', {
        method: 'POST',
        headers: {
          'X-Integration-Secret': 'test-secret-value-not-real',
          'X-Integration-Namespace': 'stars-demo',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ session_id: 's1', content: 'synthetic' }),
      })
    )
    expect(res.status).toBe(401)
    expect(collectionCalls).toEqual([])
  })
})
