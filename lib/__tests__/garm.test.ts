import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { garmCheck, garmProbe, resolveCanonicalEmail, _resetGarmCache } from '../garm'

// =============================================================================
// Garm authorization client (Garm 1/4). Fail-closed gate over the /gnipahellir
// check endpoint. Contract: POST {email, project, min_role} → {allowed, role}.
// Gate on `allowed` only; `role` is display-only.
//
// fetch is mocked — no network, no real Garm. Covers: allowed / denied /
// cache-hit within TTL / fetch-failure → closed / timeout signal + no-store /
// strict allowed / unknown-role coercion / email normalization / fail-open opt-in.
// =============================================================================

// Minimal view of the fetch options we assert on (typed so .mock.calls[n][1]
// isn't an empty tuple).
type FetchOpts = {
  method: string
  headers: Record<string, string>
  body: string
  cache: string
  signal: AbortSignal
}

function mockFetchOnce(body: unknown, { ok = true, status = 200 } = {}) {
  return vi.fn(async (_url: string, _opts: FetchOpts) => ({
    ok,
    status,
    json: async () => body,
  }))
}

// Grab the (url, opts) of a mock fetch call, asserting it happened.
function callArgs(f: ReturnType<typeof mockFetchOnce>, i = 0): [string, FetchOpts] {
  const call = f.mock.calls[i]
  if (!call) throw new Error(`fetch was not called (index ${i})`)
  return call
}

const OLD_ENV = { ...process.env }

beforeEach(() => {
  _resetGarmCache()
  process.env.GARM_URL = 'https://garm.example.test'
  process.env.GARM_KEY = 'garm_testkey'
  vi.restoreAllMocks()
})

afterEach(() => {
  process.env = { ...OLD_ENV }
})

describe('garmCheck — decisions', () => {
  it('returns allowed:true with the role when Garm grants', async () => {
    vi.stubGlobal('fetch', mockFetchOnce({ allowed: true, role: 'owner' }))
    const r = await garmCheck('sam@example.com', 'ibuild4you', 'collaborator')
    expect(r).toEqual({ allowed: true, role: 'owner' })
  })

  it('returns allowed:false when Garm denies', async () => {
    vi.stubGlobal('fetch', mockFetchOnce({ allowed: false, role: null }))
    const r = await garmCheck('nobody@example.com', 'ibuild4you')
    expect(r).toEqual({ allowed: false, role: null })
  })

  it('sends the right request shape (project, min_role default viewer)', async () => {
    const f = mockFetchOnce({ allowed: true, role: 'viewer' })
    vi.stubGlobal('fetch', f)
    await garmCheck('sam@example.com', 'ibuild4you')
    const [url, opts] = callArgs(f)
    expect(url).toBe('https://garm.example.test/gnipahellir')
    expect(opts.method).toBe('POST')
    expect(opts.headers.authorization).toBe('Bearer garm_testkey')
    expect(JSON.parse(opts.body)).toEqual({
      email: 'sam@example.com',
      project: 'ibuild4you',
      min_role: 'viewer',
    })
  })
})

