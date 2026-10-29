import { describe, it, expect, vi, beforeEach } from 'vitest'
import { GET, POST } from '../route'
import { GET as GET_ONE, PATCH } from '../[slug]/route'

// In-memory `apps` collection, shared by the real lib/api/apps helpers.
let store: Map<string, Record<string, unknown>>
const mockGetAuthenticatedUser = vi.fn()
const mockHasSystemRole = vi.fn()

function db() {
  const snap = (id: string) => ({ id, exists: store.has(id), data: () => store.get(id) })
  return {
    collection: () => ({
      doc: (id: string) => ({
        get: async () => snap(id),
        set: async (d: Record<string, unknown>) => {
          store.set(id, d)
        },
        create: async (d: Record<string, unknown>) => {
          if (store.has(id)) throw Object.assign(new Error('exists'), { code: 6 })
          store.set(id, d)
        },
        update: async (d: Record<string, unknown>) => {
          const next = { ...store.get(id), ...d }
          // Honour FieldValue.delete() sentinels like Firestore does.
          for (const [k, v] of Object.entries(next)) {
            if (v && v.constructor?.name === 'DeleteTransform') delete next[k]
          }
          store.set(id, next)
        },
      }),
      where: (_f: string, _o: string, value: string) => ({
        limit: () => ({
          get: async () => {
            const docs = [...store.entries()]
              .filter(([, d]) => ((d.legacy_slugs as string[] | undefined) ?? []).includes(value))
              .map(([id]) => snap(id))
            return { empty: docs.length === 0, docs }
          },
        }),
      }),
      get: async () => ({ docs: [...store.keys()].map(snap) }),
    }),
  }
}

vi.mock('@/lib/api/firebase-server-helpers', () => ({
  getAuthenticatedUser: (req: Request) => mockGetAuthenticatedUser(req),
  hasSystemRole: (auth: unknown, role: string) => mockHasSystemRole(auth, role),
  getAdminDb: () => db(),
}))

const adminAuth = { uid: 'u1', email: 'admin@x.com', systemRoles: ['admin'], error: null }
const base = { created_by: 'u0', created_at: 'x', updated_at: 'x' }

function req(method: string, body?: unknown) {
  return new Request('http://localhost/api/admin/apps', {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
}
const ctx = (slug: string) => ({ params: Promise.resolve({ slug }) })

beforeEach(() => {
  vi.clearAllMocks()
  store = new Map()
  mockGetAuthenticatedUser.mockResolvedValue(adminAuth)
  mockHasSystemRole.mockReturnValue(true)
})

describe('GET /api/admin/apps', () => {
  it('403 for a non-admin', async () => {
    mockHasSystemRole.mockReturnValue(false)
    expect((await GET(req('GET'))).status).toBe(403)
  })
  it('lists apps sorted by name', async () => {
    store.set('b', { ...base, slug: 'b', name: 'Zed' })
    store.set('a', { ...base, slug: 'a', name: 'Alpha' })
    const res = await GET(req('GET'))
    const json = await res.json()
    expect(json.apps.map((a: { name: string }) => a.name)).toEqual(['Alpha', 'Zed'])
  })
})

describe('POST /api/admin/apps', () => {
  it('201 creates with created_by = caller email', async () => {
    const res = await POST(req('POST', { slug: 'prntd', name: 'PRNTD', github_repo: 'a/b' }))
    expect(res.status).toBe(201)
    expect((await res.json()).app.created_by).toBe('admin@x.com')
    expect(store.get('prntd')?.created_by).toBe('admin@x.com')
  })
  it('400 for slug "Tide line" and does not normalise it', async () => {
    const res = await POST(req('POST', { slug: 'Tide line', name: 'T' }))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe('Invalid slug')
    expect(store.size).toBe(0)
  })
  it('400 for slug "tideline-"', async () => {
    expect((await POST(req('POST', { slug: 'tideline-', name: 'T' }))).status).toBe(400)
  })
  it('400 for a blank name', async () => {
    expect((await POST(req('POST', { slug: 'ok', name: '  ' }))).status).toBe(400)
  })
  it('409 when the slug is an existing app’s legacy slug', async () => {
    store.set('byside', { ...base, slug: 'byside', name: 'B', legacy_slugs: ['old-brief'] })
    const res = await POST(req('POST', { slug: 'old-brief', name: 'X' }))
    expect(res.status).toBe(409)
    expect((await res.json()).error).toBe('Slug already in use')
  })
})

describe('/api/admin/apps/[slug]', () => {
  it('GET 404 for an unknown app', async () => {
    expect((await GET_ONE(req('GET'), ctx('nope'))).status).toBe(404)
  })
  it('GET returns the app', async () => {
    store.set('byside', { ...base, slug: 'byside', name: 'B' })
    expect((await (await GET_ONE(req('GET'), ctx('byside'))).json()).app.slug).toBe('byside')
  })
  it('PATCH 403 for a non-admin', async () => {
    mockHasSystemRole.mockReturnValue(false)
    expect((await PATCH(req('PATCH', { name: 'N' }), ctx('byside'))).status).toBe(403)
  })
  it('PATCH updates name and feedback_requires_identity, ignores slug', async () => {
    store.set('byside', { ...base, slug: 'byside', name: 'B' })
    const res = await PATCH(
      req('PATCH', { name: 'New', feedback_requires_identity: true, slug: 'hacked', legacy_slugs: ['z'], created_by: 'evil' }),
      ctx('byside')
    )
    expect(res.status).toBe(200)
    const doc = store.get('byside')!
    expect(doc.name).toBe('New')
    expect(doc.feedback_requires_identity).toBe(true)
    expect(doc.slug).toBe('byside')
    expect(doc.legacy_slugs).toBeUndefined()
    expect(doc.created_by).toBe('u0')
    expect(doc.updated_at).not.toBe('x')
  })
  it('PATCH 400 on a wrong type or malformed github_repo', async () => {
    store.set('byside', { ...base, slug: 'byside', name: 'B' })
    expect((await PATCH(req('PATCH', { name: 5 }), ctx('byside'))).status).toBe(400)
    expect((await PATCH(req('PATCH', { feedback_requires_identity: 'yes' }), ctx('byside'))).status).toBe(400)
    expect((await PATCH(req('PATCH', { github_repo: 'not a repo' }), ctx('byside'))).status).toBe(400)
  })
  it('PATCH sets github_repo and clears it with an empty string', async () => {
    store.set('byside', { ...base, slug: 'byside', name: 'B' })
    await PATCH(req('PATCH', { github_repo: 'nicolovejoy/byside' }), ctx('byside'))
    expect(store.get('byside')?.github_repo).toBe('nicolovejoy/byside')
    await PATCH(req('PATCH', { github_repo: '' }), ctx('byside'))
    expect(store.get('byside')?.github_repo).toBeUndefined()
  })
  it('PATCH 404 when the app does not exist', async () => {
    expect((await PATCH(req('PATCH', { name: 'N' }), ctx('nope'))).status).toBe(404)
  })
})
