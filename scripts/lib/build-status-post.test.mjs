import { describe, it, expect, vi } from 'vitest'
import { noKeyMessage, postBuildStatus, resolveStatusKey, statusKeyItem, validStatusBase } from './build-status-post.mjs'

const KEY = 'bsk_SECRETKEYBODY_123456'

describe('statusKeyItem', () => {
  it('names the 1Password item after the normalised repo', () => {
    expect(statusKeyItem('NicoLovejoy/L6-Music')).toBe('ibuild4you-build-status-nicolovejoy-l6-music')
    expect(statusKeyItem('nicolovejoy/byside')).toBe('ibuild4you-build-status-nicolovejoy-byside')
  })
})

describe('validStatusBase', () => {
  it('accepts an https base', () => {
    expect(validStatusBase('https://ibuild4you.com')).toBe(true)
    expect(validStatusBase('https://preview.ibuild4you.com/')).toBe(true)
    expect(validStatusBase('HTTPS://ibuild4you.com')).toBe(true)
  })
  it('accepts plain http only for localhost or 127.0.0.1, with an optional port', () => {
    expect(validStatusBase('http://localhost')).toBe(true)
    expect(validStatusBase('http://localhost:3000')).toBe(true)
    expect(validStatusBase('http://localhost:3000/')).toBe(true)
    expect(validStatusBase('http://127.0.0.1')).toBe(true)
    expect(validStatusBase('http://127.0.0.1:8080')).toBe(true)
  })
  it('refuses anything else', () => {
    expect(validStatusBase('http://ibuild4you.com')).toBe(false)
    expect(validStatusBase('http://localhost.evil.com')).toBe(false)
    expect(validStatusBase('http://localhost:3000@evil.com')).toBe(false)
    expect(validStatusBase('http://127.0.0.1.evil.com')).toBe(false)
    expect(validStatusBase('ftp://ibuild4you.com')).toBe(false)
    expect(validStatusBase('ibuild4you.com')).toBe(false)
    expect(validStatusBase('https://')).toBe(false)
    expect(validStatusBase('')).toBe(false)
    expect(validStatusBase(null)).toBe(false)
    expect(validStatusBase(undefined)).toBe(false)
  })
})

describe('noKeyMessage', () => {
  it('says there is no key and where the report goes instead', () => {
    expect(noKeyMessage('nicolovejoy/l6-music', 'not minted')).toBe(
      'No build status key for nicolovejoy/l6-music (not minted). Give your report to Nico instead.'
    )
  })
})

