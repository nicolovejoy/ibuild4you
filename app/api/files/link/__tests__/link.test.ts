import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextResponse } from 'next/server'
import { POST } from '../route'

// =============================================================================
// POST /api/files/link — create a linked artifact (#83 Phase A). Builder+.
// =============================================================================

const mockGetProjectRole = vi.fn()
const mockSet = vi.fn(async (_doc: Record<string, unknown>) => {})
let folderDoc: { exists: boolean; data: () => Record<string, unknown> }

const mockCollection = vi.fn((name: string) => ({
  doc: vi.fn(() => ({
    get: vi.fn(async () => (name === 'file_folders' ? folderDoc : { exists: false, data: () => ({}) })),
    set: mockSet,
  })),
}))

vi.mock('@/lib/api/firebase-server-helpers', () => ({
  getAuthenticatedUser: vi.fn(async () => ({ uid: 'u1', email: 'b@x.com', error: null, systemRoles: [] })),
  getAdminDb: vi.fn(() => ({ collection: mockCollection })),
  getProjectRole: (...args: unknown[]) => mockGetProjectRole(...args),
  getUserDisplayName: vi.fn(async () => 'Builder Bob'),
  requireRole: (role: string | null, minimum: string) => {
    const levels: Record<string, number> = { maker: 0, apprentice: 1, builder: 2, owner: 3 }
    if (!role || levels[role] < levels[minimum]) {
      return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
    }
    return null
  },
}))

const req = (body: unknown) =>
  new Request('http://localhost/api/files/link', { method: 'POST', body: JSON.stringify(body) })

beforeEach(() => {
  vi.clearAllMocks()
  mockGetProjectRole.mockResolvedValue('builder')
  folderDoc = { exists: true, data: () => ({ project_id: 'p1' }) }
})

describe('POST /api/files/link', () => {
  it('creates a linked artifact', async () => {
    const res = await POST(req({ project_id: 'p1', url: 'https://example.com', filename: 'Deck', description: 'the pitch' }))
    expect(res.status).toBe(201)
    expect(mockSet).toHaveBeenCalledWith(
      expect.objectContaining({
        project_id: 'p1',
        source: 'linked',
        url: 'https://example.com',
        filename: 'Deck',
        description: 'the pitch',
        created_by_role: 'builder',
        status: 'ready',
      })
    )
    // No S3 fields on a linked artifact.
    const written = mockSet.mock.calls[0][0]
    expect('storage_path' in written).toBe(false)
    expect('size_bytes' in written).toBe(false)
  })

  it('requires project_id', async () => {
    expect((await POST(req({ url: 'https://a.co' }))).status).toBe(400)
    expect(mockSet).not.toHaveBeenCalled()
  })

  it('rejects a non-http url', async () => {
    expect((await POST(req({ project_id: 'p1', url: 'ftp://a.co' }))).status).toBe(400)
    expect(mockSet).not.toHaveBeenCalled()
  })

  it('returns 403 below builder', async () => {
    mockGetProjectRole.mockResolvedValue('maker')
    expect((await POST(req({ project_id: 'p1', url: 'https://a.co' }))).status).toBe(403)
    expect(mockSet).not.toHaveBeenCalled()
  })

  it('rejects a folder from another project', async () => {
    folderDoc = { exists: true, data: () => ({ project_id: 'other' }) }
    expect((await POST(req({ project_id: 'p1', url: 'https://a.co', folder_id: 'f1' }))).status).toBe(400)
    expect(mockSet).not.toHaveBeenCalled()
  })

  it('defaults the display name to the url', async () => {
    await POST(req({ project_id: 'p1', url: 'https://a.co/x' }))
    expect(mockSet).toHaveBeenCalledWith(expect.objectContaining({ filename: 'https://a.co/x' }))
  })
})
