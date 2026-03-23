import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextResponse } from 'next/server'
import { GET, POST } from '../route'

// =============================================================================
// SESSION ROUTE TESTS
//
// POST /api/sessions does several things:
//   1. Validates project_id and checks builder role
//   2. Marks existing active sessions as completed (batch update)
//   3. Snapshots config from the project onto the new session
//   4. If the project has a welcome_message, adds it as the first agent message
//   5. Returns the new session
//
// The Firestore mock here is more complex because the route uses:
//   - doc(id).get() — read a specific document
//   - collection().where().where().get() — query with multiple filters
//   - batch() — atomic writes (update + set + set)
//   - collection().doc() — create a doc ref with auto-generated ID
//
// We mock each of these and track what was written.
// =============================================================================

// --- Track batch operations ---
const batchUpdates: { ref: unknown; data: Record<string, unknown> }[] = []
const batchSets: { ref: { id: string }; data: Record<string, unknown> }[] = []

const mockBatch = {
  update: vi.fn((ref: unknown, data: Record<string, unknown>) => {
    batchUpdates.push({ ref, data })
  }),
  set: vi.fn((ref: { id: string }, data: Record<string, unknown>) => {
    batchSets.push({ ref, data })
  }),
  commit: vi.fn(async () => {}),
}

// --- Mock project document ---
let mockProjectData: Record<string, unknown> | null = null
let mockProjectExists = true

// --- Mock active sessions query ---
let mockActiveSessionDocs: { ref: { id: string } }[] = []

// --- Mock sessions list (for GET) ---
let mockSessionDocs: { id: string; data: () => Record<string, unknown> }[] = []

// Build the chainable Firestore mock
const mockGet = vi.fn()
const mockOrderBy = vi.fn(() => ({ get: mockGet }))
const mockWhere2 = vi.fn(() => ({ get: vi.fn(async () => ({ docs: mockActiveSessionDocs })) }))
const mockWhere = vi.fn(() => ({
  where: mockWhere2,
  orderBy: mockOrderBy,
}))

const mockDoc = vi.fn((id?: string) => ({
  id: id || 'new-session-id',
  get: vi.fn(async () => ({
    exists: mockProjectExists,
    data: () => mockProjectData,
  })),
}))

const mockCollection = vi.fn(() => ({
  where: mockWhere,
  doc: mockDoc,
}))

const mockGetProjectRole = vi.fn()

