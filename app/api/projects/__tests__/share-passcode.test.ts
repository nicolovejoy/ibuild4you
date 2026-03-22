import { describe, it, expect, vi, beforeEach } from 'vitest'
import { GET, PATCH } from '../share/route'

// Build chainable Firestore mock
const mockUpdate = vi.fn()
const mockGet = vi.fn()
const mockLimit = vi.fn(() => ({ get: mockGet }))
const mockWhere = vi.fn(() => ({ where: mockWhere, limit: mockLimit }))
const mockCollection = vi.fn(() => ({ where: mockWhere }))

vi.mock('@/lib/firebase/admin', () => ({
  getAdminDb: vi.fn(() => ({
    collection: mockCollection,
  })),
  getAdminAuth: vi.fn(),
}))

// Mock server helpers — simulate authenticated builder
const mockGetProjectRole = vi.fn()
vi.mock('@/lib/api/firebase-server-helpers', () => ({
  getAuthenticatedUser: vi.fn(async () => ({
    uid: 'builder-uid',
    email: 'builder@example.com',
    error: null,
  })),
  getAdminDb: vi.fn(() => ({
    collection: mockCollection,
  })),
  getProjectRole: (...args: unknown[]) => mockGetProjectRole(...args),
  requireRole: (role: string | null, minimum: string) => {
    const levels: Record<string, number> = { maker: 0, apprentice: 1, builder: 2, owner: 3 }
    if (!role || levels[role] < levels[minimum]) {
      const { NextResponse } = require('next/server')
      return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
    }
    return null
  },
}))

vi.mock('@/lib/agent/welcome-message', () => ({
  generateWelcomeMessage: vi.fn(async () => 'Welcome!'),
}))

describe('GET /api/projects/share', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetProjectRole.mockResolvedValue('builder')
  })

  it('returns 400 when project_id is missing', async () => {
    const req = new Request('http://localhost/api/projects/share')
    const res = await GET(req)
    expect(res.status).toBe(400)
  })

  it('returns 403 when caller is not a builder', async () => {
    mockGetProjectRole.mockResolvedValue('maker')
    const req = new Request('http://localhost/api/projects/share?project_id=proj1')
    const res = await GET(req)
    expect(res.status).toBe(403)
  })

  it('returns 404 when no maker member exists', async () => {
    mockGet.mockResolvedValue({ empty: true })
    const req = new Request('http://localhost/api/projects/share?project_id=proj1')
    const res = await GET(req)
    expect(res.status).toBe(404)
  })

  it('returns passcode for the maker member', async () => {
    mockGet.mockResolvedValue({
      empty: false,
      docs: [{ data: () => ({ email: 'maker@example.com', passcode: 'XYZ789' }) }],
    })

    const req = new Request('http://localhost/api/projects/share?project_id=proj1')
    const res = await GET(req)
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.passcode).toBe('XYZ789')
  })

  it('returns null when member has no passcode', async () => {
    mockGet.mockResolvedValue({
      empty: false,
      docs: [{ data: () => ({ email: 'maker@example.com' }) }],
    })

    const req = new Request('http://localhost/api/projects/share?project_id=proj1')
    const res = await GET(req)
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.passcode).toBeNull()
  })
})

describe('PATCH /api/projects/share', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetProjectRole.mockResolvedValue('builder')
  })

  it('returns 400 when project_id is missing', async () => {
    const req = new Request('http://localhost/api/projects/share', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    })
    const res = await PATCH(req)
    expect(res.status).toBe(400)
  })

  it('returns 404 when no maker member exists', async () => {
    mockGet.mockResolvedValue({ empty: true })

    const req = new Request('http://localhost/api/projects/share', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ project_id: 'proj1' }),
    })
    const res = await PATCH(req)
    expect(res.status).toBe(404)
  })

  it('generates a new passcode and updates the member doc', async () => {
    mockGet.mockResolvedValue({
      empty: false,
      docs: [{ ref: { update: mockUpdate }, data: () => ({ passcode: 'OLD123' }) }],
    })

    const req = new Request('http://localhost/api/projects/share', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ project_id: 'proj1' }),
    })
    const res = await PATCH(req)
    expect(res.status).toBe(200)

    const data = await res.json()
    // Passcode should be 6 uppercase alphanumeric characters
    expect(data.passcode).toMatch(/^[A-Z0-9_-]{6}$/)

    // Should have called update on the Firestore doc
    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        passcode: data.passcode,
        updated_at: expect.any(String),
      })
    )
  })

  it('returns 403 when caller is a maker', async () => {
    mockGetProjectRole.mockResolvedValue('maker')

    const req = new Request('http://localhost/api/projects/share', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ project_id: 'proj1' }),
    })
    const res = await PATCH(req)
    expect(res.status).toBe(403)
  })
})