describe('resolveStatusKey', () => {
  const STDERR = '"ibuild4you-build-status-x" isn\'t an item in the "dev-secrets" vault SECRET-STDERR'
  const failWith = (props) => {
    const boom = Object.assign(new Error('op: SECRET-STDERR in message'), props)
    return resolveStatusKey({ env: {}, repo: 'nicolovejoy/l6-music', fetchFromOnePassword: () => { throw boom } })
  }

  it('uses the environment key and does not call 1Password', () => {
    const fetchFromOnePassword = vi.fn()
    expect(resolveStatusKey({ env: { BUILD_STATUS_KEY: KEY }, repo: 'a/b', fetchFromOnePassword })).toEqual({ key: KEY })
    expect(fetchFromOnePassword).not.toHaveBeenCalled()
  })
  it('fetches from 1Password when the environment has none, trimming the answer', () => {
    expect(resolveStatusKey({ env: {}, repo: 'a/b', fetchFromOnePassword: () => 'bsk_abcdefghijklmnop\n' })).toEqual({
      key: 'bsk_abcdefghijklmnop',
    })
    expect(resolveStatusKey({ env: { BUILD_STATUS_KEY: '' }, repo: 'a/b', fetchFromOnePassword: () => 'bsk_abcdefghijklmnop' }).key).toBe(
      'bsk_abcdefghijklmnop'
    )
  })
  it('says not minted when 1Password has no such item', () => {
    expect(failWith({ stderr: STDERR, status: 1 })).toEqual({ key: null, reason: 'not minted' })
    expect(failWith({ stderr: '[ERROR] no item found SECRET-STDERR' })).toEqual({ key: null, reason: 'not minted' })
  })
  it('says 1Password did not answer for a timeout or any other failure', () => {
    expect(failWith({ code: 'ETIMEDOUT' })).toEqual({ key: null, reason: '1Password did not answer' })
    expect(failWith({ code: 'ENOENT' })).toEqual({ key: null, reason: '1Password did not answer' })
    expect(failWith({ stderr: 'not signed in SECRET-STDERR', status: 1 })).toEqual({ key: null, reason: '1Password did not answer' })
  })
  it('refuses a stored value that is not a build status key, without echoing it', () => {
    const result = resolveStatusKey({ env: {}, repo: 'a/b', fetchFromOnePassword: () => 'hello' })
    expect(result).toEqual({ key: null, reason: 'the stored key is not a build status key' })
    expect(resolveStatusKey({ env: {}, repo: 'a/b', fetchFromOnePassword: () => 'bsk_short' }).key).toBeNull()
    expect(resolveStatusKey({ env: {}, repo: 'a/b', fetchFromOnePassword: () => '' }).key).toBeNull()
  })
  it('never puts the stderr text into a reason', () => {
    for (const props of [{ stderr: STDERR }, { stderr: 'whatever SECRET-STDERR' }, { code: 'ETIMEDOUT', stderr: 'SECRET-STDERR' }]) {
      const { reason } = failWith(props)
      expect(reason).not.toContain('SECRET-STDERR')
      expect(reason).not.toContain('\n')
    }
  })
})

