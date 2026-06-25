import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextResponse } from 'next/server'
import { DELETE } from '../route'

// =============================================================================
// FILES DELETE ROUTE TESTS — DELETE /api/files/[fileId]  (#23a)
//
// Builder+ only. Deletes the S3 object then the Firestore doc; tolerates an
// S3 failure so a missing object can't strand the doc.
// =============================================================================

const mockGetProjectRole = vi.fn()
const mockDeleteDoc = vi.fn(async () => {})
const deleteS3Mock = vi.fn(async (_key?: string) => {})

let fileDocData: { exists: boolean; data: () => Record<string, unknown> } = {
  exists: false,
  data: () => ({}),
}

const mockCollection = vi.fn(() => ({
  doc: vi.fn(() => ({
    get: vi.fn(async () => fileDocData),
    delete: mockDeleteDoc,
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
  deleteS3Object: (key: string) => deleteS3Mock(key),
}))

function makeRequest() {
  return new Request('http://localhost/api/files/abc', { method: 'DELETE' })
}
const params = Promise.resolve({ fileId: 'abc' })

const readyDoc = {
  project_id: 'p1',
  filename: 'a.pdf',
  storage_path: 'projects/p1/abc/a.pdf',
  status: 'ready',
}

beforeEach(() => {
  vi.clearAllMocks()
  mockGetProjectRole.mockResolvedValue('owner')
  deleteS3Mock.mockResolvedValue(undefined)
  fileDocData = { exists: true, data: () => readyDoc }
})

describe('DELETE /api/files/[fileId]', () => {
  it('returns 404 when the file doc does not exist', async () => {
    fileDocData = { exists: false, data: () => ({}) }
    const res = await DELETE(makeRequest(), { params })
    expect(res.status).toBe(404)
    expect(mockDeleteDoc).not.toHaveBeenCalled()
    expect(deleteS3Mock).not.toHaveBeenCalled()
  })

  it('returns 403 when caller is below builder', async () => {
    mockGetProjectRole.mockResolvedValue('maker')
    const res = await DELETE(makeRequest(), { params })
    expect(res.status).toBe(403)
    expect(mockDeleteDoc).not.toHaveBeenCalled()
    expect(deleteS3Mock).not.toHaveBeenCalled()
  })

  it('deletes the S3 object then the Firestore doc and returns 200', async () => {
    const res = await DELETE(makeRequest(), { params })
    expect(res.status).toBe(200)
    expect(deleteS3Mock).toHaveBeenCalledWith('projects/p1/abc/a.pdf')
    expect(mockDeleteDoc).toHaveBeenCalledOnce()
    expect(await res.json()).toEqual({ id: 'abc', deleted: true })
  })

  it('still deletes the doc when the S3 delete fails', async () => {
    deleteS3Mock.mockRejectedValue(new Error('S3 down'))
    const res = await DELETE(makeRequest(), { params })
    expect(res.status).toBe(200)
    expect(mockDeleteDoc).toHaveBeenCalledOnce()
  })

  it('skips S3 when the file has no storage_path', async () => {
    fileDocData = { exists: true, data: () => ({ project_id: 'p1', filename: 'x' }) }
    const res = await DELETE(makeRequest(), { params })
    expect(res.status).toBe(200)
    expect(deleteS3Mock).not.toHaveBeenCalled()
    expect(mockDeleteDoc).toHaveBeenCalledOnce()
  })
})
