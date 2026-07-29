import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { computeGrantDecision, syncGarmGrantForEmail } from '../garm-grants'

// =============================================================================
// Garm dual-write. computeGrantDecision is pure (role-collapse + upsert/revoke
// decision); syncGarmGrantForEmail is the impure wrapper — Firestore mocked,
// fetch mocked, no network.
// =============================================================================

describe('computeGrantDecision', () => {
  it('admin always resolves to owner regardless of membership', () => {
    expect(
      computeGrantDecision({ isAdmin: true, members: [{ role: 'maker' }], isApproved: false })
    ).toEqual({ action: 'upsert', role: 'owner' })
  })

  it('upserts viewer for a single active maker membership', () => {
    expect(
      computeGrantDecision({ isAdmin: false, members: [{ role: 'maker' }], isApproved: true })
    ).toEqual({ action: 'upsert', role: 'viewer' })
  })

  it('collapses to the highest active role across multiple briefs', () => {
    expect(
      computeGrantDecision({
        isAdmin: false,
        members: [{ role: 'maker' }, { role: 'builder' }, { role: 'apprentice' }],
        isApproved: true,
      })
    ).toEqual({ action: 'upsert', role: 'collaborator' })
  })

  it('owner brief role upserts owner', () => {
    expect(
      computeGrantDecision({ isAdmin: false, members: [{ role: 'owner' }], isApproved: true })
    ).toEqual({ action: 'upsert', role: 'owner' })
  })

  it('ignores removed rows when collapsing role (role upgrade recompute case)', () => {
    // Was builder, demoted-out of that brief (removed_at set) but still an
    // active maker elsewhere — should recompute down to viewer, not stay collaborator.
    expect(
      computeGrantDecision({
        isAdmin: false,
        members: [{ role: 'builder', removed_at: '2026-01-01' }, { role: 'maker' }],
        isApproved: true,
      })
    ).toEqual({ action: 'upsert', role: 'viewer' })
  })

  it('revokes when the last active membership is removed and email is not separately approved', () => {
    expect(
      computeGrantDecision({
        isAdmin: false,
        members: [{ role: 'maker', removed_at: '2026-01-01' }],
        isApproved: false,
      })
    ).toEqual({ action: 'revoke' })
  })

  it('falls back to viewer if no active membership but still approved standalone', () => {
    expect(
      computeGrantDecision({
        isAdmin: false,
        members: [{ role: 'maker', removed_at: '2026-01-01' }],
        isApproved: true,
      })
    ).toEqual({ action: 'upsert', role: 'viewer' })
  })

  it('revokes for an email with no membership rows and no approval at all', () => {
    expect(
      computeGrantDecision({ isAdmin: false, members: [], isApproved: false })
    ).toEqual({ action: 'revoke' })
  })
})

// -----------------------------------------------------------------------------
// syncGarmGrantForEmail — Firestore + fetch mocked.
// -----------------------------------------------------------------------------

vi.mock('@/lib/api/firebase-server-helpers', () => ({
  getAdminDb: vi.fn(),
}))

const OLD_ENV = { ...process.env }

beforeEach(() => {
  process.env.GARM_DUAL_WRITE = 'on'
  process.env.GARM_URL = 'https://garm.example.test'
  process.env.GARM_ADMIN_KEY = 'garm_admin_testkey'
  vi.restoreAllMocks()
})

afterEach(() => {
  process.env = { ...OLD_ENV }
  vi.resetModules()
})

function mockDb({
  members = [] as Array<{ role: string; removed_at?: string | null }>,
  approved = false,
  revokedAt = null as string | null,
}) {
  return {
    collection: vi.fn((name: string) => {
      if (name === 'project_members') {
        return {
          where: vi.fn().mockReturnThis(),
          get: vi.fn(async () => ({
            docs: members.map((m) => ({ data: () => m })),
          })),
        }
      }
      if (name === 'approved_emails') {
        return {
          doc: vi.fn(() => ({
            get: vi.fn(async () => ({
              exists: approved,
              data: () => (approved ? { revoked_at: revokedAt } : undefined),
            })),
          })),
        }
      }
      throw new Error(`unexpected collection ${name}`)
    }),
  }
}

