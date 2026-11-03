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
import { GET } from '../route'
import { _resetRateLimit } from '@/lib/api/rate-limit'
import { hashReadKey, senderTag } from '@/lib/feedback/read-crypto'

// =============================================================================
// Tests for GET /api/feedback/read — the host-facing Loop read endpoint.
//
// Firebase Admin is mocked: loop_read_keys and apps are doc stores keyed by
// slug, and
// feedback is an in-memory array behind a query fake that honours
// where/orderBy/startAfter/limit (created_at desc).
// =============================================================================

const SECRET = 'test-sender-secret'
const BYSIDE_KEY = 'lrk_AAAAAAAAAAAAAAAAAAAAAA'
const PRNTD_KEY = 'lrk_BBBBBBBBBBBBBBBBBBBBBB'

let keyStore: Record<string, Record<string, unknown>> = {}
let appStore: Record<string, Record<string, unknown>> = {}
let feedbackRows: Array<Record<string, unknown> & { id: string }> = []
const mockKeyUpdate = vi.fn(async () => undefined)

interface QueryState {
  filters: Array<[string, unknown]>
  after: string | null
  max: number
}

function feedbackQuery(state: QueryState) {
  return {
    where: (field: string, _op: string, value: unknown) =>
      feedbackQuery({ ...state, filters: [...state.filters, [field, value]] }),
    orderBy: () => feedbackQuery(state),
    startAfter: (value: string) => feedbackQuery({ ...state, after: value }),
    limit: (n: number) => feedbackQuery({ ...state, max: n }),
    get: async () => {
      const rows = feedbackRows
        .filter((r) => state.filters.every(([f, v]) => r[f] === v))
        .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))
        .filter((r) => state.after === null || String(r.created_at) < state.after)
        .slice(0, state.max)
      return {
        docs: rows.map((r) => {
          const { id, ...data } = r
          return { id, data: () => data }
        }),
      }
    },
  }
}

vi.mock('@/lib/firebase/admin', () => ({
  getAdminDb: vi.fn(() => ({
    collection: vi.fn((name: string) => {
      if (name === 'loop_read_keys') {
        return {
          doc: (id: string) => ({
            get: async () => ({ exists: id in keyStore, id, data: () => keyStore[id] }),
            update: mockKeyUpdate,
          }),
        }
      }
      if (name === 'apps') {
        return {
          doc: (id: string) => ({
            get: async () => ({ exists: id in appStore, id, data: () => appStore[id] }),
          }),
        }
      }
      // feedback
      return feedbackQuery({ filters: [], after: null, max: Infinity })
    }),
  })),
}))

const BASE = 'https://ibuild4you.com'

function req(params: Record<string, string>, auth?: string): Request {
  const url = new URL(`${BASE}/api/feedback/read`)
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v)
  const headers: Record<string, string> = {}
  if (auth !== undefined) headers.authorization = auth
  return new Request(url, { headers })
}

// created_at strictly decreasing with i: row 0 is the newest.
function iso(minutesAgo: number): string {
  return new Date(Date.UTC(2026, 9, 31, 12, 0, 0) - minutesAgo * 60_000).toISOString()
}

function row(i: number, extra: Record<string, unknown> = {}) {
  return {
    id: `fb-${i}`,
    project_id: 'byside',
    type: 'bug',
    body: `Row ${i} first line\nsecond line`,
    submitter_email: `person${i}@example.com`,
    submitter_uid: null,
    page_url: 'https://byside.example/secret-page',
    user_agent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)',
    viewport: '390x844',
    status: 'new',
    internal_notes: 'internal only',
    github_issue_url: null,
    created_at: iso(i),
    updated_at: iso(i),
    ...extra,
  }
}

let logSpy: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  process.env.LOOP_SENDER_TAG_SECRET = SECRET
  delete process.env.NEXT_PUBLIC_APP_URL
  _resetRateLimit()
  mockKeyUpdate.mockClear()
  mockAfter.mockClear()
  keyStore = {
    byside: { key_hash: hashReadKey(BYSIDE_KEY), created_at: iso(1000), created_by: 'admin-1' },
    prntd: { key_hash: hashReadKey(PRNTD_KEY), created_at: iso(1000), created_by: 'admin-1' },
  }
  appStore = { byside: { name: 'Byside' }, prntd: { name: 'Prntd' } }
  feedbackRows = []
  logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
})

afterEach(() => {
  logSpy.mockRestore()
})

describe('GET /api/feedback/read — configuration', () => {
  it('503s when LOOP_SENDER_TAG_SECRET is unset, before anything else', async () => {
    delete process.env.LOOP_SENDER_TAG_SECRET
    const res = await GET(req({ app: 'byside' }, `Bearer ${BYSIDE_KEY}`))
    expect(res.status).toBe(503)
    expect(await res.json()).toEqual({ error: 'not_configured' })
    expect(res.headers.get('cache-control')).toBe('no-store')
  })
})

