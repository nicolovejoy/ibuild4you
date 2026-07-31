import { describe, it, expect, vi, beforeEach } from 'vitest'
import { POST } from '../route'
import { _resetRateLimit } from '@/lib/api/rate-limit'

// Composition test: route -> real mintResetLinkForExistingAccount -> real
// rewriteActionLink -> emailed body. Only the Firebase Admin SDK and the mail
// transport are mocked.
//
// This exists because of a live miss. The route test mocks the mint helper, so
// it could not tell whether the link a recipient actually receives points at
// our handler or at Firebase's. When a real smoke test came back with a
// firebaseapp.com link, nothing in the suite could distinguish "the rewrite is
// broken" from "prod hadn't finished deploying" — the answer turned out to be
// the latter, but the suite should have been able to say so.

const mockGetUserByEmail = vi.fn()
const mockUpdateUser = vi.fn()
const mockGeneratePasswordResetLink = vi.fn()
const mockSendMakerEmail = vi.fn()

vi.mock('@/lib/firebase/admin', () => ({
  getAdminAuth: vi.fn(() => ({
    getUserByEmail: mockGetUserByEmail,
    updateUser: mockUpdateUser,
    generatePasswordResetLink: mockGeneratePasswordResetLink,
  })),
}))

vi.mock('@/lib/email/send-maker-email', () => ({
  sendMakerEmail: (input: unknown) => mockSendMakerEmail(input),
}))

// What the Admin SDK really hands back: Firebase's own hosted handler.
const FIREBASE_LINK =
  'https://ibuild4you-a0c4d.firebaseapp.com/__/auth/action' +
  '?mode=resetPassword&oobCode=REALCODE123&apiKey=AIzaFake' +
  '&continueUrl=https%3A%2F%2Fibuild4you.com%2Fauth%2Flogin&lang=en'

function post(email: string) {
  return new Request('https://ibuild4you.com/api/auth/reset-password', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': '9.9.9.9' },
    body: JSON.stringify({ email }),
  })
}

function sentBody(): string {
  return mockSendMakerEmail.mock.calls[0][0].text as string
}

describe('the link a recipient actually receives', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    _resetRateLimit()
    mockGetUserByEmail.mockResolvedValue({
      uid: 'uid-1',
      providerData: [{ providerId: 'password' }],
    })
    mockGeneratePasswordResetLink.mockResolvedValue(FIREBASE_LINK)
    mockSendMakerEmail.mockResolvedValue({ emailId: 'e1' })
  })

  it('points at our own handler, not Firebase’s hosted page', async () => {
    await POST(post('maker@example.com'))

    const body = sentBody()
    expect(body).toContain('https://ibuild4you.com/auth/action')
    expect(body).not.toContain('firebaseapp.com')
  })

  it('carries the oobCode through unchanged', async () => {
    await POST(post('maker@example.com'))

    expect(sentBody()).toContain('oobCode=REALCODE123')
  })

  it('emits exactly one action link', async () => {
    await POST(post('maker@example.com'))

    const matches = sentBody().match(/https:\/\/[^\s]*\/auth\/action[^\s]*/g) || []
    expect(matches).toHaveLength(1)
  })
})
