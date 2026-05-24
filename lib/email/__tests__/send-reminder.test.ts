import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const sendMock = vi.fn()

vi.mock('resend', () => ({
  Resend: vi.fn().mockImplementation(() => ({
    emails: { send: sendMock },
  })),
}))

import { sendReminderEmail } from '../send-reminder'

describe('sendReminderEmail', () => {
  const originalDryRun = process.env.REMINDER_DRY_RUN
  const originalKey = process.env.RESEND_API_KEY

  beforeEach(() => {
    sendMock.mockReset()
    delete process.env.REMINDER_DRY_RUN
    process.env.RESEND_API_KEY = 'fake-key'
  })

  afterEach(() => {
    process.env.REMINDER_DRY_RUN = originalDryRun
    process.env.RESEND_API_KEY = originalKey
  })

  const baseInput = {
    makerEmail: 'maker@example.com',
    makerFirstName: 'Sam',
    projectTitle: "Sam's Cafe",
    projectId: 'p_123',
    shareLink: 'https://ibuild4you.com/projects/sams-cafe',
    reminderNumber: 1 as const,
  }

  it('sends via Resend with To/BCC/Reply-To and includes maker greeting', async () => {
    sendMock.mockResolvedValue({ data: { id: 'em_abc' }, error: null })
    const result = await sendReminderEmail(baseInput)

    expect(result).toEqual({ emailId: 'em_abc', dryRun: false })
    expect(sendMock).toHaveBeenCalledOnce()
    const call = sendMock.mock.calls[0][0]
    expect(call.to).toEqual(['maker@example.com'])
    expect(call.bcc).toEqual(['nicholas.lovejoy@gmail.com'])
    expect(call.replyTo).toBe('noreply@ibuild4you.com')
    expect(call.subject).toContain("Sam's Cafe")
    expect(call.text).toMatch(/Hi Sam/)
    expect(call.text).toContain(baseInput.shareLink)
  })

  it('skips Resend and returns dry-run when REMINDER_DRY_RUN=true', async () => {
    process.env.REMINDER_DRY_RUN = 'true'
    const result = await sendReminderEmail(baseInput)
    expect(result).toEqual({ emailId: 'dry-run', dryRun: true })
    expect(sendMock).not.toHaveBeenCalled()
  })

  it('throws when RESEND_API_KEY is missing and not in dry-run', async () => {
    delete process.env.RESEND_API_KEY
    await expect(sendReminderEmail(baseInput)).rejects.toThrow('RESEND_API_KEY')
  })

  it('throws with Resend error details when Resend returns an error', async () => {
    sendMock.mockResolvedValue({
      data: null,
      error: { name: 'rate_limit_exceeded', message: 'too many requests' },
    })
    await expect(sendReminderEmail(baseInput)).rejects.toThrow(/rate_limit_exceeded.*too many requests/)
  })

  it('uses a generic greeting when makerFirstName is missing', async () => {
    sendMock.mockResolvedValue({ data: { id: 'em_xyz' }, error: null })
    await sendReminderEmail({ ...baseInput, makerFirstName: null })
    const call = sendMock.mock.calls[0][0]
    expect(call.text).toMatch(/^Hi,/m)
  })
})