describe('garmCheck — hardening', () => {
  it('passes an abort signal (timeout) and cache:no-store on the fetch', async () => {
    const f = mockFetchOnce({ allowed: true, role: 'viewer' })
    vi.stubGlobal('fetch', f)
    await garmCheck('sam@example.com', 'ibuild4you')
    const [, opts] = callArgs(f)
    expect(opts.signal).toBeInstanceOf(AbortSignal)
    expect(opts.cache).toBe('no-store')
  })

  it('fails closed when fetch rejects (e.g. network down / timeout)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('network down') }))
    const r = await garmCheck('sam@example.com', 'ibuild4you')
    expect(r).toEqual({ allowed: false, role: null })
  })

  it('fails closed on a non-2xx status', async () => {
    vi.stubGlobal('fetch', mockFetchOnce({ error: 'bad key' }, { ok: false, status: 401 }))
    const r = await garmCheck('sam@example.com', 'ibuild4you')
    expect(r).toEqual({ allowed: false, role: null })
  })

  it('opts.failOpen returns allowed:true on failure (low-stakes surfaces only)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('down') }))
    const r = await garmCheck('sam@example.com', 'ibuild4you', 'viewer', { failOpen: true })
    expect(r).toEqual({ allowed: true, role: null })
  })

  it('denies-by-default when allowed is not literally true (garbage response)', async () => {
    vi.stubGlobal('fetch', mockFetchOnce({ allowed: 'yes', role: 'owner' }))
    const r = await garmCheck('sam@example.com', 'ibuild4you')
    expect(r.allowed).toBe(false)
  })

  it('coerces an unknown role to null (keeps allowed as sent)', async () => {
    vi.stubGlobal('fetch', mockFetchOnce({ allowed: true, role: 'superadmin' }))
    const r = await garmCheck('sam@example.com', 'ibuild4you')
    expect(r).toEqual({ allowed: true, role: null })
  })

  it('fails closed (no fetch) when GARM_URL/GARM_KEY are unset', async () => {
    delete process.env.GARM_URL
    delete process.env.GARM_KEY
    const f = vi.fn()
    vi.stubGlobal('fetch', f)
    const r = await garmCheck('sam@example.com', 'ibuild4you')
    expect(r).toEqual({ allowed: false, role: null })
    expect(f).not.toHaveBeenCalled()
  })
})

describe('garmCheck — caching', () => {
  it('serves a cache hit within the TTL without a second fetch', async () => {
    const f = mockFetchOnce({ allowed: true, role: 'owner' })
    vi.stubGlobal('fetch', f)
    const a = await garmCheck('sam@example.com', 'ibuild4you', 'collaborator')
    const b = await garmCheck('sam@example.com', 'ibuild4you', 'collaborator')
    expect(a).toEqual(b)
    expect(f).toHaveBeenCalledOnce()
  })

  it('caches per (email, project, minRole) — a different min_role re-fetches', async () => {
    const f = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ allowed: true, role: 'owner' }) }))
    vi.stubGlobal('fetch', f)
    await garmCheck('sam@example.com', 'ibuild4you', 'viewer')
    await garmCheck('sam@example.com', 'ibuild4you', 'owner')
    expect(f).toHaveBeenCalledTimes(2)
  })

  it('does not cache a failure (a transient error must not stick)', async () => {
    const f = vi
      .fn()
      .mockRejectedValueOnce(new Error('blip'))
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ allowed: true, role: 'owner' }) })
    vi.stubGlobal('fetch', f)
    const first = await garmCheck('sam@example.com', 'ibuild4you')
    const second = await garmCheck('sam@example.com', 'ibuild4you')
    expect(first).toEqual({ allowed: false, role: null })
    expect(second).toEqual({ allowed: true, role: 'owner' })
    expect(f).toHaveBeenCalledTimes(2)
  })

  // Closes the one known gap flagged in CLAUDE.md's backlog: cache-hit within
  // TTL was covered, but nothing proved the cache actually re-fetches once the
  // 60s TTL has elapsed — a revocation must not linger past that window.
  it('re-fetches after the 60s TTL has elapsed (a revocation must not linger)', async () => {
    vi.useFakeTimers()
    try {
      const f = vi
        .fn()
        .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ allowed: true, role: 'owner' }) })
        .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ allowed: false, role: null }) })
      vi.stubGlobal('fetch', f)

      const first = await garmCheck('sam@example.com', 'ibuild4you')
      expect(first).toEqual({ allowed: true, role: 'owner' })
      expect(f).toHaveBeenCalledTimes(1)

      // Still within TTL — served from cache, no second fetch.
      const withinTtl = await garmCheck('sam@example.com', 'ibuild4you')
      expect(withinTtl).toEqual(first)
      expect(f).toHaveBeenCalledTimes(1)

      await vi.advanceTimersByTimeAsync(61_000)

      const afterTtl = await garmCheck('sam@example.com', 'ibuild4you')
      expect(afterTtl).toEqual({ allowed: false, role: null })
      expect(f).toHaveBeenCalledTimes(2)
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('garmCheck — canonical_email (aliasing, #169)', () => {
  it('surfaces a canonical_email from the response, normalized', async () => {
    vi.stubGlobal(
      'fetch',
      mockFetchOnce({ allowed: true, role: 'viewer', canonical_email: '  Canon@Example.COM ' })
    )
    const r = await garmCheck('alias@example.com', 'ibuild4you')
    expect(r.allowed).toBe(true)
    expect(r.canonicalEmail).toBe('canon@example.com')
  })

  it('omits canonicalEmail entirely when the response has no canonical_email', async () => {
    vi.stubGlobal('fetch', mockFetchOnce({ allowed: true, role: 'viewer' }))
    const r = await garmCheck('sam@example.com', 'ibuild4you')
    // Omitted, not null/undefined-valued — keeps pre-aliasing toEqual assertions valid.
    expect('canonicalEmail' in r).toBe(false)
  })

  it('ignores an off-shape canonical_email (non-string or not an email)', async () => {
    vi.stubGlobal('fetch', mockFetchOnce({ allowed: true, role: 'viewer', canonical_email: 42 }))
    const a = await garmCheck('a@example.com', 'ibuild4you')
    expect('canonicalEmail' in a).toBe(false)

    vi.stubGlobal('fetch', mockFetchOnce({ allowed: true, role: 'viewer', canonical_email: 'not-an-email' }))
    const b = await garmCheck('b@example.com', 'ibuild4you')
    expect('canonicalEmail' in b).toBe(false)

    vi.stubGlobal('fetch', mockFetchOnce({ allowed: true, role: 'viewer', canonical_email: '' }))
    const c = await garmCheck('c@example.com', 'ibuild4you')
    expect('canonicalEmail' in c).toBe(false)
  })
})

