import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mintResetLinkForExistingAccount } from '../reset-link'

// Sibling of ensureInviteResetLink, with one deliberate difference that is the
// whole reason it exists: this one NEVER creates an account. The invite helper
// runs only for an email a builder has already approved, so get-or-create is
// safe there. This one is reached from a PUBLIC unauthenticated endpoint, where
// creating an account for any address typed into a form would be an open
// signup hole in a closed-signup app.

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

describe('mintResetLinkForExistingAccount', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('NEVER creates an account for an unknown email — returns null instead', async () => {
    mockGetUserByEmail.mockRejectedValue({ code: 'auth/user-not-found' })

    const link = await mintResetLinkForExistingAccount('stranger@example.com')

    expect(link).toBeNull()
    expect(mockCreateUser).not.toHaveBeenCalled()
    expect(mockUpdateUser).not.toHaveBeenCalled()
    expect(mockGeneratePasswordResetLink).not.toHaveBeenCalled()
  })

  it('mints a link for an account that already has the password provider', async () => {
    mockGetUserByEmail.mockResolvedValue({
      uid: 'existing-uid',
      providerData: [{ providerId: 'password' }],
    })
    mockGeneratePasswordResetLink.mockResolvedValue('https://example.com/reset?oobCode=abc')

    const link = await mintResetLinkForExistingAccount('maker@example.com')

    expect(mockUpdateUser).not.toHaveBeenCalled()
    expect(mockGeneratePasswordResetLink).toHaveBeenCalledWith('maker@example.com', {
      url: 'https://ibuild4you.com/auth/login',
    })
    expect(link).toBe('https://example.com/reset?oobCode=abc')
  })

  it('attaches a password provider to a provider-less account so the link works', async () => {
    mockGetUserByEmail.mockResolvedValue({ uid: 'passcode-era-uid', providerData: [] })
    mockGeneratePasswordResetLink.mockResolvedValue('https://example.com/reset?oobCode=def')

    const link = await mintResetLinkForExistingAccount('legacy@example.com')

    expect(mockUpdateUser).toHaveBeenCalledWith('passcode-era-uid', { password: expect.any(String) })
    expect(link).toBe('https://example.com/reset?oobCode=def')
  })

  it('attaches a password to a Google-only account without disturbing Google sign-in', async () => {
    mockGetUserByEmail.mockResolvedValue({
      uid: 'google-uid',
      providerData: [{ providerId: 'google.com' }],
    })
    mockGeneratePasswordResetLink.mockResolvedValue('https://example.com/reset?oobCode=ghi')

    const link = await mintResetLinkForExistingAccount('googler@example.com')

    // updateUser only ADDS a password credential; google.com stays attached.
    expect(mockUpdateUser).toHaveBeenCalledWith('google-uid', { password: expect.any(String) })
    expect(link).toBe('https://example.com/reset?oobCode=ghi')
  })

  it('normalizes the email before every Auth call', async () => {
    mockGetUserByEmail.mockResolvedValue({
      uid: 'uid',
      providerData: [{ providerId: 'password' }],
    })
    mockGeneratePasswordResetLink.mockResolvedValue('https://example.com/reset?oobCode=jkl')

    await mintResetLinkForExistingAccount('  Weird.Casing@Example.COM  ')

    expect(mockGetUserByEmail).toHaveBeenCalledWith('weird.casing@example.com')
    expect(mockGeneratePasswordResetLink).toHaveBeenCalledWith('weird.casing@example.com', {
      url: 'https://ibuild4you.com/auth/login',
    })
  })

  it('returns null for a blank email without touching Auth', async () => {
    expect(await mintResetLinkForExistingAccount('   ')).toBeNull()
    expect(mockGetUserByEmail).not.toHaveBeenCalled()
  })

  it('fails soft when link minting throws', async () => {
    mockGetUserByEmail.mockResolvedValue({
      uid: 'uid',
      providerData: [{ providerId: 'password' }],
    })
    mockGeneratePasswordResetLink.mockRejectedValue(new Error('Auth unreachable'))

    expect(await mintResetLinkForExistingAccount('maker@example.com')).toBeNull()
  })

  it('fails soft on an unexpected getUserByEmail error, and still creates nothing', async () => {
    mockGetUserByEmail.mockRejectedValue({ code: 'auth/internal-error' })

    expect(await mintResetLinkForExistingAccount('maker@example.com')).toBeNull()
    expect(mockCreateUser).not.toHaveBeenCalled()
  })
})