describe('postBuildStatus', () => {
  const report = { live: [{ what: 'Lesson page', checked: 'opened it in prod' }], merged: ['Booking fix'] }
  const answer = (status, body) => ({
    status,
    text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
  })
  const post = (fetch) =>
    postBuildStatus({ fetch, base: 'https://ibuild4you.com', key: KEY, repo: 'NicoLovejoy/L6-Music', slug: 'f4fc', briefVersion: 7, report })

  it('sends one POST with the bearer key and the report', async () => {
    const fetch = vi.fn(async () => answer(201, { ok: true, posted_at: '2026-11-15T20:00:00.000Z' }))
    await post(fetch)
    expect(fetch).toHaveBeenCalledTimes(1)
    const [url, init] = fetch.mock.calls[0]
    expect(url).toBe('https://ibuild4you.com/api/build-status')
    expect(init.method).toBe('POST')
    expect(init.headers.Authorization).toBe(`Bearer ${KEY}`)
    expect(init.headers['Content-Type']).toBe('application/json')
    expect(JSON.parse(init.body)).toEqual({
      repo: 'nicolovejoy/l6-music',
      project: 'f4fc',
      brief_version_checked: 7,
      ...report,
    })
  })

  const cases = [
    ['201', () => answer(201, { ok: true, posted_at: 'x' }), true, 'Posted. The next prep for f4fc will include it.'],
    ['200 duplicate', () => answer(200, { ok: true, posted_at: 'x', duplicate: true }), true, 'Already posted (identical report a few minutes ago); nothing added.'],
    ['400', () => answer(400, { error: 'live[0] has no "checked" (say what you checked).' }), false, 'The report was refused: live[0] has no "checked" (say what you checked).'],
    ['401', () => answer(401, { error: 'Unauthorized' }), false, 'The app refused the key for NicoLovejoy/L6-Music. Give your report to Nico instead.'],
    ['401 with a non-JSON body', () => answer(401, 'nope'), false, 'The app refused the key for NicoLovejoy/L6-Music. Give your report to Nico instead.'],
    // The server's reason comes through; its own closing period is not doubled.
    ['403', () => answer(403, { error: 'This key cannot post to that project.' }), false, 'The app refused this post: This key cannot post to that project. Check the slug with list_briefs. If it still fails, give your report to Nico instead.'],
    ['403 without a period', () => answer(403, { error: 'Wrong project' }), false, 'The app refused this post: Wrong project. Check the slug with list_briefs. If it still fails, give your report to Nico instead.'],
    ['403 with no string error', () => answer(403, { error: 7 }), false, 'The app refused the key for NicoLovejoy/L6-Music. Give your report to Nico instead.'],
    ['403 with a non-JSON body', () => answer(403, 'Forbidden'), false, 'The app refused the key for NicoLovejoy/L6-Music. Give your report to Nico instead.'],
    ['429', () => answer(429, { error: 'Too many unread build reports for this project.' }), false, 'The app is holding too many unread reports for f4fc. Give your report to Nico instead.'],
    ['429 with a non-JSON body', () => answer(429, 'slow down'), false, 'The app is holding too many unread reports for f4fc. Give your report to Nico instead.'],
    ['502 with HTML', () => answer(502, '<html>Bad gateway</html>'), false, 'Could not reach the app (502). Give your report to Nico instead.'],
    ['201 with a non-JSON body', () => answer(201, 'not json'), true, 'Posted. The next prep for f4fc will include it.'],
    ['200 with a non-JSON body (duplicate unknown)', () => answer(200, ''), true, 'Posted. The next prep for f4fc will include it.'],
    ['500', () => answer(500, { error: 'boom' }), false, 'Could not reach the app (500). Give your report to Nico instead.'],
  ]
  it.each(cases)('%s', async (_name, respond, ok, text) => {
    const result = await post(async () => respond())
    expect(result).toEqual({ ok, text })
    expect(result.text).not.toContain(KEY)
  })

  it('reports a network error by its code only, without throwing', async () => {
    const boom = Object.assign(new Error(`connect failed ${KEY}`), { code: 'ECONNREFUSED' })
    const result = await post(async () => { throw boom })
    expect(result).toEqual({ ok: false, text: 'Could not reach the app (ECONNREFUSED). Give your report to Nico instead.' })
  })

  it('reads the code from the cause of a Node fetch failure', async () => {
    const boom = Object.assign(new TypeError('fetch failed'), { cause: { code: 'ENOTFOUND' } })
    const result = await post(async () => { throw boom })
    expect(result.text).toBe('Could not reach the app (ENOTFOUND). Give your report to Nico instead.')
  })

  it('says timeout for a fetch timeout, not the DOMException code', async () => {
    // AbortSignal.timeout rejects with a DOMException named TimeoutError, code 23.
    const timeout = Object.assign(new Error('The operation was aborted due to timeout'), { name: 'TimeoutError', code: 23 })
    expect((await post(async () => { throw timeout })).text).toBe(
      'Could not reach the app (timeout). Give your report to Nico instead.'
    )
    const abort = Object.assign(new Error('This operation was aborted'), { name: 'AbortError', code: 20 })
    expect((await post(async () => { throw abort })).text).toBe(
      'Could not reach the app (timeout). Give your report to Nico instead.'
    )
  })

  it('uses err.code and err.cause.code only when they are strings', async () => {
    const numeric = Object.assign(new TypeError('fetch failed'), { code: 23, cause: { code: 99 } })
    expect((await post(async () => { throw numeric })).text).toBe(
      'Could not reach the app (TypeError). Give your report to Nico instead.'
    )
    const causeOnly = Object.assign(new TypeError('fetch failed'), { code: 5, cause: { code: 'ECONNRESET' } })
    expect((await post(async () => { throw causeOnly })).text).toBe(
      'Could not reach the app (ECONNRESET). Give your report to Nico instead.'
    )
  })

  it('never returns the key, even if the server quotes it', async () => {
    for (const status of [400, 403]) {
      const result = await post(async () => answer(status, { error: `bad key ${KEY}` }))
      expect(result.ok).toBe(false)
      expect(result.text).not.toContain(KEY)
    }
  })
})
