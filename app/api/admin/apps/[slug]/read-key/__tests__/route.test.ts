import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { NextResponse } from 'next/server'
import { GET, POST, DELETE } from '../route'

const mockAuth = vi.fn()
let appExists = true
const mockAppGet = vi.fn(async () => ({ exists: appExists }))
const mockDoc = vi.fn((_id: string) => ({ get: mockAppGet }))
const mockCollection = vi.fn((_name: string) => ({ doc: mockDoc }))
vi.mock('@/lib/api/firebase-server-helpers', () => ({
  getAuthenticatedUser: (req: Request) => mockAuth(req),
  getAdminDb: () => ({ collection: mockCollection }),
  hasSystemRole: (auth: { systemRoles: string[] }, role: string) => auth.systemRoles.includes(role),
}))

const mockMint = vi.fn()
const mockRevoke = vi.fn()
const mockStatus = vi.fn()
vi.mock('@/lib/feedback/read-keys', () => ({
  mintReadKey: (...a: unknown[]) => mockMint(...a),
  revokeReadKey: (...a: unknown[]) => mockRevoke(...a),
  getReadKeyStatus: (...a: unknown[]) => mockStatus(...a),
}))

const KEY = 'lrk_SECRETSECRETSECRETSECRE'
const adminAuth = { uid: 'u1', email: 'a@x.com', systemRoles: ['admin'], error: null }
const ctxFor = (slug: string) => ({ params: Promise.resolve({ slug }) })
const ctx = ctxFor('byside')
const req = (method: string) =>
  new Request('http://localhost/api/admin/apps/byside/read-key', { method })

let logSpy: ReturnType<typeof vi.spyOn>
beforeEach(() => {
  vi.clearAllMocks()
  appExists = true
  mockAuth.mockResolvedValue(adminAuth)
  mockStatus.mockResolvedValue({ active: true, created_at: 't1', last_used_at: null })
  mockMint.mockResolvedValue({ key: KEY, created_at: 't2', rotated: true })
  mockRevoke.mockResolvedValue(true)
  logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
})
afterEach(() => logSpy.mockRestore())

describe('auth', () => {
  it('passes a 401 through', async () => {
    mockAuth.mockResolvedValue({
      error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }),
    })
    const res = await GET(req('GET'), ctx)
    expect(res.status).toBe(401)
    expect(mockStatus).not.toHaveBeenCalled()
  })
  it('403s a non-admin on GET, POST, DELETE and never touches the store', async () => {
    mockAuth.mockResolvedValue({ ...adminAuth, systemRoles: [] })
    const rs = [
      await GET(req('GET'), ctx),
      await POST(req('POST'), ctx),
      await DELETE(req('DELETE'), ctx),
    ]
    expect(rs.map((r) => r.status)).toEqual([403, 403, 403])
    expect(await rs[0].json()).toEqual({ error: 'Forbidden' })
    expect(mockStatus).not.toHaveBeenCalled()
    expect(mockMint).not.toHaveBeenCalled()
    expect(mockRevoke).not.toHaveBeenCalled()
    expect(mockCollection).not.toHaveBeenCalled()
  })
})

describe('slug and app', () => {
  it('400s an invalid slug', async () => {
    const res = await POST(req('POST'), ctxFor('Bad_Slug'))
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'Invalid slug' })
    expect(mockMint).not.toHaveBeenCalled()
  })
  it('404s an unknown app', async () => {
    appExists = false
    for (const fn of [GET, POST, DELETE]) {
      const res = await fn(req('X'), ctxFor('nope'))
      expect(res.status).toBe(404)
      expect(await res.json()).toEqual({ error: 'App not found' })
    }
    expect(mockCollection).toHaveBeenCalledWith('apps')
    expect(mockDoc).toHaveBeenCalledWith('nope')
    expect(mockMint).not.toHaveBeenCalled()
    expect(mockRevoke).not.toHaveBeenCalled()
  })
})

describe('GET', () => {
  it('returns the status with no key or hash', async () => {
    const res = await GET(req('GET'), ctx)
    expect(res.status).toBe(200)
    expect(res.headers.get('cache-control')).toBe('no-store')
    const text = JSON.stringify(await res.json())
    expect(JSON.parse(text)).toEqual({ active: true, created_at: 't1', last_used_at: null })
    expect(text).not.toContain('"key"')
    expect(text).not.toContain('key_hash')
  })
})

describe('POST', () => {
  it('mints, answers 201 with the key, no-store, and logs without the key', async () => {
    const res = await POST(req('POST'), ctx)
    expect(res.status).toBe(201)
    expect(res.headers.get('cache-control')).toBe('no-store')
    expect(await res.json()).toEqual({ key: KEY, created_at: 't2', rotated: true })
    expect(mockMint).toHaveBeenCalledWith(expect.anything(), 'byside', 'u1')
    expect(logSpy).toHaveBeenCalledTimes(1)
    const line = logSpy.mock.calls[0][0] as string
    expect(JSON.parse(line)).toEqual({
      event: 'loop_read_key_minted',
      slug: 'byside',
      actor: 'u1',
      rotated: true,
    })
    expect(line).not.toContain(KEY)
  })
})

describe('DELETE', () => {
  it('revokes and logs', async () => {
    const res = await DELETE(req('DELETE'), ctx)
    expect(res.status).toBe(200)
    expect(res.headers.get('cache-control')).toBe('no-store')
    expect(await res.json()).toEqual({ ok: true, revoked: true })
    expect(mockRevoke).toHaveBeenCalledWith(expect.anything(), 'byside')
    expect(JSON.parse(logSpy.mock.calls[0][0] as string)).toEqual({
      event: 'loop_read_key_revoked',
      slug: 'byside',
      actor: 'u1',
    })
  })
})
