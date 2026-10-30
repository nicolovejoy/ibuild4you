import { describe, it, expect, vi, beforeEach } from 'vitest'
import { GET, POST, DELETE } from '../route'

const mockAuth = vi.fn()
vi.mock('@/lib/api/firebase-server-helpers', () => ({
  getAuthenticatedUser: (req: Request) => mockAuth(req),
}))

const mockRequireAppAccess = vi.fn()
vi.mock('@/lib/api/app-access', () => ({
  requireAppAccess: (...a: unknown[]) => mockRequireAppAccess(...a),
}))

const mockList = vi.fn()
const mockGrant = vi.fn()
const mockRevoke = vi.fn()
const mockBypassed = vi.fn()
const mockConfigured = vi.fn()
vi.mock('@/lib/garm-loop', () => {
  class GarmLoopError extends Error {
    status: number | null
    constructor(m: string, status: number | null) {
      super(m)
      this.status = status
    }
  }
  return {
    GarmLoopError,
    listAppGrants: (...a: unknown[]) => mockList(...a),
    grantOnApp: (...a: unknown[]) => mockGrant(...a),
    revokeOnApp: (...a: unknown[]) => mockRevoke(...a),
    loopGarmBypassed: () => mockBypassed(),
    loopGarmConfigured: () => mockConfigured(),
  }
})
import { NextResponse } from 'next/server'
import { GarmLoopError } from '@/lib/garm-loop'

const ownerAuth = { uid: 'u1', email: 'Owner@x.com', systemRoles: [], error: null }
const ctx = { params: Promise.resolve({ slug: 'byside' }) }
function req(method: string, body?: unknown, raw?: string) {
  return new Request('http://localhost/api/admin/apps/byside/admins', {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: raw ?? (body === undefined ? undefined : JSON.stringify(body)),
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  mockAuth.mockResolvedValue(ownerAuth)
  mockRequireAppAccess.mockResolvedValue(null)
  mockBypassed.mockReturnValue(false)
  mockConfigured.mockReturnValue(true)
  mockList.mockResolvedValue([])
  mockGrant.mockResolvedValue(undefined)
  mockRevoke.mockResolvedValue(undefined)
})

describe('owner gate', () => {
  beforeEach(() => {
    mockRequireAppAccess.mockResolvedValue(NextResponse.json({ error: 'Forbidden' }, { status: 403 }))
  })
  it('403s GET, POST and DELETE and never touches Garm', async () => {
    const r1 = await GET(req('GET'), ctx)
    const r2 = await POST(req('POST', { email: 'a@b.com', role: 'owner' }), ctx)
    const r3 = await DELETE(req('DELETE', { email: 'a@b.com' }), ctx)
    expect([r1.status, r2.status, r3.status]).toEqual([403, 403, 403])
    expect(r1.headers.get('cache-control')).toBe('no-store')
    expect(mockList).not.toHaveBeenCalled()
    expect(mockGrant).not.toHaveBeenCalled()
    expect(mockRevoke).not.toHaveBeenCalled()
    expect(mockRequireAppAccess).toHaveBeenCalledWith(ownerAuth, 'byside', 'owner')
  })
})

describe('GET', () => {
  it('returns Garm list verbatim', async () => {
    const admins = [
      { email: 'a@b.com', role: 'owner', created_at: 't', created_by: 'x' },
      { email: 'c@d.com', role: 'viewer', created_at: 't', created_by: 'x' },
    ]
    mockList.mockResolvedValue(admins)
    const res = await GET(req('GET'), ctx)
    expect(await res.json()).toEqual({ admins })
    expect(res.headers.get('cache-control')).toBe('no-store')
  })
  it('503 when Garm is bypassed or unconfigured', async () => {
    mockBypassed.mockReturnValue(true)
    const res = await GET(req('GET'), ctx)
    expect(res.status).toBe(503)
    expect(await res.json()).toEqual({ error: 'Garm is not configured' })
    mockBypassed.mockReturnValue(false)
    mockConfigured.mockReturnValue(false)
    expect((await GET(req('GET'), ctx)).status).toBe(503)
  })
  it('maps Garm errors', async () => {
    const cases: Array<[number | null, number, unknown]> = [
      [404, 404, { error: 'App not found in Garm' }],
      [403, 403, { error: 'Garm says you are not an owner of this app' }],
      [409, 409, { error: 'last_owner' }],
      [400, 400, { error: 'Garm rejected the request' }],
      [500, 502, { error: 'Garm is unavailable' }],
      [null, 502, { error: 'Garm is unavailable' }],
    ]
    for (const [garm, status, body] of cases) {
      mockList.mockRejectedValue(new GarmLoopError('x', garm))
      const res = await GET(req('GET'), ctx)
      expect(res.status).toBe(status)
      expect(await res.json()).toEqual(body)
      expect(res.headers.get('cache-control')).toBe('no-store')
    }
  })
})

describe('POST', () => {
  it('grants with the actor and a normalized email', async () => {
    const res = await POST(req('POST', { email: '  New@Example.COM ', role: 'collaborator' }), ctx)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })
    expect(mockGrant).toHaveBeenCalledWith('Owner@x.com', 'byside', 'new@example.com', 'collaborator')
    expect(res.headers.get('cache-control')).toBe('no-store')
  })
  it('rejects viewer role, bad email, bad JSON', async () => {
    expect((await POST(req('POST', { email: 'a@b.com', role: 'viewer' }), ctx)).status).toBe(400)
    expect((await POST(req('POST', { email: 'nope', role: 'owner' }), ctx)).status).toBe(400)
    const bad = await POST(req('POST', undefined, '{nope'), ctx)
    expect(bad.status).toBe(400)
    expect(await bad.json()).toEqual({ error: 'Invalid JSON' })
    expect(mockGrant).not.toHaveBeenCalled()
  })
  it('maps a Garm 403', async () => {
    mockGrant.mockRejectedValue(new GarmLoopError('x', 403))
    const res = await POST(req('POST', { email: 'a@b.com', role: 'owner' }), ctx)
    expect(res.status).toBe(403)
  })
})

describe('DELETE', () => {
  it('revokes with the actor and a normalized email', async () => {
    const res = await DELETE(req('DELETE', { email: 'Gone@X.com' }), ctx)
    expect(await res.json()).toEqual({ ok: true })
    expect(mockRevoke).toHaveBeenCalledWith('Owner@x.com', 'byside', 'gone@x.com')
  })
  it('409 last_owner passes through', async () => {
    mockRevoke.mockRejectedValue(new GarmLoopError('x', 409))
    const res = await DELETE(req('DELETE', { email: 'a@b.com' }), ctx)
    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({ error: 'last_owner' })
  })
  it('400 on a bad email', async () => {
    expect((await DELETE(req('DELETE', { email: 'x' }), ctx)).status).toBe(400)
  })
})