describe('syncGarmGrantForEmail', () => {
  it('upserts a grant for a new member (POST /api/grants)', async () => {
    const { getAdminDb } = await import('@/lib/api/firebase-server-helpers')
    vi.mocked(getAdminDb).mockReturnValue(
      mockDb({ members: [{ role: 'maker' }], approved: true }) as never
    )
    const fetchMock = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({}) }))
    vi.stubGlobal('fetch', fetchMock)

    await syncGarmGrantForEmail('Sam@Example.com')

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, opts] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://garm.example.test/api/grants')
    expect(opts.method).toBe('POST')
    expect(JSON.parse(opts.body as string)).toEqual({
      email: 'sam@example.com',
      project: 'ibuild4you',
      role: 'viewer',
      actor: 'ibuild4you-dual-write',
    })
  })

  it('revokes the grant when the last membership is removed (DELETE /api/grants)', async () => {
    const { getAdminDb } = await import('@/lib/api/firebase-server-helpers')
    vi.mocked(getAdminDb).mockReturnValue(
      mockDb({ members: [{ role: 'maker', removed_at: '2026-01-01' }], approved: false }) as never
    )
    const fetchMock = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({}) }))
    vi.stubGlobal('fetch', fetchMock)

    await syncGarmGrantForEmail('sam@example.com')

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, opts] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://garm.example.test/api/grants')
    expect(opts.method).toBe('DELETE')
    expect(JSON.parse(opts.body as string)).toEqual({
      email: 'sam@example.com',
      project: 'ibuild4you',
      actor: 'ibuild4you-dual-write',
    })
  })

  it('does nothing when GARM_DUAL_WRITE is not exactly "on"', async () => {
    process.env.GARM_DUAL_WRITE = 'true'
    const { getAdminDb } = await import('@/lib/api/firebase-server-helpers')
    const dbSpy = vi.mocked(getAdminDb)
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    await syncGarmGrantForEmail('sam@example.com')

    expect(dbSpy).not.toHaveBeenCalled()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('does nothing when GARM_ADMIN_KEY is unset (no fetch, no throw)', async () => {
    delete process.env.GARM_ADMIN_KEY
    const { getAdminDb } = await import('@/lib/api/firebase-server-helpers')
    vi.mocked(getAdminDb).mockReturnValue(
      mockDb({ members: [{ role: 'maker' }], approved: true }) as never
    )
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    await expect(syncGarmGrantForEmail('sam@example.com')).resolves.toBeUndefined()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('logs but never throws when the Garm request fails', async () => {
    const { getAdminDb } = await import('@/lib/api/firebase-server-helpers')
    vi.mocked(getAdminDb).mockReturnValue(
      mockDb({ members: [{ role: 'maker' }], approved: true }) as never
    )
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: false, status: 500, json: async () => ({}) }))
    )
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    await expect(syncGarmGrantForEmail('sam@example.com')).resolves.toBeUndefined()
    expect(warnSpy).toHaveBeenCalled()
  })

  it('revokes the grant for a revoked approved_emails row with no active membership (#163)', async () => {
    const { getAdminDb } = await import('@/lib/api/firebase-server-helpers')
    vi.mocked(getAdminDb).mockReturnValue(
      mockDb({ members: [], approved: true, revokedAt: '2026-07-18T00:00:00.000Z' }) as never
    )
    const fetchMock = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({}) }))
    vi.stubGlobal('fetch', fetchMock)

    await syncGarmGrantForEmail('sam@example.com')

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [, opts] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(opts.method).toBe('DELETE')
  })

  it('logs but never throws when the Firestore read itself fails', async () => {
    const { getAdminDb } = await import('@/lib/api/firebase-server-helpers')
    vi.mocked(getAdminDb).mockImplementation(() => {
      throw new Error('firestore unavailable')
    })
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    await expect(syncGarmGrantForEmail('sam@example.com')).resolves.toBeUndefined()
    expect(warnSpy).toHaveBeenCalled()
  })
})
