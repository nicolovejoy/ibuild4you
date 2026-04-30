import { describe, it, expect, vi, beforeEach } from 'vitest'
import { POST } from '../route'

// =============================================================================
// FILES CONFIRM ROUTE TESTS — POST /api/files/[fileId]/confirm
//
// Phase 2: after the client uploads to S3 via the presigned URL, it calls
// this route to flip the Firestore doc from `pending` to `ready`. Idempotent.
// =============================================================================

const mockGetProjectRole = vi.fn()
const updateCalls: Record<string, unknown>[] = []
const mockUpdate = vi.fn(async (data: Record<string, unknown>) => {
  updateCalls.push(data)
})
let fileDocData: { exists: boolean; data: () => Record<string, unknown> } = {
  exists: false,
  data: () => ({}),
}

const mockCollection = vi.fn(() => ({
  doc: vi.fn(() => ({
    get: vi.fn(async () => fileDocData),
    update: mockUpdate,
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
}))

function makeRequest() {
  return new Request('http://localhost/api/files/abc/confirm', { method: 'POST' })
}

const params = Promise.resolve({ fileId: 'abc' })

const readyDoc = {
  project_id: 'p1',
  filename: 'a.pdf',
  content_type: 'application/pdf',
  size_bytes: 1024,
  storage_path: 'projects/p1/abc/a.pdf',
  status: 'pending',
  uploaded_by_email: 'user@ibuild4you.com',
  uploaded_by_uid: 'user-123',
  created_at: '2026-04-29T00:00:00.000Z',
}

beforeEach(() => {
  mockUpdate.mockClear()
  updateCalls.length = 0
  mockGetProjectRole.mockReset().mockResolvedValue('owner')
  fileDocData = { exists: true, data: () => readyDoc }
})

describe('POST /api/files/[fileId]/confirm', () => {
  it('returns 404 when file doc does not exist', async () => {
    fileDocData = { exists: false, data: () => ({}) }
    const res = await POST(makeRequest(), { params })
    expect(res.status).toBe(404)
  })

  it('returns 404 when caller has no project role', async () => {
    mockGetProjectRole.mockResolvedValue(null)
    const res = await POST(makeRequest(), { params })
    expect(res.status).toBe(404)
  })

  it('flips status from pending to ready and updates updated_at', async () => {
    const res = await POST(makeRequest(), { params })
    expect(res.status).toBe(200)
    expect(mockUpdate).toHaveBeenCalledTimes(1)
    expect(updateCalls[0].status).toBe('ready')
    expect(updateCalls[0].updated_at).toBeTypeOf('string')
  })

  it('returns the file doc with id and ready status', async () => {
    const res = await POST(makeRequest(), { params })
    const data = await res.json()
    expect(data).toMatchObject({
      id: 'abc',
      project_id: 'p1',
      filename: 'a.pdf',
      status: 'ready',
    })
  })

  it('is idempotent — confirming an already-ready file returns 200', async () => {
    fileDocData = { exists: true, data: () => ({ ...readyDoc, status: 'ready' }) }
    const res = await POST(makeRequest(), { params })
    expect(res.status).toBe(200)
    // Even if already ready, we still update updated_at — keeps things simple
    expect(mockUpdate).toHaveBeenCalledTimes(1)
  })
})
