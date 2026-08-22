import { describe, it, expect, vi, beforeEach } from 'vitest'
import { GET } from '../route'

// =============================================================================
// /api/health is polled every 10 minutes by .github/workflows/monitor.yml as
// the sign-in-outage tripwire. Garm gates sign-in fail-closed, so a Garm
// outage means nobody can sign in — this check makes sure the route actually
// goes 503 (not silently green) when garmProbe reports unhealthy.
//
// Firestore is stubbed with a chainable no-op db so the six pre-existing
// Firestore checks always pass; only garmProbe varies per test.
// =============================================================================

const mockGarmProbe = vi.fn()

vi.mock('@/lib/garm', () => ({
  garmProbe: () => mockGarmProbe(),
}))

vi.mock('@/lib/firebase/admin', () => ({
  getAdminDb: () => makeFakeDb(),
}))

// A Firestore query-builder stub: every chain method returns the same node,
// and get() resolves to an empty, well-formed snapshot.
function makeFakeDb() {
  const node: Record<string, unknown> = {}
  node.collection = () => node
  node.where = () => node
  node.orderBy = () => node
  node.limit = () => node
  node.get = () => Promise.resolve({ docs: [], empty: true })
  return node
}

beforeEach(() => {
  mockGarmProbe.mockReset()
})

describe('GET /api/health — garm_reachable check', () => {
  it('returns 200 with a passing garm_reachable check when Garm answers healthy', async () => {
    mockGarmProbe.mockResolvedValue({ ok: true, status: 200, ms: 12 })
    const res = await GET()
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body.ok).toBe(true)
    const garmCheck = body.checks.find((c: { name: string }) => c.name === 'garm_reachable')
    expect(garmCheck).toMatchObject({ ok: true })
  })

  it('returns 503 with a failing garm_reachable check when Garm is unreachable', async () => {
    mockGarmProbe.mockResolvedValue({ ok: false, error: 'garm returned 401', status: 401, ms: 8 })
    const res = await GET()
    const body = await res.json()
    expect(res.status).toBe(503)
    expect(body.ok).toBe(false)
    const garmCheck = body.checks.find((c: { name: string }) => c.name === 'garm_reachable')
    expect(garmCheck).toBeDefined()
    expect(garmCheck.ok).toBe(false)
    expect(garmCheck.error).toBeDefined()
  })

  it('never surfaces a consumer key in the response body', async () => {
    mockGarmProbe.mockResolvedValue({ ok: false, error: 'GARM_KEY not set', ms: 0 })
    const res = await GET()
    const text = JSON.stringify(await res.json())
    expect(text).not.toMatch(/Bearer/i)
  })
})