describe('resolveCanonicalEmail (#169)', () => {
  it('returns the canonical email when Garm reports the input is an alias', async () => {
    vi.stubGlobal(
      'fetch',
      mockFetchOnce({ allowed: true, role: 'viewer', canonical_email: 'canon@example.com' })
    )
    await expect(resolveCanonicalEmail('alias@example.com')).resolves.toBe('canon@example.com')
  })

  it('returns the normalized input when Garm sends no canonical_email', async () => {
    vi.stubGlobal('fetch', mockFetchOnce({ allowed: true, role: 'viewer' }))
    await expect(resolveCanonicalEmail(' Sam@Example.COM ')).resolves.toBe('sam@example.com')
  })

  it('returns the normalized input when the check fails (resolution is fail-open)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('garm down') }))
    await expect(resolveCanonicalEmail('sam@example.com')).resolves.toBe('sam@example.com')
  })

  it('returns "" for an empty/missing email without calling Garm (#161 edge)', async () => {
    const f = vi.fn()
    vi.stubGlobal('fetch', f)
    await expect(resolveCanonicalEmail('')).resolves.toBe('')
    await expect(resolveCanonicalEmail('   ')).resolves.toBe('')
    expect(f).not.toHaveBeenCalled()
  })

  it('is a no-op (no fetch) when GARM_GATING=off — preview / kill-switch path', async () => {
    process.env.GARM_GATING = 'off'
    const f = vi.fn()
    vi.stubGlobal('fetch', f)
    await expect(resolveCanonicalEmail('Sam@Example.com')).resolves.toBe('sam@example.com')
    expect(f).not.toHaveBeenCalled()
  })

  it('is a no-op (no fetch, no warn) when GARM_URL/GARM_KEY are unset', async () => {
    delete process.env.GARM_URL
    delete process.env.GARM_KEY
    const f = vi.fn()
    vi.stubGlobal('fetch', f)
    await expect(resolveCanonicalEmail('sam@example.com')).resolves.toBe('sam@example.com')
    expect(f).not.toHaveBeenCalled()
  })

  it('shares the check cache — a resolve then a check for the same email fetches once', async () => {
    const f = mockFetchOnce({ allowed: true, role: 'viewer', canonical_email: 'canon@example.com' })
    vi.stubGlobal('fetch', f)
    await resolveCanonicalEmail('alias@example.com')
    const r = await garmCheck('alias@example.com', 'ibuild4you', 'viewer')
    expect(r.canonicalEmail).toBe('canon@example.com')
    expect(f).toHaveBeenCalledOnce()
  })
})

