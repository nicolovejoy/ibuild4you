import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextResponse } from 'next/server'
import { PATCH } from '../route'

// =============================================================================
// FILE MOVE ROUTE TESTS — PATCH /api/files/[fileId]  (#23b)
//
// Builder+. Sets folder_id (null = back to unfiled); target folder must exist
// in the same project.
// =============================================================================

const mockGetProjectRole = vi.fn()
const mockFileUpdate = vi.fn(async () => {})

let fileDocData: { exists: boolean; data: () => Record<string, unknown> } = {
  exists: false,
  data: () => ({}),
}
let folderDocData: { exists: boolean; data: () => Record<string, unknown> } = {
  exists: false,
  data: () => ({}),
}

const mockCollection = vi.fn((name: string) => ({
  doc: vi.fn(() => ({
    get: vi.fn(async () => (name === 'files' ? fileDocData : folderDocData)),
    update: mockFileUpdate,
  })),
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

vi.mock('@/lib/s3/client', () => ({
  s3: {},
  S3_BUCKET: 'test-bucket',
  deleteS3Object: vi.fn(async () => {}),
}))

function makeRequest(body: unknown) {
  return new Request('http://localhost/api/files/abc', {
    method: 'PATCH',
    body: JSON.stringify(body),
  })
}
const params = Promise.resolve({ fileId: 'abc' })

beforeEach(() => {
  vi.clearAllMocks()
  mockGetProjectRole.mockResolvedValue('owner')
  fileDocData = { exists: true, data: () => ({ project_id: 'p1', filename: 'a.pdf' }) }
  folderDocData = { exists: true, data: () => ({ project_id: 'p1', name: 'Docs' }) }
})

describe('PATCH /api/files/[fileId]', () => {
  it('returns 404 when the file does not exist', async () => {
    fileDocData = { exists: false, data: () => ({}) }
    const res = await PATCH(makeRequest({ folder_id: 'f1' }), { params })
    expect(res.status).toBe(404)
  })

  it('returns 403 below builder', async () => {
    mockGetProjectRole.mockResolvedValue('maker')
    const res = await PATCH(makeRequest({ folder_id: 'f1' }), { params })
    expect(res.status).toBe(403)
    expect(mockFileUpdate).not.toHaveBeenCalled()
  })

  it('rejects a missing folder_id field', async () => {
    const res = await PATCH(makeRequest({}), { params })
    expect(res.status).toBe(400)
  })

  it('rejects a folder that does not exist', async () => {
    folderDocData = { exists: false, data: () => ({}) }
    const res = await PATCH(makeRequest({ folder_id: 'gone' }), { params })
    expect(res.status).toBe(400)
    expect(mockFileUpdate).not.toHaveBeenCalled()
  })

  it('rejects a folder from another project', async () => {
    folderDocData = { exists: true, data: () => ({ project_id: 'other', name: 'X' }) }
    const res = await PATCH(makeRequest({ folder_id: 'f1' }), { params })
    expect(res.status).toBe(400)
    expect(mockFileUpdate).not.toHaveBeenCalled()
  })

  it('moves the file into a folder', async () => {
    const res = await PATCH(makeRequest({ folder_id: 'f1' }), { params })
    expect(res.status).toBe(200)
    expect(mockFileUpdate).toHaveBeenCalledWith(expect.objectContaining({ folder_id: 'f1' }))
  })

  it('moves the file back to unfiled with folder_id null', async () => {
    const res = await PATCH(makeRequest({ folder_id: null }), { params })
    expect(res.status).toBe(200)
    expect(mockFileUpdate).toHaveBeenCalledWith(expect.objectContaining({ folder_id: null }))
  })
})
