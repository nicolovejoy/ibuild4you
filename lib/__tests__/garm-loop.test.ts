import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  GarmLoopError,
  loopGarmConfigured,
  loopGarmBypassed,
  loopCheck,
  listGrantsForEmail,
  listDelegableApps,
  listAppGrants,
  createGarmApp,
  grantOnApp,
  revokeOnApp,
} from '../garm-loop'

// Loop's Garm client (delegating key). fetch is mocked; no network.

type FetchOpts = {
  method: string
  headers: Record<string, string>
  body?: string
  cache: string
  signal: AbortSignal
}

function mockFetch(body: unknown, status = 200) {
  return vi.fn(async (_url: string, _opts: FetchOpts) => ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  }))
}

function callArgs(f: ReturnType<typeof mockFetch>, i = 0): [string, FetchOpts] {
  const call = f.mock.calls[i]
  if (!call) throw new Error(`fetch was not called (index ${i})`)
  return call
}

const OLD_ENV = { ...process.env }

beforeEach(() => {
  vi.restoreAllMocks()
  process.env.GARM_URL = 'https://garm.test'
  process.env.GARM_LOOP_KEY = 'garm_loop_test'
})

afterEach(() => {
  process.env = { ...OLD_ENV }
})

describe('loopCheck', () => {
  it('posts the check with the bearer header and returns true on allowed:true', async () => {
    const f = mockFetch({ allowed: true, role: 'owner' })
    vi.stubGlobal('fetch', f)
    expect(await loopCheck('a@b.com', 'tideline', 'owner')).toBe(true)
    const [url, opts] = callArgs(f)
    expect(url).toBe('https://garm.test/gnipahellir')
    expect(opts.method).toBe('POST')
    expect(opts.headers.authorization).toBe('Bearer garm_loop_test')
    expect(opts.headers['content-type']).toBe('application/json')
    expect(opts.cache).toBe('no-store')
    expect(opts.signal).toBeInstanceOf(AbortSignal)
    expect(JSON.parse(opts.body as string)).toEqual({
      email: 'a@b.com',
      project: 'tideline',
      min_role: 'owner',
    })
  })

  it('returns false for allowed:false', async () => {
    vi.stubGlobal('fetch', mockFetch({ allowed: false, role: null }))
    expect(await loopCheck('a@b.com', 'tideline', 'owner')).toBe(false)
  })

  it('returns false when allowed is not literally true', async () => {
    vi.stubGlobal('fetch', mockFetch({ allowed: 'yes' }))
    expect(await loopCheck('a@b.com', 'tideline', 'owner')).toBe(false)
  })

  it('returns false when fetch rejects', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('down') }))
    expect(await loopCheck('a@b.com', 'tideline', 'owner')).toBe(false)
  })

  it('returns false on a 500', async () => {
    vi.stubGlobal('fetch', mockFetch({ error: 'boom' }, 500))
    expect(await loopCheck('a@b.com', 'tideline', 'collaborator')).toBe(false)
  })

  it('makes no fetch when the loop key is unset', async () => {
    delete process.env.GARM_LOOP_KEY
    const f = vi.fn()
    vi.stubGlobal('fetch', f)
    expect(await loopCheck('a@b.com', 'tideline', 'owner')).toBe(false)
    expect(f).not.toHaveBeenCalled()
  })

  it('does not cache: two calls make two fetches', async () => {
    const f = mockFetch({ allowed: true, role: 'owner' })
    vi.stubGlobal('fetch', f)
    await loopCheck('a@b.com', 'tideline', 'owner')
    await loopCheck('a@b.com', 'tideline', 'owner')
    expect(f).toHaveBeenCalledTimes(2)
  })
})

describe('listGrantsForEmail', () => {
  it('normalizes and encodes the email, returns grants', async () => {
    const grants = [{ project: 'tideline', role: 'owner' }]
    const f = mockFetch({ grants })
    vi.stubGlobal('fetch', f)
    expect(await listGrantsForEmail('Sam+x@Example.com')).toEqual(grants)
    const [url, opts] = callArgs(f)
    expect(url).toBe('https://garm.test/gnipahellir/grants?email=sam%2Bx%40example.com')
    expect(opts.method).toBe('GET')
    expect(opts.headers.authorization).toBe('Bearer garm_loop_test')
  })

  it('throws GarmLoopError on a 401', async () => {
    vi.stubGlobal('fetch', mockFetch({}, 401))
    await expect(listGrantsForEmail('a@b.com')).rejects.toMatchObject({ status: 401 })
  })
})

