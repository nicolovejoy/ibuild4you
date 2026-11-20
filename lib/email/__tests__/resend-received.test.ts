import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import receivedEmail from '@/app/api/webhooks/resend/inbound/__tests__/fixtures/received-email.json'
import { fetchReceivedEmail, stripHtml } from '../resend-received'

// fetchReceivedEmail against the recorded Resend payload, with fetch mocked.
// Nothing here calls Resend.

const ORIGINAL_FETCH = globalThis.fetch
const ORIGINAL_ENV = { ...process.env }
const EMAIL_ID = receivedEmail.id

// A fetch that answers every call with `body` (a value to JSON-encode, or a
// raw string) and `status`, recording the calls.
function mockFetch(body: unknown, status = 200) {
  const fn = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(
    async () => new Response(typeof body === 'string' ? body : JSON.stringify(body), { status })
  )
  globalThis.fetch = fn as unknown as typeof fetch
  return fn
}

// The recorded email with some fields replaced.
function variant(overrides: Record<string, unknown>) {
  return { ...structuredClone(receivedEmail), ...overrides }
}

beforeEach(() => {
  process.env = { ...ORIGINAL_ENV, RESEND_API_KEY: 'rk_test' }
  delete process.env.RESEND_INBOUND_FETCH_URL
})

afterEach(() => {
  globalThis.fetch = ORIGINAL_FETCH
  process.env = ORIGINAL_ENV
  vi.restoreAllMocks()
})

describe('fetchReceivedEmail — the request', () => {
  it('calls the receiving endpoint for the id with the API key', async () => {
    const fn = mockFetch(receivedEmail)
    await fetchReceivedEmail(EMAIL_ID)
    expect(fn).toHaveBeenCalledOnce()
    const [url, init] = fn.mock.calls[0]
    expect(url).toBe(`https://api.resend.com/emails/receiving/${EMAIL_ID}`)
    expect(init?.method).toBe('GET')
    expect((init?.headers as Record<string, string>).Authorization).toBe('Bearer rk_test')
  })

  it('uses RESEND_INBOUND_FETCH_URL when set, with the id encoded', async () => {
    process.env.RESEND_INBOUND_FETCH_URL = 'https://example.test/in/{id}/body'
    const fn = mockFetch(receivedEmail)
    await fetchReceivedEmail('a b/c')
    expect(fn.mock.calls[0][0]).toBe('https://example.test/in/a%20b%2Fc/body')
  })
})

describe('fetchReceivedEmail — mapping the recorded email', () => {
  it('maps every field', async () => {
    mockFetch(receivedEmail)
    const email = await fetchReceivedEmail(EMAIL_ID)
    expect(email).toEqual({
      from: 'bduris@example.com',
      header_from: '"Bill Duris" <bduris@example.com>',
      subject: 'Re: lesson planner',
      message_id: '<REPLY-0001@example.com>',
      text: receivedEmail.text,
      sent_at: '2026-11-20T17:44:55.000Z',
      received_at: '2026-11-20T17:47:09.765Z',
      dmarc: 'pass',
      attachments: [],
    })
  })

  it('gives stripped html as text when there is no text', async () => {
    mockFetch(variant({ text: null, html: '<p>Hi <b>there</b></p><p>Two&nbsp;notes.</p>' }))
    const email = await fetchReceivedEmail(EMAIL_ID)
    expect(email?.text).toBe('Hi there\n\nTwo notes.')
  })

  it('prefers stripped html over a blank text', async () => {
    mockFetch(variant({ text: '  \n ', html: '<p>From html</p>' }))
    expect((await fetchReceivedEmail(EMAIL_ID))?.text).toBe('From html')
  })

  it('gives empty text for an email with no body (null text and html), not a failure', async () => {
    mockFetch(variant({ text: null, html: null }))
    const email = await fetchReceivedEmail(EMAIL_ID)
    expect(email).not.toBeNull()
    expect(email?.text).toBe('')
  })

  it('keeps attachment names and types only, skipping items that are not objects', async () => {
    mockFetch(
      variant({
        attachments: [
          { filename: 'plan.pdf', content_type: 'application/pdf', size: 10, id: 'att_1' },
          { filename: 7, content_type: null },
          'not-an-object',
          null,
        ],
      })
    )
    const email = await fetchReceivedEmail(EMAIL_ID)
    expect(email?.attachments).toEqual([
      { filename: 'plan.pdf', content_type: 'application/pdf' },
      { filename: '', content_type: '' },
    ])
  })

  it('gives no attachments when attachments is not an array', async () => {
    mockFetch(variant({ attachments: { filename: 'x' } }))
    expect((await fetchReceivedEmail(EMAIL_ID))?.attachments).toEqual([])
  })
})

