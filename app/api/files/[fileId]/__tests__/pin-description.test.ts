import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextResponse } from 'next/server'
import { PATCH } from '../route'
import { ARTIFACT_PIN_CAP } from '@/lib/files/artifacts'

// =============================================================================
// PATCH /api/files/[fileId] — pin + description (#83 Phase A)
// Builder+. Pinning enforces the per-project cap; unpinning always allowed.
// =============================================================================

const mockGetProjectRole = vi.fn()
const mockFileUpdate = vi.fn(async () => {})

let fileDocData: { exists: boolean; data: () => Record<string, unknown> }
let pinnedCount = 0 // how many pinned files the where() query returns

const mockCollection = vi.fn((name: string) => ({
  doc: vi.fn(() => ({
    get: vi.fn(async () => (name === 'files' ? fileDocData : { exists: true, data: () => ({ project_id: 'p1' }) })),
    update: mockFileUpdate,
  })),
  where: vi.fn(() => ({
    get: vi.fn(async () => ({
      docs: Array.from({ length: pinnedCount }, () => ({ data: () => ({ pinned: true }) })),
    })),
  })),
}))

vi.mock('@/lib/api/firebase-server-helpers', () => ({
  getAuthenticatedUser: vi.fn(async () => ({ uid: 'u1', email: 'b@x.com', error: null, systemRoles: [] })),
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

vi.mock('@/lib/s3/client', () => ({ s3: {}, S3_BUCKET: 'test', deleteS3Object: vi.fn(async () => {}) }))

const req = (body: unknown) =>
  new Request('http://localhost/api/files/abc', { method: 'PATCH', body: JSON.stringify(body) })
const params = Promise.resolve({ fileId: 'abc' })

beforeEach(() => {
  vi.clearAllMocks()
  mockGetProjectRole.mockResolvedValue('builder')
  fileDocData = { exists: true, data: () => ({ project_id: 'p1', filename: 'a.pdf' }) }
  pinnedCount = 0
})

describe('PATCH pin/description', () => {
  it('rejects an empty body (nothing to update)', async () => {
    expect((await PATCH(req({}), { params })).status).toBe(400)
  })

  it('pins a file when under the cap', async () => {
    pinnedCount = ARTIFACT_PIN_CAP - 1
    const res = await PATCH(req({ pinned: true }), { params })
    expect(res.status).toBe(200)
    expect(mockFileUpdate).toHaveBeenCalledWith(expect.objectContaining({ pinned: true }))
  })

  it('refuses to pin a new file at the cap', async () => {
    pinnedCount = ARTIFACT_PIN_CAP
    const res = await PATCH(req({ pinned: true }), { params })
    expect(res.status).toBe(400)
    expect(mockFileUpdate).not.toHaveBeenCalled()
  })

  it('allows unpinning even when at the cap', async () => {
    pinnedCount = ARTIFACT_PIN_CAP
    fileDocData = { exists: true, data: () => ({ project_id: 'p1', pinned: true }) }
    const res = await PATCH(req({ pinned: false }), { params })
    expect(res.status).toBe(200)
    expect(mockFileUpdate).toHaveBeenCalledWith(expect.objectContaining({ pinned: false }))
  })

  it('does not re-count the cap when the file is already pinned', async () => {
    pinnedCount = ARTIFACT_PIN_CAP // full, but this file is already one of them
    fileDocData = { exists: true, data: () => ({ project_id: 'p1', pinned: true }) }
    const res = await PATCH(req({ pinned: true }), { params })
    expect(res.status).toBe(200)
  })

  it('sets a description and clears it with an empty string', async () => {
    expect((await PATCH(req({ description: '  the mock  ' }), { params })).status).toBe(200)
    expect(mockFileUpdate).toHaveBeenCalledWith(expect.objectContaining({ description: 'the mock' }))
    mockFileUpdate.mockClear()
    expect((await PATCH(req({ description: '' }), { params })).status).toBe(200)
    expect(mockFileUpdate).toHaveBeenCalledWith(expect.objectContaining({ description: null }))
  })

  it('rejects a non-boolean pinned', async () => {
    expect((await PATCH(req({ pinned: 'yes' }), { params })).status).toBe(400)
  })

  it('returns 403 below builder', async () => {
    mockGetProjectRole.mockResolvedValue('maker')
    expect((await PATCH(req({ pinned: true }), { params })).status).toBe(403)
  })
})