describe('GET /api/feedback/read — auth failures all look the same', () => {
  const cases: Array<[string, Record<string, string>, string | undefined]> = [
    ['no header', { app: 'byside' }, undefined],
    ['Basic scheme', { app: 'byside' }, 'Basic x'],
    ['empty bearer', { app: 'byside' }, 'Bearer   '],
    ['wrong key', { app: 'byside' }, 'Bearer lrk_wrongwrongwrongwrongwr'],
    ['key for another app', { app: 'byside' }, `Bearer ${PRNTD_KEY}`],
    ['invalid slug', { app: 'Bad_Slug' }, `Bearer ${BYSIDE_KEY}`],
    ['app missing', {}, `Bearer ${BYSIDE_KEY}`],
    ['app with no key doc', { app: 'l6-music' }, `Bearer ${BYSIDE_KEY}`],
  ]

  it('a valid key whose app doc is gone → the same 404', async () => {
    delete appStore.byside
    const res = await GET(req({ app: 'byside' }, `Bearer ${BYSIDE_KEY}`))
    expect(res.status).toBe(404)
    expect(await res.text()).toBe(JSON.stringify({ error: 'Not found' }))
  })

  it.each(cases)('%s → 404 Not found', async (_label, params, auth) => {
    const res = await GET(req(params, auth))
    expect(res.status).toBe(404)
    expect(await res.text()).toBe(JSON.stringify({ error: 'Not found' }))
    expect(res.headers.get('cache-control')).toBe('no-store')
  })

  it('accepts a lowercase bearer scheme', async () => {
    const res = await GET(req({ app: 'byside' }, `bearer ${BYSIDE_KEY}`))
    expect(res.status).toBe(200)
  })
})

describe('GET /api/feedback/read — happy path', () => {
  it('returns newest first with exactly the public fields and no private data', async () => {
    feedbackRows = [row(2), row(0, { submitter_email: null }), row(1), row(3, { project_id: 'prntd' })]
    const res = await GET(req({ app: 'byside' }, `Bearer ${BYSIDE_KEY}`))
    expect(res.status).toBe(200)
    expect(res.headers.get('cache-control')).toBe('no-store')
    expect(res.headers.get('access-control-allow-origin')).toBeNull()

    const body = await res.json()
    expect(body.next_cursor).toBeNull()
    expect(body.items.map((i: { id: string }) => i.id)).toEqual(['fb-0', 'fb-1', 'fb-2'])
    for (const item of body.items) {
      expect(Object.keys(item).sort()).toEqual(
        ['created_at', 'id', 'loop_url', 'platform', 'sender', 'status', 'summary', 'type'].sort()
      )
    }
    expect(body.items[0]).toEqual({
      id: 'fb-0',
      type: 'bug',
      summary: 'Row 0 first line',
      platform: 'ios',
      created_at: iso(0),
      status: 'new',
      loop_url: 'https://ibuild4you.com/admin/apps/byside?id=fb-0',
      sender: 'anonymous',
    })
    expect(body.items[1].sender).toBe(senderTag(SECRET, 'byside', 'person1@example.com'))

    const text = JSON.stringify(body)
    expect(text).not.toContain('@')
    for (const banned of ['submitter_email', 'user_agent', 'page_url', 'internal_notes', 'internal only', '"body"', 'second line']) {
      expect(text).not.toContain(banned)
    }
  })

  it('builds loop_url from NEXT_PUBLIC_APP_URL when set', async () => {
    process.env.NEXT_PUBLIC_APP_URL = 'https://preview.ibuild4you.com'
    feedbackRows = [row(0)]
    const body = await (await GET(req({ app: 'byside' }, `Bearer ${BYSIDE_KEY}`))).json()
    expect(body.items[0].loop_url).toBe('https://preview.ibuild4you.com/admin/apps/byside?id=fb-0')
  })

  it('logs one loop_read line with no key or email', async () => {
    feedbackRows = [row(0), row(1), row(2)]
    await GET(req({ app: 'byside' }, `Bearer ${BYSIDE_KEY}`))
    expect(logSpy).toHaveBeenCalledTimes(1)
    expect(JSON.parse(logSpy.mock.calls[0][0] as string)).toEqual({
      event: 'loop_read',
      slug: 'byside',
      count: 3,
    })
    const allArgs = JSON.stringify(logSpy.mock.calls)
    expect(allArgs).not.toContain(BYSIDE_KEY)
    expect(allArgs).not.toContain('@')
  })

  it('records last_used_at via after() on a successful read', async () => {
    await GET(req({ app: 'byside' }, `Bearer ${BYSIDE_KEY}`))
    expect(mockAfter).toHaveBeenCalledTimes(1)
    expect(mockKeyUpdate).toHaveBeenCalledTimes(1)
  })

  it('does not touch last_used_at on a failed read', async () => {
    await GET(req({ app: 'byside' }, `Bearer ${PRNTD_KEY}`))
    expect(mockAfter).not.toHaveBeenCalled()
    expect(mockKeyUpdate).not.toHaveBeenCalled()
  })

  it('redacts an email typed on the first line of the body', async () => {
    feedbackRows = [row(0, { submitter_email: null, body: 'Reach me at sam@example.com please\nmore' })]
    const res = await GET(req({ app: 'byside' }, `Bearer ${BYSIDE_KEY}`))
    const text = await res.text()
    expect(JSON.parse(text).items[0].summary).toBe('Reach me at [email] please')
    expect(text).toContain('[email]')
    expect(text).not.toContain('@')
  })

  it('returns an empty summary for a malformed non-string body', async () => {
    feedbackRows = [row(0, { body: { oops: true } }), row(1, { body: 12345 })]
    const res = await GET(req({ app: 'byside' }, `Bearer ${BYSIDE_KEY}`))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.items.map((i: { summary: string }) => i.summary)).toEqual(['', ''])
  })
})

