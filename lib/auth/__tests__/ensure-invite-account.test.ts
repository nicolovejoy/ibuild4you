import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ensureInviteResetLink } from '../ensure-invite-account'

// Garm consumer plan Phase 1 / PR A: the invite flow needs a guaranteed-good
// password-setup link. generatePasswordResetLink() is documented to require
// the target account to exist; some accounts we invite (e.g. one the passcode
// route get-or-created by email, with no password ever set) may lack the
// password provider. So this helper ensures the account exists AND has the
// password provider attached before minting the link — the plan's own
// "guaranteed to work" construction, not the unverified provider-less
// optimization (see PR write-up: that optimization was not empirically
// re-verified and is left for a follow-up, not gambled on here).

const mockGetUserByEmail = vi.fn()
const mockCreateUser = vi.fn()
const mockUpdateUser = vi.fn()
const mockGeneratePasswordResetLink = vi.fn()

vi.mock('@/lib/firebase/admin', () => ({
  getAdminAuth: vi.fn(() => ({
    getUserByEmail: mockGetUserByEmail,
    createUser: mockCreateUser,
    updateUser: mockUpdateUser,
    generatePasswordResetLink: mockGeneratePasswordResetLink,
  })),
}))

describe('ensureInviteResetLink', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('creates a brand-new account with a random password when none exists', async () => {
    mockGetUserByEmail.mockRejectedValue({ code: 'auth/user-not-found' })
    mockCreateUser.mockResolvedValue({ uid: 'new-uid' })
    mockGeneratePasswordResetLink.mockResolvedValue('https://example.com/reset?oobCode=abc')

    const link = await ensureInviteResetLink('New@Example.com')

    expect(mockCreateUser).toHaveBeenCalledWith(
      expect.objectContaining({ email: 'new@example.com', password: expect.any(String) })
    )
    // The random password must be reasonably long/random, not a fixed literal.
    const passwordArg = mockCreateUser.mock.calls[0][0].password as string
    expect(passwordArg.length).toBeGreaterThanOrEqual(24)
    expect(mockUpdateUser).not.toHaveBeenCalled()
    // continueUrl points the post-reset page back at sign-in (not a dead end)
    expect(mockGeneratePasswordResetLink).toHaveBeenCalledWith('new@example.com', {
      url: 'https://ibuild4you.com/auth/login',
    })
    expect(link).toBe('https://example.com/reset?oobCode=abc')
  })

  it('attaches a password provider to an existing provider-less account (e.g. passcode-only)', async () => {
    mockGetUserByEmail.mockResolvedValue({
      uid: 'existing-uid',
      providerData: [], // no providers at all — the passcode get-or-create shape
    })
    mockGeneratePasswordResetLink.mockResolvedValue('https://example.com/reset?oobCode=def')

    const link = await ensureInviteResetLink('maker@example.com')

    expect(mockCreateUser).not.toHaveBeenCalled()
    expect(mockUpdateUser).toHaveBeenCalledWith('existing-uid', {
      password: expect.any(String),
    })
    expect(link).toBe('https://example.com/reset?oobCode=def')
  })

  it('leaves an account alone when it already has the password provider', async () => {
    mockGetUserByEmail.mockResolvedValue({
      uid: 'existing-uid',
      providerData: [{ providerId: 'password' }],
    })
    mockGeneratePasswordResetLink.mockResolvedValue('https://example.com/reset?oobCode=ghi')

    const link = await ensureInviteResetLink('maker@example.com')

    expect(mockCreateUser).not.toHaveBeenCalled()
    expect(mockUpdateUser).not.toHaveBeenCalled()
    expect(link).toBe('https://example.com/reset?oobCode=ghi')
  })

  it('leaves a Google-only account alone (still attaches password so reset is guaranteed)', async () => {
    mockGetUserByEmail.mockResolvedValue({
      uid: 'google-uid',
      providerData: [{ providerId: 'google.com' }],
    })
    mockGeneratePasswordResetLink.mockResolvedValue('https://example.com/reset?oobCode=jkl')

    const link = await ensureInviteResetLink('googler@example.com')

    // Google sign-in stays intact — updateUser only ADDS a password credential,
    // it doesn't remove the google.com provider. We still attach password so
    // generatePasswordResetLink is guaranteed, but never touch closed-signup:
    // no new account is created for an email that wasn't already invited.
    expect(mockCreateUser).not.toHaveBeenCalled()
    expect(mockUpdateUser).toHaveBeenCalledWith('google-uid', { password: expect.any(String) })
    expect(link).toBe('https://example.com/reset?oobCode=jkl')
  })

  it('normalizes email before every Auth call', async () => {
    mockGetUserByEmail.mockRejectedValue({ code: 'auth/user-not-found' })
    mockCreateUser.mockResolvedValue({ uid: 'new-uid' })
    mockGeneratePasswordResetLink.mockResolvedValue('https://example.com/reset?oobCode=mno')

    await ensureInviteResetLink('  Weird.Casing@Example.COM  ')

    expect(mockGetUserByEmail).toHaveBeenCalledWith('weird.casing@example.com')
    expect(mockCreateUser).toHaveBeenCalledWith(
      expect.objectContaining({ email: 'weird.casing@example.com' })
    )
    expect(mockGeneratePasswordResetLink).toHaveBeenCalledWith('weird.casing@example.com', {
      url: 'https://ibuild4you.com/auth/login',
    })
  })

  it('returns null for an empty/blank email without calling Auth', async () => {
    const link = await ensureInviteResetLink('   ')
    expect(link).toBeNull()
    expect(mockGetUserByEmail).not.toHaveBeenCalled()
  })

  it('fails soft (returns null) when generatePasswordResetLink throws — never breaks the invite', async () => {
    mockGetUserByEmail.mockResolvedValue({ uid: 'existing-uid', providerData: [{ providerId: 'password' }] })
    mockGeneratePasswordResetLink.mockRejectedValue(new Error('Auth unreachable'))

    const link = await ensureInviteResetLink('maker@example.com')
    expect(link).toBeNull()
  })

  it('fails soft (returns null) when account creation throws — never breaks the invite', async () => {
    mockGetUserByEmail.mockRejectedValue({ code: 'auth/user-not-found' })
    mockCreateUser.mockRejectedValue(new Error('Auth unreachable'))

    const link = await ensureInviteResetLink('maker@example.com')
    expect(link).toBeNull()
    expect(mockGeneratePasswordResetLink).not.toHaveBeenCalled()
  })

  it('re-throws a getUserByEmail failure that is NOT "not found" as an unexpected error, and still fails soft', async () => {
    mockGetUserByEmail.mockRejectedValue({ code: 'auth/internal-error' })

    const link = await ensureInviteResetLink('maker@example.com')
    expect(link).toBeNull()
    expect(mockCreateUser).not.toHaveBeenCalled()
  })
})
