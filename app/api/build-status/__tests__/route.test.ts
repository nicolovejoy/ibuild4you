import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// after() throws outside a Next request scope; run its callback inline and
// record that it was used, so the last_used_at touch is observable.
const mockAfter = vi.fn((cb: () => unknown) => {
  cb()
})
vi.mock('next/server', async (importOriginal) => {
  const actual = await importOriginal<typeof import('next/server')>()
  return { ...actual, after: (cb: () => unknown) => mockAfter(cb) }
})

// The key store's own touch is covered by its own tests; here we only care
// that the route schedules it with the canonical repo.
const mockTouch = vi.fn<(db: unknown, repo: string, lastUsedAt: string | null) => Promise<void>>(
  async () => undefined
)
vi.mock('@/lib/build-status/keys', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/build-status/keys')>()
  return { ...actual, touchStatusKey: (db: unknown, repo: string, lastUsedAt: string | null) =>
      mockTouch(db, repo, lastUsedAt) }
})

const mockAddReport = vi.fn()
vi.mock('@/lib/build-status/reports', () => ({
  addReport: (...args: unknown[]) => mockAddReport(...args),
}))

import { POST } from '../route'
import { hashReadKey } from '@/lib/feedback/read-crypto'
import { repoKeyId } from '@/lib/build-status/keys'

// =============================================================================
// Tests for POST /api/build-status: a build repo posts a status report with a
// per-repo key. Firebase Admin is mocked: build_status_keys is a doc store
// keyed by repoKeyId, projects is a list searched by slug.
// =============================================================================

const L6_KEY = 'bsk_AAAAAAAAAAAAAAAAAAAAAA'
const BYSIDE_KEY = 'bsk_BBBBBBBBBBBBBBBBBBBBBB'

let keyStore: Record<string, Record<string, unknown>> = {}
let projectStore: Array<{ id: string; slug: string; github_repo?: string }> = []

vi.mock('@/lib/firebase/admin', () => ({
  getAdminDb: vi.fn(() => ({
    collection: vi.fn((name: string) => {
      if (name === 'build_status_keys') {
        return {
          doc: (id: string) => ({
            get: async () => ({ exists: id in keyStore, id, data: () => keyStore[id] }),
          }),
        }
      }
      // projects: where('slug', '==', x).limit(1).get()
      return {
        where: (_field: string, _op: string, slug: string) => ({
          limit: () => ({
            get: async () => {
              const docs = projectStore
                .filter((p) => p.slug === slug)
                .map(({ id, ...data }) => ({ id, data: () => data }))
              return { empty: docs.length === 0, docs }
            },
          }),
        }),
      }
    }),
  })),
}))

function req(body: unknown, auth?: string): Request {
  const headers: Record<string, string> = { 'content-type': 'application/json' }
  if (auth !== undefined) headers.authorization = auth
  return new Request('https://ibuild4you.com/api/build-status', {
    method: 'POST',
    headers,
    body: typeof body === 'string' ? body : JSON.stringify(body),
  })
}

const goodBody = {
  repo: 'nicolovejoy/l6-music',
  project: 'l6-music',
  brief_version_checked: 55,
  live: [{ what: 'Lesson export is live', checked: 'Ran an export on production' }],
  merged: ['Payment page copy'],
}

const goodReport = {
  live: [{ what: 'Lesson export is live', checked: 'Ran an export on production' }],
  merged: ['Payment page copy'],
  proposed: [],
  questions: [],
}

const L6_AUTH = `Bearer ${L6_KEY}`
const UNAUTHORIZED = JSON.stringify({ error: 'Unauthorized' })
const FORBIDDEN = JSON.stringify({ error: 'This key cannot post to that project.' })

let logSpy: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  mockAfter.mockClear()
  mockTouch.mockClear()
  mockAddReport.mockReset()
  mockAddReport.mockResolvedValue({ posted_at: '2026-11-15T20:00:00.000Z', duplicate: false })
  keyStore = {
    [repoKeyId('nicolovejoy/l6-music')]: {
      repo: 'nicolovejoy/l6-music',
      key_hash: hashReadKey(L6_KEY),
      created_at: '2026-11-15T00:00:00.000Z',
      created_by: 'admin-1',
    },
    [repoKeyId('nicolovejoy/byside')]: {
      repo: 'nicolovejoy/byside',
      key_hash: hashReadKey(BYSIDE_KEY),
      created_at: '2026-11-15T00:00:00.000Z',
      created_by: 'admin-1',
      last_used_at: '2026-11-15T01:00:00.000Z',
    },
  }
  projectStore = [
    { id: 'p-l6', slug: 'l6-music', github_repo: 'nicolovejoy/l6-music' },
    { id: 'p-prntd', slug: 'prntd', github_repo: 'nicolovejoy/prntd' },
    { id: 'p-byside', slug: 'byside', github_repo: 'byside' },
  ]
  logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
})

