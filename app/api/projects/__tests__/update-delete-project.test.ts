import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextResponse } from 'next/server'
import { PATCH, DELETE } from '../route'

// =============================================================================
// Tests for PATCH and DELETE /api/projects
//
// PATCH — updates allowed project fields (builder+ role required)
// DELETE — removes project and all related data (owner role required)
//
// Mock patterns follow share-passcode.test.ts: mockGetProjectRole controls
// the role returned, and requireRole uses real rank logic.
// =============================================================================

// Track Firestore operations
const updatedDocs: Record<string, { docId: string; data: Record<string, unknown> }[]> = {}
const deletedRefs: { collection: string; docId: string }[] = []

let lastCollectionName = ''
let lastDocId = ''

// Mock Firestore doc get — controls whether a doc "exists"
const mockDocGet = vi.fn()
// Mock Firestore doc update
const mockDocUpdate = vi.fn(async (data: Record<string, unknown>) => {
  if (!updatedDocs[lastCollectionName]) updatedDocs[lastCollectionName] = []
  updatedDocs[lastCollectionName].push({ docId: lastDocId, data })
})

// Mock .where().get() chain for DELETE subcollection queries
const mockWhereGet = vi.fn()
const mockWhere = vi.fn(() => ({
  where: mockWhere,
  limit: vi.fn(() => ({
    get: vi.fn(async () => ({ empty: true })), // no slug collisions in tests
  })),
  get: mockWhereGet,
}))

// Mock batch for DELETE
const mockBatchDelete = vi.fn()
const mockBatchCommit = vi.fn()

const mockDoc = vi.fn((id: string) => {
  lastDocId = id
  return {
    get: mockDocGet,
    update: mockDocUpdate,
    ref: { collection: lastCollectionName, id },
  }
})

const mockCollection = vi.fn((name: string) => {
  lastCollectionName = name
  return {
    doc: mockDoc,
    where: mockWhere,
  }
})

// Mock role check
const mockGetProjectRole = vi.fn()

vi.mock('@/lib/api/firebase-server-helpers', () => ({
  getAuthenticatedUser: vi.fn(async () => ({
    uid: 'user-123',
    email: 'nico@ibuild4you.com',
    error: null,
    systemRoles: [],
  })),
  getAdminDb: vi.fn(() => ({
    collection: mockCollection,
    batch: () => ({ delete: mockBatchDelete, commit: mockBatchCommit }),
  })),
  getProjectRole: (...args: unknown[]) => mockGetProjectRole(...args),
  requireRole: (role: string | null, minimum: string) => {
    const levels: Record<string, number> = { maker: 0, apprentice: 1, builder: 2, owner: 3 }
    if (!role || levels[role] < levels[minimum]) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    return null
  },
}))

// Helper: create a PATCH request with JSON body
function makePatchRequest(body: Record<string, unknown>) {
  return new Request('http://localhost/api/projects', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

// Helper: create a DELETE request with query param
function makeDeleteRequest(projectId?: string) {
  const url = projectId
    ? `http://localhost/api/projects?project_id=${projectId}`
    : 'http://localhost/api/projects'
  return new Request(url, { method: 'DELETE' })
}

describe('PATCH /api/projects', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    for (const key of Object.keys(updatedDocs)) delete updatedDocs[key]
    deletedRefs.length = 0
    // Default: builder role, project exists
    mockGetProjectRole.mockResolvedValue('builder')
    mockDocGet.mockResolvedValue({ exists: true, data: () => ({ title: 'Old Title' }) })
  })

  it('returns 400 when project_id is missing', async () => {
    const res = await PATCH(makePatchRequest({ title: 'New Title' }))
    expect(res.status).toBe(400)
    const data = await res.json()
    expect(data.error).toBe('project_id is required')
  })

  it('returns 403 when caller is a maker (not builder+)', async () => {
    mockGetProjectRole.mockResolvedValue('maker')
    const res = await PATCH(makePatchRequest({ project_id: 'proj-1', title: 'New' }))
    expect(res.status).toBe(403)
  })

  it('returns 404 when project does not exist', async () => {
    mockDocGet.mockResolvedValue({ exists: false })
    const res = await PATCH(makePatchRequest({ project_id: 'proj-missing', title: 'New' }))
    expect(res.status).toBe(404)
    const data = await res.json()
    expect(data.error).toBe('Project not found')
  })

  it('updates allowed fields', async () => {
    const res = await PATCH(
      makePatchRequest({
        project_id: 'proj-1',
        context: 'New context',
        session_mode: 'converge',
        welcome_message: 'Hello!',
      })
    )
    expect(res.status).toBe(200)

    const data = await res.json()
    expect(data.context).toBe('New context')
    expect(data.session_mode).toBe('converge')
    expect(data.welcome_message).toBe('Hello!')
    expect(data.id).toBe('proj-1')
  })

  it('updates nudge_message and voice_sample', async () => {
    const res = await PATCH(
      makePatchRequest({
        project_id: 'proj-1',
        nudge_message: 'Hand-written nudge text.',
        voice_sample: 'Short. Direct. No filler.',
      })
    )
    expect(res.status).toBe(200)

    const data = await res.json()
    expect(data.nudge_message).toBe('Hand-written nudge text.')
    expect(data.voice_sample).toBe('Short. Direct. No filler.')
  })

  it('regenerates slug when title changes', async () => {
    const res = await PATCH(
      makePatchRequest({
        project_id: 'proj-1',
        title: 'My New Title',
      })
    )
    expect(res.status).toBe(200)

    const data = await res.json()
    expect(data.title).toBe('My New Title')
    expect(data.slug).toBe('my-new-title')
  })

  it('ignores disallowed fields', async () => {
    const res = await PATCH(
      makePatchRequest({
        project_id: 'proj-1',
        status: 'archived',
        owner_id: 'hacker-uid',
        secret_field: 'should not appear',
        context: 'allowed',
      })
    )
    expect(res.status).toBe(200)

    const data = await res.json()
    expect(data.context).toBe('allowed')
    expect(data.status).toBeUndefined()
    expect(data.owner_id).toBeUndefined()
    expect(data.secret_field).toBeUndefined()
  })

  it('always adds updated_at', async () => {
    const res = await PATCH(
      makePatchRequest({
        project_id: 'proj-1',
        context: 'Something',
      })
    )
    expect(res.status).toBe(200)

    const data = await res.json()
    expect(data.updated_at).toBeDefined()
    // Should be a valid ISO string
    expect(new Date(data.updated_at).toISOString()).toBe(data.updated_at)
  })
})