describe('GET /api/feedback/read — spam and paging', () => {
  it('excludes spam rows', async () => {
    feedbackRows = [row(0, { status: 'spam' }), row(1), row(2, { status: 'spam' })]
    const body = await (await GET(req({ app: 'byside' }, `Bearer ${BYSIDE_KEY}`))).json()
    expect(body.items.map((i: { id: string }) => i.id)).toEqual(['fb-1'])
  })

  it('excludes archived rows and pages like spam', async () => {
    feedbackRows = [
      row(0, { archived_at: '2026-11-01T00:00:00Z' }),
      row(1),
      row(2, { archived_at: '2026-11-01T00:00:00Z' }),
      row(3),
      row(4),
    ]
    const auth = `Bearer ${BYSIDE_KEY}`
    const p1 = await (await GET(req({ app: 'byside', limit: '2' }, auth))).json()
    expect(p1.items.map((i: { id: string }) => i.id)).toEqual(['fb-1', 'fb-3'])
    expect(typeof p1.next_cursor).toBe('string')
    const p2 = await (await GET(req({ app: 'byside', limit: '2', before: p1.next_cursor }, auth))).json()
    expect(p2.items.map((i: { id: string }) => i.id)).toEqual(['fb-4'])
    expect(p2.next_cursor).toBeNull()
  })

  it('scans past a full batch of spam to find real rows', async () => {
    feedbackRows = [
      ...Array.from({ length: 120 }, (_, i) => row(i, { status: 'spam' })),
      row(120),
      row(121),
      row(122),
    ]
    const body = await (await GET(req({ app: 'byside' }, `Bearer ${BYSIDE_KEY}`))).json()
    expect(body.items.map((i: { id: string }) => i.id)).toEqual(['fb-120', 'fb-121', 'fb-122'])
    expect(body.next_cursor).toBeNull()
  })

  it('returns a cursor when the scan stops on the batch cap', async () => {
    feedbackRows = [...Array.from({ length: 600 }, (_, i) => row(i, { status: 'spam' })), row(600)]
    const first = await (await GET(req({ app: 'byside' }, `Bearer ${BYSIDE_KEY}`))).json()
    expect(first.items).toEqual([])
    expect(typeof first.next_cursor).toBe('string')
    const second = await (
      await GET(req({ app: 'byside', before: first.next_cursor }, `Bearer ${BYSIDE_KEY}`))
    ).json()
    expect(second.items.map((i: { id: string }) => i.id)).toEqual(['fb-600'])
    expect(second.next_cursor).toBeNull()
  })

  it('pages 25 rows as 10, 10, 5 with no duplicates', async () => {
    feedbackRows = Array.from({ length: 25 }, (_, i) => row(i))
    const auth = `Bearer ${BYSIDE_KEY}`
    const p1 = await (await GET(req({ app: 'byside', limit: '10' }, auth))).json()
    expect(p1.items).toHaveLength(10)
    expect(typeof p1.next_cursor).toBe('string')
    const p2 = await (await GET(req({ app: 'byside', limit: '10', before: p1.next_cursor }, auth))).json()
    expect(p2.items).toHaveLength(10)
    expect(typeof p2.next_cursor).toBe('string')
    const p3 = await (await GET(req({ app: 'byside', limit: '10', before: p2.next_cursor }, auth))).json()
    expect(p3.items).toHaveLength(5)
    expect(p3.next_cursor).toBeNull()

    const ids = [...p1.items, ...p2.items, ...p3.items].map((i: { id: string }) => i.id)
    expect(new Set(ids).size).toBe(25)
    expect(ids[0]).toBe('fb-0')
    expect(ids[24]).toBe('fb-24')
  })
})

