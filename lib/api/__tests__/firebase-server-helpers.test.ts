import { describe, it, expect, vi, beforeEach } from 'vitest'
import { isAdminEmail, requireAdmin, getAuthenticatedUser } from '../firebase-server-helpers'

// Mock Firebase Admin SDK — we don't want real Firebase calls in unit tests
vi.mock('@/lib/firebase/admin', () => ({
  getAdminAuth: vi.fn(() => ({
    verifyIdToken: vi.fn(),
  })),
  getAdminDb: vi.fn(),
}))

import { getAdminAuth } from '@/lib/firebase/admin'

describe('isAdminEmail', () => {
  it('returns true for known admin emails', () => {
    expect(isAdminEmail('nlovejoy@me.com')).toBe(true)
    expect(isAdminEmail('nicholas.lovejoy@gmail.com')).toBe(true)
    expect(isAdminEmail('mlovejoy@scu.edu')).toBe(true)
  })

  it('returns false for non-admin emails', () => {
    expect(isAdminEmail('random@example.com')).toBe(false)
  })

  it('returns false for null', () => {
    expect(isAdminEmail(null)).toBe(false)
  })
})

describe('requireAdmin', () => {
  it('returns null for admin emails (no error)', () => {
    expect(requireAdmin('nlovejoy@me.com')).toBeNull()
  })

  it('returns 403 response for non-admin emails', () => {
    const response = requireAdmin('random@example.com')
    expect(response).not.toBeNull()
    expect(response!.status).toBe(403)
  })

  it('returns 403 response for null', () => {
    const response = requireAdmin(null)
    expect(response).not.toBeNull()
    expect(response!.status).toBe(403)
  })
})

describe('getAuthenticatedUser', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns 401 when no Authorization header is present', async () => {
    const request = new Request('http://localhost/api/test')
    const result = await getAuthenticatedUser(request)
    expect(result.error).not.toBeNull()
    expect(result.error!.status).toBe(401)
    expect(result.uid).toBeNull()
  })

  it('returns 401 when Authorization header has no Bearer prefix', async () => {
    const request = new Request('http://localhost/api/test', {
      headers: { Authorization: 'Basic abc123' },
    })
    const result = await getAuthenticatedUser(request)
    expect(result.error).not.toBeNull()
    expect(result.error!.status).toBe(401)
  })

  it('returns uid and email for a valid token', async () => {
    const mockVerify = vi.fn().mockResolvedValue({
      uid: 'user-123',
      email: 'test@example.com',
    })
    vi.mocked(getAdminAuth).mockReturnValue({ verifyIdToken: mockVerify } as never)

    const request = new Request('http://localhost/api/test', {
      headers: { Authorization: 'Bearer valid-token' },
    })
    const result = await getAuthenticatedUser(request)
    expect(result.error).toBeNull()
    expect(result.uid).toBe('user-123')
    expect(result.email).toBe('test@example.com')
    expect(mockVerify).toHaveBeenCalledWith('valid-token')
  })

  it('returns 401 for an invalid token', async () => {
    const mockVerify = vi.fn().mockRejectedValue(new Error('Invalid token'))
    vi.mocked(getAdminAuth).mockReturnValue({ verifyIdToken: mockVerify } as never)

    const request = new Request('http://localhost/api/test', {
      headers: { Authorization: 'Bearer bad-token' },
    })
    const result = await getAuthenticatedUser(request)
    expect(result.error).not.toBeNull()
    expect(result.error!.status).toBe(401)
    expect(result.uid).toBeNull()
  })
})