afterEach(() => {
  logSpy.mockRestore()
})

describe('POST /api/build-status: auth', () => {
  it('no Authorization header → 401', async () => {
    const res = await POST(req(goodBody))
    expect(res.status).toBe(401)
    expect(await res.text()).toBe(UNAUTHORIZED)
    expect(res.headers.get('cache-control')).toBe('no-store')
  })

  it('wrong key → 401', async () => {
    const res = await POST(req(goodBody, 'Bearer bsk_wrongwrongwrongwrongww'))
    expect(res.status).toBe(401)
    expect(await res.text()).toBe(UNAUTHORIZED)
  })

  it('right key but body.repo has no key doc → 401', async () => {
    const res = await POST(req({ ...goodBody, repo: 'nicolovejoy/prntd' }, L6_AUTH))
    expect(res.status).toBe(401)
    expect(await res.text()).toBe(UNAUTHORIZED)
  })

  it('a key for another repo → 401', async () => {
    const res = await POST(req(goodBody, `Bearer ${BYSIDE_KEY}`))
    expect(res.status).toBe(401)
  })

  it('a bare repo name → 401', async () => {
    const res = await POST(req({ ...goodBody, repo: 'byside' }, `Bearer ${BYSIDE_KEY}`))
    expect(res.status).toBe(401)
    expect(await res.text()).toBe(UNAUTHORIZED)
  })

  it('a missing or non-string repo → 401', async () => {
    const noRepo: Record<string, unknown> = { ...goodBody }
    delete noRepo.repo
    expect((await POST(req(noRepo, L6_AUTH))).status).toBe(401)
    expect((await POST(req({ ...goodBody, repo: 42 }, L6_AUTH))).status).toBe(401)
  })

  it('does not touch last_used_at or store anything on a failed auth', async () => {
    await POST(req(goodBody, `Bearer ${BYSIDE_KEY}`))
    expect(mockAfter).not.toHaveBeenCalled()
    expect(mockTouch).not.toHaveBeenCalled()
    expect(mockAddReport).not.toHaveBeenCalled()
  })
})

describe('POST /api/build-status: body', () => {
  it('a body that is not JSON → 400', async () => {
    const res = await POST(req('nope', L6_AUTH))
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'Body must be a JSON object.' })
  })

  it('a body that is an array → 400', async () => {
    const res = await POST(req([], L6_AUTH))
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'Body must be a JSON object.' })
  })

  it('checks the body shape before the key', async () => {
    const res = await POST(req('nope'))
    expect(res.status).toBe(400)
  })
})

describe('POST /api/build-status: project', () => {
  it('a project whose repo differs from the key → 403', async () => {
    const res = await POST(req({ ...goodBody, project: 'prntd' }, L6_AUTH))
    expect(res.status).toBe(403)
    expect(await res.text()).toBe(FORBIDDEN)
    expect(res.headers.get('cache-control')).toBe('no-store')
    expect(mockAddReport).not.toHaveBeenCalled()
  })

  it('an unknown slug → 403 with the same body as a mismatch', async () => {
    const res = await POST(req({ ...goodBody, project: 'no-such-brief' }, L6_AUTH))
    expect(res.status).toBe(403)
    expect(await res.text()).toBe(FORBIDDEN)
  })

  it('a missing or non-string project → 403', async () => {
    const noProject: Record<string, unknown> = { ...goodBody }
    delete noProject.project
    expect((await POST(req(noProject, L6_AUTH))).status).toBe(403)
    expect((await POST(req({ ...goodBody, project: '' }, L6_AUTH))).status).toBe(403)
    expect((await POST(req({ ...goodBody, project: 7 }, L6_AUTH))).status).toBe(403)
  })

  it('a project that stores a bare repo name still matches its full-name key', async () => {
    const res = await POST(
      req({ ...goodBody, repo: 'nicolovejoy/byside', project: 'byside' }, `Bearer ${BYSIDE_KEY}`)
    )
    expect(res.status).toBe(201)
  })
})

