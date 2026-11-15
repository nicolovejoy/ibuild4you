import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { NextResponse } from 'next/server'
import { GET, POST, DELETE } from '../route'

// A small in-memory Firestore shared by the route and the real key store, so
// "two projects, one repo, one key" is tested for real.
type Doc = Record<string, unknown>
const data = new Map<string, Doc>()
const db = {
  collection: (name: string) => ({
    doc: (id: string) => ({
      get: async () => ({
        exists: data.has(`${name}/${id}`),
        data: () => data.get(`${name}/${id}`),
      }),
      set: async (doc: Doc) => {
        data.set(`${name}/${id}`, { ...doc })
      },
      delete: async () => {
        data.delete(`${name}/${id}`)
      },
    }),
  }),
}

const mockAuth = vi.fn()
vi.mock('@/lib/api/firebase-server-helpers', () => ({
  getAuthenticatedUser: (req: Request) => mockAuth(req),
  getAdminDb: () => db,
  hasSystemRole: (auth: { systemRoles: string[] }, role: string) => auth.systemRoles.includes(role),
}))

const adminAuth = { uid: 'u1', email: 'a@x.com', systemRoles: ['admin'], error: null }
const req = (method: string, projectId: string | null = 'p-l6') =>
  new Request(
    `http://localhost/api/build-status/key${projectId ? `?project_id=${projectId}` : ''}`,
    { method }
  )

let logSpy: ReturnType<typeof vi.spyOn>
beforeEach(() => {
  data.clear()
  data.set('projects/p-l6', { github_repo: 'nicolovejoy/l6-music' })
  data.set('projects/p-l6-twin', { github_repo: 'https://github.com/NicoLovejoy/l6-music' })
  data.set('projects/p-bare', { github_repo: 'byside' })
  data.set('projects/p-none', {})
  data.set('projects/p-shell', { github_repo: `x/y'"$(id)"'` })
  mockAuth.mockReset()
  mockAuth.mockResolvedValue(adminAuth)
  logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
})
afterEach(() => logSpy.mockRestore())

describe('auth', () => {
  it('passes a 401 through', async () => {
    mockAuth.mockResolvedValue({
      error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }),
    })
    expect((await GET(req('GET'))).status).toBe(401)
  })

  it('403s a non-admin on GET, POST and DELETE and touches no key', async () => {
    mockAuth.mockResolvedValue({ ...adminAuth, systemRoles: [] })
    const rs = [await GET(req('GET')), await POST(req('POST')), await DELETE(req('DELETE'))]
    expect(rs.map((r) => r.status)).toEqual([403, 403, 403])
    expect(await rs[0].json()).toEqual({ error: 'Forbidden' })
    expect([...data.keys()].some((k) => k.startsWith('build_status_keys/'))).toBe(false)
  })
})

describe('project and repo', () => {
  it('400s a missing project_id', async () => {
    const res = await GET(req('GET', null))
    expect(res.status).toBe(400)
  })

  it('404s an unknown project', async () => {
    for (const fn of [GET, POST, DELETE]) {
      expect((await fn(req('X', 'nope'))).status).toBe(404)
    }
  })

  it('400s needs_full_repo for a bare repo name, and mints nothing', async () => {
    for (const fn of [GET, POST, DELETE]) {
      const res = await fn(req('X', 'p-bare'))
      expect(res.status).toBe(400)
      expect(await res.json()).toEqual({ error: 'needs_full_repo' })
    }
    expect([...data.keys()].some((k) => k.startsWith('build_status_keys/'))).toBe(false)
  })

  it('400s needs_full_repo for a repo with shell characters, and mints nothing', async () => {
    for (const fn of [GET, POST, DELETE]) {
      const res = await fn(req('X', 'p-shell'))
      expect(res.status).toBe(400)
      expect(await res.json()).toEqual({ error: 'needs_full_repo' })
    }
    expect([...data.keys()].some((k) => k.startsWith('build_status_keys/'))).toBe(false)
  })

  it('400s needs_full_repo when the project has no repo', async () => {
    const res = await POST(req('POST', 'p-none'))
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'needs_full_repo' })
  })
})

describe('GET', () => {
  it('reports no key yet, no-store, with the normalized repo', async () => {
    const res = await GET(req('GET'))
    expect(res.status).toBe(200)
    expect(res.headers.get('cache-control')).toBe('no-store')
    expect(await res.json()).toEqual({
      repo: 'nicolovejoy/l6-music',
      exists: false,
      created_at: null,
      last_used_at: null,
    })
  })
})

describe('POST', () => {
  it('mints a bsk_ key, 201, no-store, and logs without the key', async () => {
    const res = await POST(req('POST'))
    expect(res.status).toBe(201)
    expect(res.headers.get('cache-control')).toBe('no-store')
    const body = await res.json()
    expect(body.repo).toBe('nicolovejoy/l6-music')
    expect(body.key.startsWith('bsk_')).toBe(true)
    expect(body.rotated).toBe(false)
    expect(logSpy).toHaveBeenCalledTimes(1)
    const line = logSpy.mock.calls[0][0] as string
    expect(JSON.parse(line)).toEqual({
      event: 'build_status_key_minted',
      repo: 'nicolovejoy/l6-music',
      actor: 'u1',
    })
    expect(line).not.toContain(body.key)
  })

  it('answers rotated: true when a key already existed', async () => {
    await POST(req('POST'))
    const second = await (await POST(req('POST'))).json()
    expect(second.rotated).toBe(true)
  })

  it('never stores or returns the key through GET', async () => {
    const { key } = await (await POST(req('POST'))).json()
    const text = JSON.stringify(await (await GET(req('GET'))).json())
    expect(text).not.toContain(key)
    expect(text).not.toContain('key_hash')
    expect(JSON.parse(text).exists).toBe(true)
  })

  it('two projects on the same repo share one key', async () => {
    await POST(req('POST', 'p-l6'))
    const a = await (await GET(req('GET', 'p-l6'))).json()
    const b = await (await GET(req('GET', 'p-l6-twin'))).json()
    expect(a.exists).toBe(true)
    expect(b.created_at).toBe(a.created_at)
  })
})

describe('DELETE', () => {
  it('revokes the key and logs', async () => {
    await POST(req('POST'))
    logSpy.mockClear()
    const res = await DELETE(req('DELETE'))
    expect(res.status).toBe(200)
    expect(res.headers.get('cache-control')).toBe('no-store')
    expect(await res.json()).toEqual({ ok: true, revoked: true })
    expect(JSON.parse(logSpy.mock.calls[0][0] as string)).toEqual({
      event: 'build_status_key_revoked',
      repo: 'nicolovejoy/l6-music',
      actor: 'u1',
      revoked: true,
    })
    expect((await (await GET(req('GET'))).json()).exists).toBe(false)
  })

  it('says revoked: false when there was no key, in the body and the log', async () => {
    expect(await (await DELETE(req('DELETE'))).json()).toEqual({ ok: true, revoked: false })
    expect(JSON.parse(logSpy.mock.calls[0][0] as string)).toEqual({
      event: 'build_status_key_revoked',
      repo: 'nicolovejoy/l6-music',
      actor: 'u1',
      revoked: false,
    })
  })
})
