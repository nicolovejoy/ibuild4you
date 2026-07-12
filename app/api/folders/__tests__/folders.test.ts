import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextResponse } from 'next/server'
import { GET, POST } from '../route'

// =============================================================================
// FOLDERS ROUTE TESTS — GET/POST /api/folders  (#23b)
//
// GET: any member. POST: builder+, validated + case-insensitive dedupe.
// =============================================================================

const mockGetProjectRole = vi.fn()
const mockSet = vi.fn(async () => {})

let existingFolders: { id: string; data: () => Record<string, unknown> }[] = []

const mockCollection = vi.fn(() => ({
  where: vi.fn(() => ({
    get: vi.fn(async () => ({ docs: existingFolders })),
  })),
  doc: vi.fn(() => ({ id: 'new-folder-id', set: mockSet })),
}))

vi.mock('@/lib/api/firebase-server-helpers', () => ({
  getAuthenticatedUser: vi.fn(async () => ({
    uid: 'user-123',
    email: 'user@ibuild4you.com',
    error: null,
    systemRoles: [],
  })),
  getAdminDb: vi.fn(() => ({ collection: mockCollection })),
  getProjectRole: (...args: unknown[]) => mockGetProjectRole(...args),
  requireRole: (role: string | null, minimum: string) => {
    const levels: Record<string, number> = { maker: 0, apprentice: 1, builder: 2, owner: 3 }
    if (!role || levels[role] < levels[minimum]) {
      return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
    }
    return null
  },
}))

function getRequest(projectId?: string) {
  const url = projectId
    ? `http://localhost/api/folders?project_id=${projectId}`
    : 'http://localhost/api/folders'
  return new Request(url)
}

function postRequest(body: unknown) {
  return new Request('http://localhost/api/folders', {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  mockGetProjectRole.mockResolvedValue('owner')
  existingFolders = []
})

describe('GET /api/folders', () => {
  it('requires project_id', async () => {
    const res = await GET(getRequest())
    expect(res.status).toBe(400)
  })

  it('returns 404 for non-members', async () => {
    mockGetProjectRole.mockResolvedValue(null)
    const res = await GET(getRequest('p1'))
    expect(res.status).toBe(404)
  })

  it('returns folders sorted by name (case-insensitive)', async () => {
    existingFolders = [
      { id: 'f1', data: () => ({ project_id: 'p1', name: 'zeta' }) },
      { id: 'f2', data: () => ({ project_id: 'p1', name: 'Alpha' }) },
    ]
    const res = await GET(getRequest('p1'))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.map((f: { id: string }) => f.id)).toEqual(['f2', 'f1'])
  })

  it('allows makers to list folders', async () => {
    mockGetProjectRole.mockResolvedValue('maker')
    const res = await GET(getRequest('p1'))
    expect(res.status).toBe(200)
  })
})

describe('POST /api/folders', () => {
  it('returns 403 below builder', async () => {
    mockGetProjectRole.mockResolvedValue('maker')
    const res = await POST(postRequest({ project_id: 'p1', name: 'Docs' }))
    expect(res.status).toBe(403)
    expect(mockSet).not.toHaveBeenCalled()
  })

  it('rejects an empty name', async () => {
    const res = await POST(postRequest({ project_id: 'p1', name: '   ' }))
    expect(res.status).toBe(400)
  })

  it('rejects a duplicate name case-insensitively', async () => {
    existingFolders = [{ id: 'f1', data: () => ({ project_id: 'p1', name: 'Docs' }) }]
    const res = await POST(postRequest({ project_id: 'p1', name: ' docs ' }))
    expect(res.status).toBe(409)
    expect(mockSet).not.toHaveBeenCalled()
  })

  it('creates a folder with a trimmed name', async () => {
    const res = await POST(postRequest({ project_id: 'p1', name: '  Mockups ' }))
    expect(res.status).toBe(201)
    const body = await res.json()
    expect(body.id).toBe('new-folder-id')
    expect(body.name).toBe('Mockups')
    expect(mockSet).toHaveBeenCalledWith(
      expect.objectContaining({ project_id: 'p1', name: 'Mockups' }),
    )
  })
})