describe('POST /api/build-status: report', () => {
  it.each([
    ['missing', undefined],
    ['fractional', 1.5],
    ['a string', '55'],
    ['negative', -1],
  ])('brief_version_checked %s → 400', async (_label, value) => {
    const body: Record<string, unknown> = { ...goodBody }
    if (value === undefined) delete body.brief_version_checked
    else body.brief_version_checked = value
    const res = await POST(req(body, L6_AUTH))
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'brief_version_checked must be a whole number.' })
  })

  it('accepts brief_version_checked 0', async () => {
    const res = await POST(req({ ...goodBody, brief_version_checked: 0 }, L6_AUTH))
    expect(res.status).toBe(201)
  })

  it('a live item without checked → 400 with the validator message', async () => {
    const res = await POST(
      req({ ...goodBody, live: [{ what: 'Lesson export is live' }], merged: [] }, L6_AUTH)
    )
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({
      error:
        'live[0] has no "checked". Say what was checked in production, or move it to "merged".',
    })
    expect(mockAddReport).not.toHaveBeenCalled()
  })

  it('an empty report → 400', async () => {
    const res = await POST(req({ ...goodBody, live: [], merged: [] }, L6_AUTH))
    expect(res.status).toBe(400)
  })
})

describe('POST /api/build-status: success', () => {
  it('stores a good report and answers 201', async () => {
    const res = await POST(req(goodBody, L6_AUTH))
    expect(res.status).toBe(201)
    expect(res.headers.get('cache-control')).toBe('no-store')
    expect(await res.json()).toEqual({ ok: true, posted_at: '2026-11-15T20:00:00.000Z' })
    expect(mockAddReport).toHaveBeenCalledTimes(1)
    expect(mockAddReport.mock.calls[0][1]).toBe('p-l6')
    expect(mockAddReport.mock.calls[0][2]).toEqual({
      repo: 'nicolovejoy/l6-music',
      brief_version_checked: 55,
      report: goodReport,
    })
  })

  it('canonicalizes the repo before storing it', async () => {
    await POST(req({ ...goodBody, repo: 'https://github.com/NicoLovejoy/L6-Music/' }, L6_AUTH))
    expect(mockAddReport.mock.calls[0][2].repo).toBe('nicolovejoy/l6-music')
  })

  it('schedules the key touch through after() with the canonical repo', async () => {
    await POST(req(goodBody, L6_AUTH))
    expect(mockAfter).toHaveBeenCalledTimes(1)
    expect(mockTouch).toHaveBeenCalledTimes(1)
    expect(mockTouch.mock.calls[0][1]).toBe('nicolovejoy/l6-music')
    expect(mockTouch.mock.calls[0][2]).toBeNull()
  })

  it('passes the key last_used_at to the touch', async () => {
    await POST(
      req({ ...goodBody, repo: 'nicolovejoy/byside', project: 'byside' }, `Bearer ${BYSIDE_KEY}`)
    )
    expect(mockTouch.mock.calls[0][2]).toBe('2026-11-15T01:00:00.000Z')
  })

  it('a duplicate answers 200 with duplicate: true', async () => {
    mockAddReport.mockResolvedValue({ posted_at: '2026-11-15T19:55:00.000Z', duplicate: true })
    const res = await POST(req(goodBody, L6_AUTH))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({
      ok: true,
      posted_at: '2026-11-15T19:55:00.000Z',
      duplicate: true,
    })
  })

  it('logs one build_status_posted line with no key material', async () => {
    await POST(req(goodBody, L6_AUTH))
    expect(logSpy).toHaveBeenCalledTimes(1)
    expect(JSON.parse(logSpy.mock.calls[0][0] as string)).toEqual({
      event: 'build_status_posted',
      repo: 'nicolovejoy/l6-music',
      project: 'l6-music',
      duplicate: false,
    })
    const logged = JSON.stringify(logSpy.mock.calls)
    expect(logged).not.toContain(L6_KEY)
    expect(logged).not.toContain('key_hash')
  })

  it('no response body contains the key or key_hash', async () => {
    const responses = [
      await POST(req(goodBody, L6_AUTH)),
      await POST(req(goodBody, 'Bearer bsk_wrongwrongwrongwrongww')),
      await POST(req({ ...goodBody, project: 'prntd' }, L6_AUTH)),
      await POST(req({ ...goodBody, brief_version_checked: 'x' }, L6_AUTH)),
    ]
    for (const res of responses) {
      const text = await res.text()
      expect(text).not.toContain(L6_KEY)
      expect(text).not.toContain('key_hash')
    }
  })
})
