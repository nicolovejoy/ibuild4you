import { describe, it, expect, vi, beforeEach } from 'vitest'

const send = vi.fn(async () => ({ id: 'e1' }))
vi.mock('resend', () => ({ Resend: vi.fn(() => ({ emails: { send } })) }))

import { buildUnqueuedEmail, sendUnqueuedNotification } from '../unqueued-notify'

const input = {
  makerName: 'Mara',
  projectTitle: 'Cafe app',
  slug: 'cafe-app',
  openedAt: '2026-10-17T20:30:00.000Z',
}

describe('buildUnqueuedEmail', () => {
  it('has the exact subject, a Pacific time and the conversations link', () => {
    vi.stubEnv('NEXT_PUBLIC_APP_URL', '')
    const { subject, text, html } = buildUnqueuedEmail(input)
    expect(subject).toBe('Mara opened "Cafe app" — nothing queued')
    expect(text).toContain('Oct 17, 2026, 1:30 PM')
    expect(text).toContain('https://ibuild4you.com/projects/cafe-app?tab=conversations')
    expect(html).toContain('href=')
  })
})

describe('sendUnqueuedNotification', () => {
  beforeEach(() => {
    send.mockClear()
    vi.unstubAllEnvs()
  })

  it('sends when a key is set', async () => {
    vi.stubEnv('RESEND_API_KEY', 'k')
    expect(await sendUnqueuedNotification(input)).toBe(true)
    expect(send).toHaveBeenCalledOnce()
  })
  it('does not send under FEEDBACK_NOTIFY_SUPPRESS=on', async () => {
    vi.stubEnv('RESEND_API_KEY', 'k')
    vi.stubEnv('FEEDBACK_NOTIFY_SUPPRESS', 'on')
    expect(await sendUnqueuedNotification(input)).toBe(false)
    expect(send).not.toHaveBeenCalled()
  })
  it('does not send without RESEND_API_KEY', async () => {
    vi.stubEnv('RESEND_API_KEY', '')
    expect(await sendUnqueuedNotification(input)).toBe(false)
    expect(send).not.toHaveBeenCalled()
  })
})