describe('fetchReceivedEmail — fields of the wrong type', () => {
  it('sent_at: strips one pair of wrapping quotes; an unquoted date parses too', async () => {
    mockFetch(variant({ headers: { date: 'Thu, 20 Nov 2026 09:44:55 -0800' } }))
    expect((await fetchReceivedEmail(EMAIL_ID))?.sent_at).toBe('2026-11-20T17:44:55.000Z')
  })

  it('sent_at is null when the date is missing, unparsable or not a string', async () => {
    for (const headers of [{}, { date: '"not a date"' }, { date: 12345 }, null, 'date']) {
      mockFetch(variant({ headers }))
      expect((await fetchReceivedEmail(EMAIL_ID))?.sent_at).toBeNull()
    }
  })

  it('header_from is null when headers.from is not a string', async () => {
    for (const headers of [{ from: ['a@b.com'] }, { from: null }, {}, null]) {
      mockFetch(variant({ headers }))
      expect((await fetchReceivedEmail(EMAIL_ID))?.header_from).toBeNull()
    }
  })

  it('received_at is null when created_at does not parse', async () => {
    for (const created_at of ['yesterday', 1700000000, null]) {
      mockFetch(variant({ created_at }))
      expect((await fetchReceivedEmail(EMAIL_ID))?.received_at).toBeNull()
    }
  })

  it('received_at is a UTC ISO string', async () => {
    mockFetch(variant({ created_at: '2026-11-20T09:47:09.765-08:00' }))
    expect((await fetchReceivedEmail(EMAIL_ID))?.received_at).toBe('2026-11-20T17:47:09.765Z')
  })

  it('dmarc is null when authentication or its dmarc is missing or not a string', async () => {
    for (const authentication of [undefined, null, {}, { dmarc: true }, 'pass']) {
      mockFetch(variant({ authentication }))
      expect((await fetchReceivedEmail(EMAIL_ID))?.dmarc).toBeNull()
    }
  })

  it('keeps a dmarc value other than pass as it is', async () => {
    mockFetch(variant({ authentication: { spf: 'pass', dkim: 'pass', dmarc: 'fail' } }))
    expect((await fetchReceivedEmail(EMAIL_ID))?.dmarc).toBe('fail')
  })

  it('from, subject and message_id that are not strings become empty strings', async () => {
    mockFetch(variant({ from: { address: 'x' }, subject: 3, message_id: null }))
    const email = await fetchReceivedEmail(EMAIL_ID)
    expect(email?.from).toBe('')
    expect(email?.subject).toBe('')
    expect(email?.message_id).toBe('')
  })
})

describe('fetchReceivedEmail — failures give null', () => {
  beforeEach(() => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
  })

  it('a 404 gives null', async () => {
    mockFetch('{"error":"not found"}', 404)
    expect(await fetchReceivedEmail(EMAIL_ID)).toBeNull()
  })

  it('a 500 gives null', async () => {
    mockFetch('oops', 500)
    expect(await fetchReceivedEmail(EMAIL_ID)).toBeNull()
  })

  it('no id gives null without calling fetch', async () => {
    const fn = mockFetch(receivedEmail)
    expect(await fetchReceivedEmail('')).toBeNull()
    expect(fn).not.toHaveBeenCalled()
  })

  it('no API key gives null without calling fetch', async () => {
    delete process.env.RESEND_API_KEY
    const fn = mockFetch(receivedEmail)
    expect(await fetchReceivedEmail(EMAIL_ID)).toBeNull()
    expect(fn).not.toHaveBeenCalled()
  })

  it('a thrown fetch gives null', async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new Error('network down')
    }) as unknown as typeof fetch
    expect(await fetchReceivedEmail(EMAIL_ID)).toBeNull()
  })

  it('a body that is not JSON gives null', async () => {
    mockFetch('<html>gateway</html>')
    expect(await fetchReceivedEmail(EMAIL_ID)).toBeNull()
  })

  it('a JSON body that is not an object gives null', async () => {
    for (const body of ['null', '[]', '"text"', '42']) {
      mockFetch(body)
      expect(await fetchReceivedEmail(EMAIL_ID)).toBeNull()
    }
  })

  it('a failure log carries no address, subject or body', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    mockFetch('{"error":"not found"}', 404)
    await fetchReceivedEmail(EMAIL_ID)
    const logged = warn.mock.calls.flat().map(String).join(' ')
    expect(logged).not.toMatch(/@/)
    expect(logged).not.toContain('lesson planner')
  })
})

describe('stripHtml', () => {
  it('drops tags, style and script, keeps line breaks and decodes basic entities', () => {
    const html =
      '<style>p{}</style><script>x()</script><p>One<br>Two</p><p>a &amp; b &lt;c&gt; &quot;d&quot;</p>'
    expect(stripHtml(html)).toBe('One\nTwo\n\na & b <c> "d"')
  })
})
