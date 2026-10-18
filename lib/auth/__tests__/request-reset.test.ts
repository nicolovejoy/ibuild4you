import { describe, it, expect, vi, afterEach } from 'vitest'
import { requestPasswordReset } from '../request-reset'

// The reset email is written in the sign-in page's locale, so the client must
// actually post it; the route test only covers the server side.
describe('requestPasswordReset', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('posts the trimmed email and the page locale', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    const result = await requestPasswordReset('  maker@example.com ', 'fr')

    expect(result).toEqual({ ok: true })
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('/api/auth/reset-password')
    expect(JSON.parse(init.body as string)).toEqual({ email: 'maker@example.com', language: 'fr' })
  })

  it('defaults the language to English', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    await requestPasswordReset('maker@example.com')
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(JSON.parse(init.body as string).language).toBe('en')
  })
})
