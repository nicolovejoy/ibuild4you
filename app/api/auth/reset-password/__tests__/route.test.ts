import { describe, it, expect, vi, beforeEach } from 'vitest'
import { POST } from '../route'
import { _resetRateLimit } from '@/lib/api/rate-limit'
import { copy } from '@/lib/copy'

// Public, unauthenticated endpoint. Three things it must never do:
//   1. reveal whether an address has an account (enumeration)
//   2. create an account for an address that doesn't have one
//   3. let one IP (or one victim address) be mailbombed
// Everything else is best-effort: a mint or send failure is logged, never
// surfaced, and never changes the response.

const mockMintResetLink = vi.fn()
const mockSendMakerEmail = vi.fn()

vi.mock('@/lib/auth/reset-link', () => ({
  mintResetLinkForExistingAccount: (email: string) => mockMintResetLink(email),
}))

vi.mock('@/lib/email/send-maker-email', () => ({
  sendMakerEmail: (input: unknown) => mockSendMakerEmail(input),
}))

function post(email: unknown, ip = '1.2.3.4') {
  return new Request('https://ibuild4you.com/api/auth/reset-password', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': ip },
    body: JSON.stringify({ email }),
  })
}

describe('POST /api/auth/reset-password', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    _resetRateLimit()
    mockMintResetLink.mockResolvedValue('https://ibuild4you.com/reset?oobCode=abc')
    mockSendMakerEmail.mockResolvedValue({ emailId: 'email-1' })
  })

  it('sends the reset link via our own Resend sender, not Firebase', async () => {
    const res = await POST(post('maker@example.com'))

    expect(res.status).toBe(200)
    expect(mockSendMakerEmail).toHaveBeenCalledTimes(1)
    const sent = mockSendMakerEmail.mock.calls[0][0]
    expect(sent.to).toBe('maker@example.com')
    expect(sent.text).toContain('https://ibuild4you.com/reset?oobCode=abc')
  })

  it('tells the recipient to check junk and move it to the inbox', async () => {
    await POST(post('maker@example.com'))

    const sent = mockSendMakerEmail.mock.calls[0][0]
    expect(sent.text.toLowerCase()).toContain('junk')
    expect(sent.text.toLowerCase()).toContain('inbox')
  })

  it('answers identically for an unknown address, and sends nothing', async () => {
    mockMintResetLink.mockResolvedValue(null)

    const unknown = await POST(post('stranger@example.com'))
    const unknownBody = await unknown.json()

    _resetRateLimit()
    mockMintResetLink.mockResolvedValue('https://ibuild4you.com/reset?oobCode=abc')
    const known = await POST(post('maker@example.com'))
    const knownBody = await known.json()

    // Byte-identical status + body: the response can't be used as an oracle.
    expect(unknown.status).toBe(known.status)
    expect(unknownBody).toEqual(knownBody)
    // ...but no mail was actually sent for the unknown address.
    expect(mockSendMakerEmail).toHaveBeenCalledTimes(1)
  })

  it('still answers 200 when sending fails, so a mail outage is not an oracle either', async () => {
    mockSendMakerEmail.mockRejectedValue(new Error('Resend down'))

    const res = await POST(post('maker@example.com'))

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })
  })

  it('normalizes the submitted email', async () => {
    await POST(post('  Maker@Example.COM  '))

    expect(mockMintResetLink).toHaveBeenCalledWith('maker@example.com')
  })

  it('rejects a malformed address without calling Auth or sending mail', async () => {
    const res = await POST(post('not-an-email'))

    expect(res.status).toBe(200) // still no oracle
    expect(mockMintResetLink).not.toHaveBeenCalled()
    expect(mockSendMakerEmail).not.toHaveBeenCalled()
  })

  it('rate-limits one IP hammering many addresses', async () => {
    for (let i = 0; i < 10; i++) {
      const res = await POST(post(`person${i}@example.com`))
      expect(res.status).toBe(200)
    }

    const blocked = await POST(post('person11@example.com'))
    expect(blocked.status).toBe(429)
    expect(mockSendMakerEmail).toHaveBeenCalledTimes(10)
  })

  // The on-screen confirmation is the other half of the spam fix: the email
  // itself is useless advice if they never find it. Pinned here rather than
  // only in the e2e, which shares a rate-limit budget and can't always run.
  it('the on-screen confirmation tells them to check junk and move it to the inbox', () => {
    const confirmation = copy.auth.resetEmailSent('maker@example.com')
    expect(confirmation.toLowerCase()).toMatch(/junk|spam/)
    expect(confirmation.toLowerCase()).toContain('inbox')
  })

  it('rate-limits one address being mailbombed from many IPs', async () => {
    for (let i = 0; i < 3; i++) {
      const res = await POST(post('victim@example.com', `10.0.0.${i}`))
      expect(res.status).toBe(200)
    }

    const blocked = await POST(post('victim@example.com', '10.0.0.99'))
    expect(blocked.status).toBe(429)
    expect(mockSendMakerEmail).toHaveBeenCalledTimes(3)
  })
})
