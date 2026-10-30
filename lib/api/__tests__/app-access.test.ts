import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { AuthSuccess } from '@/lib/api/firebase-server-helpers'
import { appAccessFor, requireAppAccess, accessibleApps, hasAnyAppAccess } from '../app-access'

import { GarmLoopError } from '@/lib/garm-loop'

// mockLoopCheck answers loopCheckResult: 'allowed' | 'denied' | 'error'.
const mockLoopCheck = vi.fn()
const mockListGrants = vi.fn()
const mockBypassed = vi.fn()
const mockConfigured = vi.fn()
vi.mock('@/lib/garm-loop', () => {
  class GarmLoopError extends Error {
    status: number | null
    code: string | null
    constructor(m: string, status: number | null, code: string | null = null) {
      super(m)
      this.status = status
      this.code = code
    }
  }
  return {
    GarmLoopError,
    loopCheckResult: (...a: unknown[]) => mockLoopCheck(...a),
    loopCheck: async (...a: unknown[]) => (await mockLoopCheck(...a)) === 'allowed',
    listGrantsForEmail: (...a: unknown[]) => mockListGrants(...a),
    loopGarmBypassed: () => mockBypassed(),
    loopGarmConfigured: () => mockConfigured(),
  }
})

let store: Map<string, Record<string, unknown>>
vi.mock('@/lib/api/firebase-server-helpers', () => ({
  hasSystemRole: (auth: { systemRoles: string[] }, role: string) => auth.systemRoles.includes(role),
  getAdminDb: () => ({
    collection: () => ({
      doc: (id: string) => ({
        get: async () => ({ id, exists: store.has(id), data: () => store.get(id) }),
      }),
      get: async () => ({
        docs: [...store.entries()].map(([id, d]) => ({ id, data: () => d })),
      }),
    }),
  }),
}))

const admin = { email: 'a@x.com', systemRoles: ['admin'] } as unknown as AuthSuccess
const user = { email: 'u@x.com', systemRoles: [] } as unknown as AuthSuccess

// loopCheckResult(email, slug, min) answers from a table of "slug:min" -> allowed.
function allow(...keys: string[]) {
  mockLoopCheck.mockImplementation(async (_e: string, slug: string, min: string) =>
    keys.includes(`${slug}:${min}`) ? 'allowed' : 'denied'
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  store = new Map()
  mockBypassed.mockReturnValue(false)
  mockConfigured.mockReturnValue(true)
  mockLoopCheck.mockResolvedValue('denied')
})

describe('appAccessFor', () => {
  it('returns admin for a system admin without calling Garm', async () => {
    expect(await appAccessFor(admin, 'tideline')).toBe('admin')
    expect(mockLoopCheck).not.toHaveBeenCalled()
  })
  it('returns owner, collaborator or null from loopCheck', async () => {
    allow('a:owner', 'a:collaborator', 'b:collaborator')
    expect(await appAccessFor(user, 'a')).toBe('owner')
    expect(await appAccessFor(user, 'b')).toBe('collaborator')
    expect(await appAccessFor(user, 'c')).toBeNull()
  })
  it('returns null for a non-admin when bypassed or unconfigured', async () => {
    allow('a:owner')
    mockBypassed.mockReturnValue(true)
    expect(await appAccessFor(user, 'a')).toBeNull()
    mockBypassed.mockReturnValue(false)
    mockConfigured.mockReturnValue(false)
    expect(await appAccessFor(user, 'a')).toBeNull()
  })
  it('throws GarmLoopError when a check errors (outage, not a refusal)', async () => {
    mockLoopCheck.mockResolvedValue('error')
    await expect(appAccessFor(user, 'a')).rejects.toBeInstanceOf(GarmLoopError)
  })
  it('throws when the owner check is denied and the collaborator check errors', async () => {
    mockLoopCheck.mockImplementation(async (_e: string, _s: string, min: string) =>
      min === 'owner' ? 'denied' : 'error'
    )
    await expect(appAccessFor(user, 'a')).rejects.toBeInstanceOf(GarmLoopError)
  })
})

