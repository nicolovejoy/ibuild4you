import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const sendMock = vi.fn()

vi.mock('resend', () => ({
  Resend: vi.fn().mockImplementation(() => ({
    emails: { send: sendMock },
  })),
}))

import { sendReminderDigest } from '../send-reminder'

describe('sendReminderDigest', () => {
  const originalKey = process.env.RESEND_API_KEY
  const originalDryRun = process.env.REMINDER_DRY_RUN

  beforeEach(() => {
    sendMock.mockReset()
    delete process.env.REMINDER_DRY_RUN
    process.env.RESEND_API_KEY = 'fake-key'
  })

  afterEach(() => {
    process.env.RESEND_API_KEY = originalKey
    process.env.REMINDER_DRY_RUN = originalDryRun
  })

  it('passes both text and html to Resend', async () => {
    sendMock.mockResolvedValue({ data: { id: 'em_d' }, error: null })
    await sendReminderDigest({
      email: 'sam@example.com',
      firstName: 'Sam',
      items: [
        {
          projectId: 'p1',
          makerEmail: 'sam@example.com',
          makerFirstName: 'Sam',
          projectTitle: 'Cafe',
          shareLink: 'https://ibuild4you.com/projects/cafe',
          sessionNumber: 1,
          reminderNumber: 1,
        },
      ],
    })
    const call = sendMock.mock.calls[0][0]
    expect(call.text).toContain('https://ibuild4you.com/projects/cafe')
    expect(call.html).toContain('<a href="https://ibuild4you.com/projects/cafe"')
  })
})