vi.mock('@/lib/api/firebase-server-helpers', () => ({
  getAuthenticatedUser: vi.fn(async () => ({
    uid: 'builder-uid',
    email: 'builder@ibuild4you.com',
    error: null,
  })),
  getAdminDb: vi.fn(() => ({
    collection: mockCollection,
    batch: () => mockBatch,
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

function makePostRequest(body: Record<string, unknown>) {
  return new Request('http://localhost/api/sessions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

describe('GET /api/sessions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetProjectRole.mockResolvedValue('builder')
    mockSessionDocs = []
  })

  it('returns 400 when project_id is missing', async () => {
    const req = new Request('http://localhost/api/sessions')
    const res = await GET(req)
    expect(res.status).toBe(400)
  })

  it('returns 404 when user has no role on the project', async () => {
    mockGetProjectRole.mockResolvedValue(null)
    const req = new Request('http://localhost/api/sessions?project_id=proj1')
    const res = await GET(req)
    expect(res.status).toBe(404)
  })

  it('returns sessions for a valid project', async () => {
    mockSessionDocs = [
      { id: 's1', data: () => ({ project_id: 'proj1', status: 'active', created_at: '2026-01-01' }) },
    ]
    mockGet.mockResolvedValue({ docs: mockSessionDocs })

    const req = new Request('http://localhost/api/sessions?project_id=proj1')
    const res = await GET(req)
    expect(res.status).toBe(200)

    const data = await res.json()
    expect(data).toHaveLength(1)
    expect(data[0].id).toBe('s1')
  })
})

describe('POST /api/sessions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    batchUpdates.length = 0
    batchSets.length = 0
    mockGetProjectRole.mockResolvedValue('builder')
    mockProjectExists = true
    mockProjectData = {
      title: 'Test Project',
      session_mode: 'discover',
      seed_questions: ['Q1', 'Q2'],
      builder_directives: ['D1'],
      welcome_message: 'Hello maker!',
    }
    mockActiveSessionDocs = []
  })

  // --- Validation ---

  it('returns 400 when project_id is missing', async () => {
    const res = await POST(makePostRequest({}))
    expect(res.status).toBe(400)
  })

  it('returns 403 when caller is a maker', async () => {
    mockGetProjectRole.mockResolvedValue('maker')
    const res = await POST(makePostRequest({ project_id: 'proj1' }))
    expect(res.status).toBe(403)
  })

  it('returns 404 when project does not exist', async () => {
    mockProjectExists = false
    const res = await POST(makePostRequest({ project_id: 'proj1' }))
    expect(res.status).toBe(404)
  })

  // --- Session creation ---

  it('creates a new session with 201 status', async () => {
    const res = await POST(makePostRequest({ project_id: 'proj1' }))
    expect(res.status).toBe(201)

    const data = await res.json()
    expect(data.project_id).toBe('proj1')
    expect(data.status).toBe('active')
  })

  it('snapshots config from project onto the session', async () => {
    await POST(makePostRequest({ project_id: 'proj1' }))

    // The session should be the first batch.set() call
    const sessionSet = batchSets.find((s) => s.data.project_id === 'proj1')
    expect(sessionSet).toBeDefined()
    expect(sessionSet!.data).toMatchObject({
      session_mode: 'discover',
      seed_questions: ['Q1', 'Q2'],
      builder_directives: ['D1'],
      welcome_message: 'Hello maker!',
    })
  })

  it('does not snapshot undefined config fields', async () => {
    // Project with no config
    mockProjectData = { title: 'Bare Project' }

    await POST(makePostRequest({ project_id: 'proj1' }))

    const sessionSet = batchSets.find((s) => s.data.project_id === 'proj1')
    expect(sessionSet!.data.session_mode).toBeUndefined()
    expect(sessionSet!.data.seed_questions).toBeUndefined()
    expect(sessionSet!.data.welcome_message).toBeUndefined()
  })

  // --- Welcome message ---

  it('adds welcome message as first agent message', async () => {
    await POST(makePostRequest({ project_id: 'proj1' }))

    // Should have 2 batch.set() calls: session + welcome message
    expect(batchSets).toHaveLength(2)
    const msgSet = batchSets.find((s) => s.data.role === 'agent')
    expect(msgSet).toBeDefined()
    expect(msgSet!.data.content).toBe('Hello maker!')
    expect(msgSet!.data.role).toBe('agent')
  })

  it('skips welcome message when project has none', async () => {
    mockProjectData = { title: 'No Welcome' }

    await POST(makePostRequest({ project_id: 'proj1' }))

    // Only 1 batch.set() — the session, no message
    expect(batchSets).toHaveLength(1)
    expect(batchSets[0].data.project_id).toBe('proj1')
  })

  // --- Completing old sessions ---

  it('marks active sessions as completed', async () => {
    // Simulate 2 existing active sessions
    mockActiveSessionDocs = [
      { ref: { id: 'old-session-1' } },
      { ref: { id: 'old-session-2' } },
    ]

    await POST(makePostRequest({ project_id: 'proj1' }))

    // batch.update should have been called for each old session
    expect(batchUpdates).toHaveLength(2)
    expect(batchUpdates[0].data.status).toBe('completed')
    expect(batchUpdates[1].data.status).toBe('completed')
  })

  it('commits all operations in a single batch', async () => {
    mockActiveSessionDocs = [{ ref: { id: 'old-1' } }]

    await POST(makePostRequest({ project_id: 'proj1' }))

    // batch.commit() should be called exactly once
    expect(mockBatch.commit).toHaveBeenCalledTimes(1)
  })
})
