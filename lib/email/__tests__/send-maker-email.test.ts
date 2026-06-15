import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const sendMock = vi.fn()

vi.mock('resend', () => ({
  Resend: vi.fn().mockImplementation(() => ({
    emails: { send: sendMock },
  })),
}))

import { sendMakerEmail } from '../send-maker-email'

describe('sendMakerEmail', () => {
  const originalKey = process.env.RESEND_API_KEY

  beforeEach(() => {
    sendMock.mockReset()
    process.env.RESEND_API_KEY = 'fake-key'
  })

  afterEach(() => {
    process.env.RESEND_API_KEY = originalKey
  })

  const baseInput = {
    to: 'maker@example.com',
    bcc: ['builder@example.com'],
    replyTo: 'builder@example.com',
    subject: 'Hello',
    text: 'Body text',
  }

  it('sends via Resend with To/BCC/Reply-To from noreply', async () => {
    sendMock.mockResolvedValue({ data: { id: 'em_xyz' }, error: null })
    const result = await sendMakerEmail(baseInput)

    expect(result).toEqual({ emailId: 'em_xyz' })
    expect(sendMock).toHaveBeenCalledOnce()
    const call = sendMock.mock.calls[0][0]
    expect(call.from).toContain('noreply@ibuild4you.com')
    expect(call.to).toEqual(['maker@example.com'])
    expect(call.bcc).toEqual(['builder@example.com'])
    expect(call.replyTo).toBe('builder@example.com')
    expect(call.subject).toBe('Hello')
    expect(call.text).toBe('Body text')
  })

  it('throws when RESEND_API_KEY is missing', async () => {
    delete process.env.RESEND_API_KEY
    await expect(sendMakerEmail(baseInput)).rejects.toThrow('RESEND_API_KEY is not configured')
    expect(sendMock).not.toHaveBeenCalled()
  })

  it('throws when Resend returns an error', async () => {
    sendMock.mockResolvedValue({ data: null, error: { name: 'bad', message: 'nope' } })
    await expect(sendMakerEmail(baseInput)).rejects.toThrow('Resend error: bad — nope')
  })

  it('falls back to "unknown" id when Resend omits one', async () => {
    sendMock.mockResolvedValue({ data: {}, error: null })
    const result = await sendMakerEmail(baseInput)
    expect(result.emailId).toBe('unknown')
  })
})