describe('garmCheck — email normalization', () => {
  it('normalizes the email in the request body', async () => {
    const f = mockFetchOnce({ allowed: true, role: 'viewer' })
    vi.stubGlobal('fetch', f)
    await garmCheck('  Sam@Example.COM ', 'ibuild4you')
    expect(JSON.parse(callArgs(f)[1].body).email).toBe('sam@example.com')
  })

  it('treats case/whitespace variants as the same cache key', async () => {
    const f = mockFetchOnce({ allowed: true, role: 'owner' })
    vi.stubGlobal('fetch', f)
    await garmCheck('sam@example.com', 'ibuild4you')
    await garmCheck('  SAM@EXAMPLE.com', 'ibuild4you')
    expect(f).toHaveBeenCalledOnce()
  })
})

describe('garmProbe — liveness check for /api/health', () => {
  // Unlike garmCheck, a deny (`allowed:false`) is a HEALTHY answer here — it
  // proves URL, key, scope, and Garm's DB are all working. Only "Garm didn't
  // answer well-formed 200" is unhealthy.

  it('reports ok:false naming GARM_URL when it is unset', async () => {
    delete process.env.GARM_URL
    const f = vi.fn()
    vi.stubGlobal('fetch', f)
    const r = await garmProbe()
    expect(r.ok).toBe(false)
    expect(r.error).toMatch(/GARM_URL/)
    expect(f).not.toHaveBeenCalled()
  })

  it('reports ok:false naming GARM_KEY when it is unset', async () => {
    delete process.env.GARM_KEY
    const f = vi.fn()
    vi.stubGlobal('fetch', f)
    const r = await garmProbe()
    expect(r.ok).toBe(false)
    expect(r.error).toMatch(/GARM_KEY/)
    expect(f).not.toHaveBeenCalled()
  })

  it('reports ok:true on a 200 grant', async () => {
    vi.stubGlobal('fetch', mockFetchOnce({ allowed: true, role: 'viewer' }))
    const r = await garmProbe()
    expect(r.ok).toBe(true)
    expect(r.status).toBe(200)
  })

  it('reports ok:true on a 200 deny — a deny is a healthy answer', async () => {
    vi.stubGlobal('fetch', mockFetchOnce({ allowed: false, role: null }))
    const r = await garmProbe()
    expect(r.ok).toBe(true)
    expect(r.status).toBe(200)
  })

  it('reports ok:false with the status on a 401 (revoked/mis-scoped key)', async () => {
    vi.stubGlobal('fetch', mockFetchOnce({ error: 'bad key' }, { ok: false, status: 401 }))
    const r = await garmProbe()
    expect(r.ok).toBe(false)
    expect(r.status).toBe(401)
  })

  it('reports ok:false when fetch throws (network error)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('network down') }))
    const r = await garmProbe()
    expect(r.ok).toBe(false)
    expect(r.error).toMatch(/network down/)
  })

  it('reports ok:false when fetch aborts (timeout)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => { throw new DOMException('The operation timed out.', 'TimeoutError') })
    )
    const r = await garmProbe()
    expect(r.ok).toBe(false)
  })

  it('reports ok:false on an off-shape 200 body (missing boolean allowed)', async () => {
    vi.stubGlobal('fetch', mockFetchOnce({ role: 'viewer' }))
    const r = await garmProbe()
    expect(r.ok).toBe(false)
  })

  it('never reads or writes garmCheck cache — a subsequent garmCheck still fetches', async () => {
    const f = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ allowed: true, role: 'viewer' }) }))
    vi.stubGlobal('fetch', f)

    await garmProbe()
    expect(f).toHaveBeenCalledTimes(1)

    // If garmProbe had seeded garmCheck's cache for this address, this would
    // serve from cache and fetch would NOT be called a second time.
    const r = await garmCheck('health-probe@example.com', 'ibuild4you')
    expect(f).toHaveBeenCalledTimes(2)
    expect(r).toEqual({ allowed: true, role: 'viewer' })
  })

  it('does not include the consumer key in the result', async () => {
    vi.stubGlobal('fetch', mockFetchOnce({ allowed: true, role: 'viewer' }))
    const r = await garmProbe()
    expect(JSON.stringify(r)).not.toContain('garm_testkey')
  })
})
