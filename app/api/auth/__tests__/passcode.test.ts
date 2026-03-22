import { describe, it, expect, vi, beforeEach } from 'vitest'
import { POST } from '../passcode/route'

// Mock Firebase Admin SDK
const mockGet = vi.fn()
const mockLimit = vi.fn(() => ({ get: mockGet }))
const mockWhere = vi.fn(() => ({ where: mockWhere, limit: mockLimit }))
const mockCollection = vi.fn(() => ({ where: mockWhere }))
const mockGetUserByEmail = vi.fn()
const mockCreateUser = vi.fn()
const mockCreateCustomToken = vi.fn()

vi.mock('@/lib/firebase/admin', () => ({
  getAdminDb: vi.fn(() => ({
    collection: mockCollection,
  })),
  getAdminAuth: vi.fn(() => ({
    getUserByEmail: mockGetUserByEmail,
    createUser: mockCreateUser,
    createCustomToken: mockCreateCustomToken,
  })),
}))

function makeRequest(body: Record<string, unknown>) {
  return new Request('http://localhost/api/auth/passcode', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

describe('POST /api/auth/passcode', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns 400 when email is missing', async () => {
    const res = await POST(makeRequest({ passcode: 'ABC123' }))
    expect(res.status).toBe(400)
    const data = await res.json()
    expect(data.error).toBe('Email and passcode are required')
  })

  it('returns 400 when passcode is missing', async () => {
    const res = await POST(makeRequest({ email: 'test@example.com' }))
    expect(res.status).toBe(400)
    const data = await res.json()
    expect(data.error).toBe('Email and passcode are required')
  })

  it('returns 400 when both are empty strings', async () => {
    const res = await POST(makeRequest({ email: '  ', passcode: '  ' }))
    expect(res.status).toBe(400)
  })

  it('returns 401 when no matching member is found', async () => {
    mockGet.mockResolvedValue({ empty: true })

    const res = await POST(makeRequest({ email: 'test@example.com', passcode: 'WRONG1' }))
    expect(res.status).toBe(401)
    const data = await res.json()
    expect(data.error).toBe('Invalid email or passcode')
  })

  it('normalizes email to lowercase and passcode to uppercase', async () => {
    mockGet.mockResolvedValue({ empty: true })

    await POST(makeRequest({ email: 'Test@Example.COM', passcode: 'abc123' }))

    // Check that where was called with normalized values
    expect(mockWhere).toHaveBeenCalledWith('email', '==', 'test@example.com')
    expect(mockWhere).toHaveBeenCalledWith('passcode', '==', 'ABC123')
  })

  it('returns token for existing Firebase user', async () => {
    mockGet.mockResolvedValue({
      empty: false,
      docs: [{ data: () => ({ email: 'test@example.com', passcode: 'ABC123' }) }],
    })
    mockGetUserByEmail.mockResolvedValue({ uid: 'existing-uid' })
    mockCreateCustomToken.mockResolvedValue('custom-token-123')

    const res = await POST(makeRequest({ email: 'test@example.com', passcode: 'ABC123' }))
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.token).toBe('custom-token-123')

    expect(mockGetUserByEmail).toHaveBeenCalledWith('test@example.com')
    expect(mockCreateUser).not.toHaveBeenCalled()
    expect(mockCreateCustomToken).toHaveBeenCalledWith('existing-uid')
  })

  it('creates new Firebase user when none exists', async () => {
    mockGet.mockResolvedValue({
      empty: false,
      docs: [{ data: () => ({ email: 'new@example.com', passcode: 'XYZ789' }) }],
    })
    mockGetUserByEmail.mockRejectedValue(new Error('User not found'))
    mockCreateUser.mockResolvedValue({ uid: 'new-uid' })
    mockCreateCustomToken.mockResolvedValue('new-custom-token')

    const res = await POST(makeRequest({ email: 'new@example.com', passcode: 'XYZ789' }))
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.token).toBe('new-custom-token')

    expect(mockCreateUser).toHaveBeenCalledWith({ email: 'new@example.com' })
    expect(mockCreateCustomToken).toHaveBeenCalledWith('new-uid')
  })

  it('trims whitespace from email and passcode', async () => {
    mockGet.mockResolvedValue({ empty: true })

    await POST(makeRequest({ email: '  test@example.com  ', passcode: '  ABC123  ' }))

    expect(mockWhere).toHaveBeenCalledWith('email', '==', 'test@example.com')
    expect(mockWhere).toHaveBeenCalledWith('passcode', '==', 'ABC123')
  })
})
