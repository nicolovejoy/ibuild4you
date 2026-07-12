import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextResponse } from 'next/server'
import { PATCH, DELETE } from '../route'

// =============================================================================
// FOLDER ITEM ROUTE TESTS — PATCH/DELETE /api/folders/[folderId]  (#23b)
//
// Builder+. Rename validates + dedupes; delete moves files to unfiled (never
// deletes them) then drops the folder doc.
// =============================================================================

const mockGetProjectRole = vi.fn()
const mockUpdate = vi.fn(async () => {})
const mockBatchUpdate = vi.fn()
const mockBatchDelete = vi.fn()
const mockBatchCommit = vi.fn(async () => {})

let folderDocData: { exists: boolean; data: () => Record<string, unknown> } = {
  exists: false,
  data: () => ({}),
}
let siblingFolders: { id: string; data: () => Record<string, unknown> }[] = []
let filesInFolder: { ref: string }[] = []

const mockCollection = vi.fn((name: string) => {
  if (name === 'files') {
    return {
      where: vi.fn(() => ({
        where: vi.fn(() => ({
          get: vi.fn(async () => ({ docs: filesInFolder })),
        })),
        get: vi.fn(async () => ({ docs: filesInFolder })),
      })),
    }
  }
  return {
    doc: vi.fn(() => ({
      id: 'f1',
      get: vi.fn(async () => folderDocData),
      update: mockUpdate,
    })),
    where: vi.fn(() => ({
      get: vi.fn(async () => ({ docs: siblingFolders })),
    })),
  }
})

vi.mock('@/lib/api/firebase-server-helpers', () => ({
  getAuthenticatedUser: vi.fn(async () => ({
    uid: 'user-123',
    email: 'user@ibuild4you.com',
    error: null,
    systemRoles: [],
  })),
  getAdminDb: vi.fn(() => ({
    collection: mockCollection,
    batch: vi.fn(() => ({
      update: mockBatchUpdate,
      delete: mockBatchDelete,
      commit: mockBatchCommit,
    })),
  })),
  getProjectRole: (...args: unknown[]) => mockGetProjectRole(...args),
  requireRole: (role: string | null, minimum: string) => {
    const levels: Record<string, number> = { maker: 0, apprentice: 1, builder: 2, owner: 3 }
    if (!role || levels[role] < levels[minimum]) {
      return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
    }
    return null
  },
}))

function patchRequest(body: unknown) {
  return new Request('http://localhost/api/folders/f1', {
    method: 'PATCH',
    body: JSON.stringify(body),
  })
}
function deleteRequest() {
  return new Request('http://localhost/api/folders/f1', { method: 'DELETE' })
}
const params = Promise.resolve({ folderId: 'f1' })

beforeEach(() => {
  vi.clearAllMocks()
  mockGetProjectRole.mockResolvedValue('owner')
  folderDocData = { exists: true, data: () => ({ project_id: 'p1', name: 'Docs' }) }
  siblingFolders = [{ id: 'f1', data: () => ({ project_id: 'p1', name: 'Docs' }) }]
  filesInFolder = []
})

describe('PATCH /api/folders/[folderId]', () => {
  it('returns 404 when the folder does not exist', async () => {
    folderDocData = { exists: false, data: () => ({}) }
    const res = await PATCH(patchRequest({ name: 'New' }), { params })
    expect(res.status).toBe(404)
  })

  it('returns 403 below builder', async () => {
    mockGetProjectRole.mockResolvedValue('maker')
    const res = await PATCH(patchRequest({ name: 'New' }), { params })
    expect(res.status).toBe(403)
  })

  it('rejects an invalid name', async () => {
    const res = await PATCH(patchRequest({ name: '  ' }), { params })
    expect(res.status).toBe(400)
  })

  it('rejects a name held by a sibling folder', async () => {
    siblingFolders.push({ id: 'f2', data: () => ({ project_id: 'p1', name: 'Mockups' }) })
    const res = await PATCH(patchRequest({ name: 'mockups' }), { params })
    expect(res.status).toBe(409)
  })

  it('allows renaming a folder to its own name (case change)', async () => {
    const res = await PATCH(patchRequest({ name: 'DOCS' }), { params })
    expect(res.status).toBe(200)
    expect(mockUpdate).toHaveBeenCalledWith(expect.objectContaining({ name: 'DOCS' }))
  })

  it('renames the folder', async () => {
    const res = await PATCH(patchRequest({ name: ' Photos ' }), { params })
    expect(res.status).toBe(200)
    expect(mockUpdate).toHaveBeenCalledWith(expect.objectContaining({ name: 'Photos' }))
    expect((await res.json()).name).toBe('Photos')
  })
})

describe('DELETE /api/folders/[folderId]', () => {
  it('returns 404 when the folder does not exist', async () => {
    folderDocData = { exists: false, data: () => ({}) }
    const res = await DELETE(deleteRequest(), { params })
    expect(res.status).toBe(404)
  })

  it('returns 403 below builder', async () => {
    mockGetProjectRole.mockResolvedValue('maker')
    const res = await DELETE(deleteRequest(), { params })
    expect(res.status).toBe(403)
    expect(mockBatchCommit).not.toHaveBeenCalled()
  })

  it('moves contained files to unfiled and deletes the folder doc', async () => {
    filesInFolder = [{ ref: 'file-ref-1' }, { ref: 'file-ref-2' }]
    const res = await DELETE(deleteRequest(), { params })
    expect(res.status).toBe(200)
    expect(mockBatchUpdate).toHaveBeenCalledTimes(2)
    expect(mockBatchUpdate).toHaveBeenCalledWith(
      'file-ref-1',
      expect.objectContaining({ folder_id: null }),
    )
    expect(mockBatchDelete).toHaveBeenCalledOnce()
    expect(mockBatchCommit).toHaveBeenCalledOnce()
    expect(await res.json()).toEqual({ id: 'f1', deleted: true, files_moved: 2 })
  })

  it('deletes an empty folder', async () => {
    const res = await DELETE(deleteRequest(), { params })
    expect(res.status).toBe(200)
    expect(mockBatchUpdate).not.toHaveBeenCalled()
    expect(mockBatchDelete).toHaveBeenCalledOnce()
  })
})