describe('DELETE /api/projects', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    for (const key of Object.keys(updatedDocs)) delete updatedDocs[key]
    deletedRefs.length = 0
    mockBatchDelete.mockClear()
    mockBatchCommit.mockClear()
    // Default: owner role, project exists
    mockGetProjectRole.mockResolvedValue('owner')
    mockDocGet.mockResolvedValue({ exists: true, data: () => ({ title: 'Test' }) })
  })

  it('returns 400 when project_id is missing', async () => {
    const res = await DELETE(makeDeleteRequest())
    expect(res.status).toBe(400)
    const data = await res.json()
    expect(data.error).toBe('project_id is required')
  })

  it('returns 403 when caller is not owner', async () => {
    mockGetProjectRole.mockResolvedValue('builder')
    const res = await DELETE(makeDeleteRequest('proj-1'))
    expect(res.status).toBe(403)
  })

  it('returns 404 when project does not exist', async () => {
    mockDocGet.mockResolvedValue({ exists: false })
    const res = await DELETE(makeDeleteRequest('proj-missing'))
    expect(res.status).toBe(404)
    const data = await res.json()
    expect(data.error).toBe('Project not found')
  })

  it('deletes project and all related docs', async () => {
    // Sessions with messages
    const sessionRef = { collection: 'sessions', id: 'sess-1' }
    const messageRef = { collection: 'messages', id: 'msg-1' }
    const briefRef = { collection: 'briefs', id: 'brief-1' }
    const memberRef = { collection: 'project_members', id: 'member-1' }

    // Mock subcollection queries based on collection name
    mockWhereGet.mockImplementation(async () => {
      // Determine which collection is being queried by checking mockWhere calls
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const lastWhereCall = (mockWhere.mock.calls as any[]).at(-1)
      const field = lastWhereCall?.[0] as string

      if (field === 'project_id') {
        // Could be sessions, briefs, or members — determine by lastCollectionName
        if (lastCollectionName === 'sessions') {
          return {
            docs: [{ id: 'sess-1', ref: sessionRef }],
          }
        }
        if (lastCollectionName === 'briefs') {
          return { docs: [{ id: 'brief-1', ref: briefRef }] }
        }
        if (lastCollectionName === 'project_members') {
          return { docs: [{ id: 'member-1', ref: memberRef }] }
        }
      }
      if (field === 'session_id') {
        // Messages for a session
        return { docs: [{ id: 'msg-1', ref: messageRef }] }
      }
      return { docs: [] }
    })

    const res = await DELETE(makeDeleteRequest('proj-1'))
    expect(res.status).toBe(200)

    const data = await res.json()
    expect(data.deleted).toBe(true)
    expect(data.project_id).toBe('proj-1')

    // Should have batch-deleted: message + session + brief + member + project = 5 refs
    expect(mockBatchDelete.mock.calls.length).toBe(5)
    expect(mockBatchCommit).toHaveBeenCalled()
  })

  it('handles project with no sessions', async () => {
    // All subcollection queries return empty
    mockWhereGet.mockResolvedValue({ docs: [] })

    const res = await DELETE(makeDeleteRequest('proj-empty'))
    expect(res.status).toBe(200)

    const data = await res.json()
    expect(data.deleted).toBe(true)
    expect(data.project_id).toBe('proj-empty')

    // Should still delete the project doc itself (1 ref)
    expect(mockBatchDelete.mock.calls.length).toBe(1)
    expect(mockBatchCommit).toHaveBeenCalled()
  })
})