describe('listDelegableApps', () => {
  it('returns slug and display_name', async () => {
    vi.stubGlobal(
      'fetch',
      mockFetch({ apps: [{ slug: 'tideline', display_name: 'Tideline', created_at: 'x' }] })
    )
    expect(await listDelegableApps()).toEqual([{ slug: 'tideline', display_name: 'Tideline' }])
  })

  it('throws GarmLoopError with null status when fetch rejects (timeout)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('timeout') }))
    const err = await listDelegableApps().catch((e) => e)
    expect(err).toBeInstanceOf(GarmLoopError)
    expect(err.status).toBeNull()
  })

  it('throws with null status and no fetch when unconfigured', async () => {
    delete process.env.GARM_LOOP_KEY
    const f = vi.fn()
    vi.stubGlobal('fetch', f)
    const err = await listDelegableApps().catch((e) => e)
    expect(err).toBeInstanceOf(GarmLoopError)
    expect(err.status).toBeNull()
    expect(f).not.toHaveBeenCalled()
  })
})

describe('listAppGrants', () => {
  it('returns grants', async () => {
    const grants = [{ email: 'e@x.com', role: 'owner', created_at: 't', created_by: 'loop:o@x.com' }]
    const f = mockFetch({ app: { slug: 'tideline' }, grants })
    vi.stubGlobal('fetch', f)
    expect(await listAppGrants('tideline')).toEqual(grants)
    expect(callArgs(f)[0]).toBe('https://garm.test/gnipahellir/apps/tideline/grants')
  })

  it('throws with status 404', async () => {
    vi.stubGlobal('fetch', mockFetch({}, 404))
    const err = await listAppGrants('nope').catch((e) => e)
    expect(err).toBeInstanceOf(GarmLoopError)
    expect(err.status).toBe(404)
  })
})

describe('grantOnApp', () => {
  it('posts actor, normalized email and role', async () => {
    const f = mockFetch({}, 200)
    vi.stubGlobal('fetch', f)
    await grantOnApp('o@x.com', 'tideline', 'N@X.com', 'collaborator')
    const [url, opts] = callArgs(f)
    expect(url).toBe('https://garm.test/gnipahellir/apps/tideline/grants')
    expect(opts.method).toBe('POST')
    expect(JSON.parse(opts.body as string)).toEqual({
      actor: 'o@x.com',
      email: 'n@x.com',
      role: 'collaborator',
    })
  })

  it('throws status 409', async () => {
    vi.stubGlobal('fetch', mockFetch({}, 409))
    await expect(grantOnApp('o@x.com', 't', 'n@x.com', 'owner')).rejects.toMatchObject({ status: 409 })
  })

  it('throws status 403', async () => {
    vi.stubGlobal('fetch', mockFetch({}, 403))
    await expect(grantOnApp('o@x.com', 't', 'n@x.com', 'owner')).rejects.toMatchObject({ status: 403 })
  })
})

describe('revokeOnApp', () => {
  it('sends DELETE with actor and email in the body', async () => {
    const f = mockFetch({}, 200)
    vi.stubGlobal('fetch', f)
    await revokeOnApp('o@x.com', 'tideline', 'N@X.com')
    const [url, opts] = callArgs(f)
    expect(url).toBe('https://garm.test/gnipahellir/apps/tideline/grants')
    expect(opts.method).toBe('DELETE')
    expect(JSON.parse(opts.body as string)).toEqual({ actor: 'o@x.com', email: 'n@x.com' })
  })
})

describe('createGarmApp', () => {
  it('posts actor, slug, display_name and resolves on 201', async () => {
    const f = mockFetch({}, 201)
    vi.stubGlobal('fetch', f)
    await expect(createGarmApp('o@x.com', 'tideline', 'Tideline')).resolves.toBeUndefined()
    const [url, opts] = callArgs(f)
    expect(url).toBe('https://garm.test/gnipahellir/apps')
    expect(opts.method).toBe('POST')
    expect(JSON.parse(opts.body as string)).toEqual({
      actor: 'o@x.com',
      slug: 'tideline',
      display_name: 'Tideline',
    })
  })

  it('throws status 409', async () => {
    vi.stubGlobal('fetch', mockFetch({}, 409))
    await expect(createGarmApp('o@x.com', 't', 'T')).rejects.toMatchObject({ status: 409 })
  })
})

describe('config helpers', () => {
  it('loopGarmConfigured needs both vars', () => {
    expect(loopGarmConfigured()).toBe(true)
    delete process.env.GARM_URL
    expect(loopGarmConfigured()).toBe(false)
  })

  it('loopGarmBypassed is true only on preview with the key unset', () => {
    process.env.VERCEL_ENV = 'preview'
    expect(loopGarmBypassed()).toBe(false)
    delete process.env.GARM_LOOP_KEY
    expect(loopGarmBypassed()).toBe(true)
    process.env.VERCEL_ENV = 'production'
    expect(loopGarmBypassed()).toBe(false)
  })
})