describe('requireAppAccess', () => {
  it('403s a collaborator asking for owner; allows owner, and owner for collaborator', async () => {
    allow('a:collaborator')
    const denied = await requireAppAccess(user, 'a', 'owner')
    expect(denied?.status).toBe(403)
    allow('a:owner', 'a:collaborator')
    expect(await requireAppAccess(user, 'a', 'owner')).toBeNull()
    expect(await requireAppAccess(user, 'a', 'collaborator')).toBeNull()
  })
  it('always allows an admin', async () => {
    expect(await requireAppAccess(admin, 'a', 'owner')).toBeNull()
  })
  it('503s garm_unavailable when Garm errors', async () => {
    mockLoopCheck.mockResolvedValue('error')
    const res = await requireAppAccess(user, 'a', 'collaborator')
    expect(res?.status).toBe(503)
    expect(await res?.json()).toEqual({ error: 'garm_unavailable' })
  })
})

describe('accessibleApps', () => {
  beforeEach(() => {
    store.set('tideline', { name: 'Tideline' })
    store.set('byside', { name: 'Byside' })
  })
  it('returns every app for an admin', async () => {
    const r = await accessibleApps(admin)
    expect(r.map((x) => x.access)).toEqual(['admin', 'admin'])
    expect(r.map((x) => x.app.id)).toEqual(['byside', 'tideline'])
  })
  it('keeps owner/collaborator grants that have an app row', async () => {
    mockListGrants.mockResolvedValue([
      { project: 'tideline', role: 'owner' },
      { project: 'rock-art', role: 'owner' },
      { project: 'byside', role: 'viewer' },
    ])
    allow('tideline:owner', 'tideline:collaborator')
    const r = await accessibleApps(user)
    expect(r).toHaveLength(1)
    expect(r[0].app.id).toBe('tideline')
    expect(r[0].access).toBe('owner')
  })
  it('drops an app whose checks both fail', async () => {
    mockListGrants.mockResolvedValue([{ project: 'tideline', role: 'owner' }])
    allow()
    expect(await accessibleApps(user)).toEqual([])
  })
  it('throws GarmLoopError when the grants list throws', async () => {
    mockListGrants.mockRejectedValue(new GarmLoopError('down', null))
    await expect(accessibleApps(user)).rejects.toBeInstanceOf(GarmLoopError)
  })
  it('throws GarmLoopError when a check errors', async () => {
    mockListGrants.mockResolvedValue([{ project: 'tideline', role: 'owner' }])
    mockLoopCheck.mockResolvedValue('error')
    await expect(accessibleApps(user)).rejects.toBeInstanceOf(GarmLoopError)
  })
})

describe('hasAnyAppAccess', () => {
  beforeEach(() => {
    store.set('tideline', { name: 'Tideline' })
  })
  it('is false when bypassed', async () => {
    mockBypassed.mockReturnValue(true)
    expect(await hasAnyAppAccess('u@x.com')).toBe(false)
  })
  it('is false when listing throws', async () => {
    mockListGrants.mockRejectedValue(new Error('down'))
    expect(await hasAnyAppAccess('u@x.com')).toBe(false)
  })
  it('is false (never throws) when a check errors', async () => {
    mockListGrants.mockResolvedValue([{ project: 'tideline', role: 'collaborator' }])
    mockLoopCheck.mockResolvedValue('error')
    expect(await hasAnyAppAccess('u@x.com')).toBe(false)
  })
  it('is true for a collaborator grant on an app with a row whose check passes', async () => {
    mockListGrants.mockResolvedValue([{ project: 'tideline', role: 'collaborator' }])
    allow('tideline:collaborator')
    expect(await hasAnyAppAccess('u@x.com')).toBe(true)
  })
  it('is false when the only grant has no app row', async () => {
    mockListGrants.mockResolvedValue([{ project: 'rock-art', role: 'owner' }])
    allow('rock-art:collaborator')
    expect(await hasAnyAppAccess('u@x.com')).toBe(false)
  })
})