describe('GET /api/feedback/read — cursor and rate limit', () => {
  it('400s on a garbled cursor with a valid key', async () => {
    const res = await GET(req({ app: 'byside', before: 'garbage' }, `Bearer ${BYSIDE_KEY}`))
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'Invalid cursor' })
  })

  it('404s on a garbled cursor with a wrong key', async () => {
    const res = await GET(req({ app: 'byside', before: 'garbage' }, `Bearer ${PRNTD_KEY}`))
    expect(res.status).toBe(404)
    expect(await res.json()).toEqual({ error: 'Not found' })
  })

  it('429s the 61st read in a minute with a numeric Retry-After', async () => {
    const auth = `Bearer ${BYSIDE_KEY}`
    for (let i = 0; i < 60; i++) {
      expect((await GET(req({ app: 'byside' }, auth))).status).toBe(200)
    }
    const res = await GET(req({ app: 'byside' }, auth))
    expect(res.status).toBe(429)
    expect(await res.json()).toEqual({ error: 'Too many requests' })
    expect(Number(res.headers.get('retry-after'))).toBeGreaterThan(0)
    expect(res.headers.get('cache-control')).toBe('no-store')
  })

  it('bad-key requests do not consume the app limit', async () => {
    for (let i = 0; i < 60; i++) {
      expect((await GET(req({ app: 'byside' }, `Bearer ${PRNTD_KEY}`))).status).toBe(404)
    }
    for (let i = 0; i < 60; i++) {
      expect((await GET(req({ app: 'byside' }, `Bearer ${BYSIDE_KEY}`))).status).toBe(200)
    }
  })
})

describe('GET /api/feedback/read — legacy slugs', () => {
  const auth = `Bearer ${BYSIDE_KEY}`
  const ids = (body: { items: Array<{ id: string }> }) => body.items.map((i) => i.id)

  beforeEach(() => {
    appStore.byside = { name: 'Byside', legacy_slugs: ['byside-v1', 'byside'] }
  })

  it('includes rows under a legacy slug, newest first, no duplicates', async () => {
    feedbackRows = [
      row(0),
      row(1, { project_id: 'byside-v1' }),
      row(2),
      row(3, { project_id: 'byside-v1' }),
      row(4, { project_id: 'prntd' }),
    ]
    const res = await GET(req({ app: 'byside' }, auth))
    const body = await res.json()
    expect(ids(body)).toEqual(['fb-0', 'fb-1', 'fb-2', 'fb-3'])
    expect(body.next_cursor).toBeNull()
    // Items keep the canonical slug in loop_url and the sender tag.
    expect(body.items[1].loop_url).toBe('https://ibuild4you.com/admin/apps/byside?id=fb-1')
    expect(body.items[1].sender).toBe(senderTag(SECRET, 'byside', 'person1@example.com'))
  })

  it('pages across the merged stream with no gaps or duplicates', async () => {
    // Interleave: even rows canonical, odd rows legacy.
    feedbackRows = Array.from({ length: 25 }, (_, i) =>
      row(i, i % 2 ? { project_id: 'byside-v1' } : {})
    )
    const seen: string[] = []
    let before: string | null = null
    for (let page = 0; page < 10; page++) {
      const params: Record<string, string> = { app: 'byside', limit: '10' }
      if (before) params.before = before
      const body = await (await GET(req(params, auth))).json()
      seen.push(...ids(body))
      before = body.next_cursor
      if (!before) break
    }
    expect(seen).toEqual(Array.from({ length: 25 }, (_, i) => `fb-${i}`))
  })

  it('does not skip legacy rows when only the legacy scan hits the batch cap', async () => {
    // Legacy id: 600 newest rows are spam, then one real row. Canonical id has
    // older real rows that would otherwise fill the page past the legacy gap.
    feedbackRows = [
      ...Array.from({ length: 600 }, (_, i) => row(i, { project_id: 'byside-v1', status: 'spam' })),
      row(600, { project_id: 'byside-v1' }),
      ...Array.from({ length: 5 }, (_, i) => row(700 + i)),
    ]
    const seen: string[] = []
    let before: string | null = null
    for (let page = 0; page < 10; page++) {
      const params: Record<string, string> = { app: 'byside', limit: '3' }
      if (before) params.before = before
      const body = await (await GET(req(params, auth))).json()
      seen.push(...ids(body))
      before = body.next_cursor
      if (!before) break
    }
    expect(seen).toEqual(['fb-600', 'fb-700', 'fb-701', 'fb-702', 'fb-703', 'fb-704'])
  })
})
