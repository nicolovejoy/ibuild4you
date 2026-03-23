import { describe, it, expect, vi, beforeEach } from 'vitest'
import { POST } from '../route'

// =============================================================================
// HOW THIS TEST FILE WORKS
//
// We're testing the POST /api/projects API route. The route does three things:
//   1. Authenticates the user (via Firebase token)
//   2. Creates a project document in Firestore
//   3. Creates an owner membership + first session in Firestore
//
// We can't hit real Firebase in tests, so we MOCK the dependencies:
//   - getAuthenticatedUser → returns a fake authenticated user
//   - getAdminDb → returns a fake Firestore that records what was written
//
// vi.mock() replaces the real module with our fake. When the route calls
// getAdminDb(), it gets our mock instead of real Firestore.
// =============================================================================

// Track every document that gets "added" or "set" to each collection.
const addedDocs: Record<string, Record<string, unknown>[]> = {}
// Track doc().set() calls separately (keyed by collection, stores {docId, data})
const setDocs: Record<string, { docId: string; data: Record<string, unknown> }[]> = {}

let lastCollectionName = ''

const mockAdd = vi.fn(async (data: Record<string, unknown>) => {
  if (!addedDocs[lastCollectionName]) addedDocs[lastCollectionName] = []
  addedDocs[lastCollectionName].push(data)
  return { id: `mock-${lastCollectionName}-id` }
})

const mockSet = vi.fn(async (data: Record<string, unknown>) => {
  if (!setDocs[lastCollectionName]) setDocs[lastCollectionName] = []
  setDocs[lastCollectionName].push({ docId: lastDocId, data })
})

let lastDocId = ''

const mockCollection = vi.fn((name: string) => {
  lastCollectionName = name
  return {
    add: mockAdd,
    doc: vi.fn((id: string) => {
      lastDocId = id
      return { set: mockSet }
    }),
  }
})

vi.mock('@/lib/api/firebase-server-helpers', () => ({
  // Every request is "authenticated" as this fake user
  getAuthenticatedUser: vi.fn(async () => ({
    uid: 'user-123',
    email: 'nico@ibuild4you.com',
    error: null,
  })),
  getAdminDb: vi.fn(() => ({
    collection: mockCollection,
  })),
}))

// Helper: create a POST request with a JSON body
function makeRequest(body: Record<string, unknown>) {
  return new Request('http://localhost/api/projects', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

describe('POST /api/projects', () => {
  beforeEach(() => {
    // Reset all mocks and tracked documents between tests.
    // Without this, data from test 1 leaks into test 2.
    vi.clearAllMocks()
    for (const key of Object.keys(addedDocs)) delete addedDocs[key]
    for (const key of Object.keys(setDocs)) delete setDocs[key]
  })

  // --- Validation ---

  it('returns 400 when title is missing', async () => {
    const res = await POST(makeRequest({}))
    expect(res.status).toBe(400)
    const data = await res.json()
    expect(data.error).toBe('Title is required')
  })

  it('returns 400 when title is empty string', async () => {
    const res = await POST(makeRequest({ title: '   ' }))
    expect(res.status).toBe(400)
  })

  // --- Basic creation ---

  it('creates project with just a title', async () => {
    const res = await POST(makeRequest({ title: 'Test Project' }))
    expect(res.status).toBe(201)

    const data = await res.json()
    expect(data.title).toBe('Test Project')
    expect(data.status).toBe('active')
    expect(data.id).toBe('mock-projects-id')
    expect(data.session_id).toBe('mock-sessions-id')

    // Should have created 3 documents: project, member, session
    expect(mockAdd).toHaveBeenCalledTimes(3)
  })

  it('creates owner membership for the creator', async () => {
    await POST(makeRequest({ title: 'Test' }))

    const members = addedDocs['project_members']
    expect(members).toHaveLength(1)
    expect(members[0]).toMatchObject({
      project_id: 'mock-projects-id',
      user_id: 'user-123',
      email: 'nico@ibuild4you.com',
      role: 'owner',
    })
  })

  it('creates first session linked to the project', async () => {
    await POST(makeRequest({ title: 'Test' }))

    const sessions = addedDocs['sessions']
    expect(sessions).toHaveLength(1)
    expect(sessions[0]).toMatchObject({
      project_id: 'mock-projects-id',
      status: 'active',
    })
  })

  it('creates maker membership when requester_email is provided', async () => {
    await POST(makeRequest({
      title: 'Test',
      requester_email: 'jamie@example.com',
      requester_first_name: 'Jamie',
      requester_last_name: 'Baker',
    }))

    const members = addedDocs['project_members']
    // Should have 2 members: owner + maker
    expect(members).toHaveLength(2)
    const maker = members.find((m) => m.role === 'maker')
    expect(maker).toBeDefined()
    expect(maker).toMatchObject({
      project_id: 'mock-projects-id',
      email: 'jamie@example.com',
      role: 'maker',
      first_name: 'Jamie',
      last_name: 'Baker',
    })
    // Maker should have a passcode
    expect(maker!.passcode).toBeDefined()
    expect(typeof maker!.passcode).toBe('string')
  })

  it('does not create maker membership when requester_email is missing', async () => {
    await POST(makeRequest({ title: 'Test' }))

    const members = addedDocs['project_members']
    // Only the owner
    expect(members).toHaveLength(1)
    expect(members[0].role).toBe('owner')
  })

  it('approves the maker email using the email as doc ID', async () => {
    await POST(makeRequest({
      title: 'Test',
      requester_email: 'Jamie@Example.com',
    }))

    // Should use doc(email).set(), not add(), so the doc ID is the email
    const approvals = setDocs['approved_emails']
    expect(approvals).toHaveLength(1)
    expect(approvals[0].docId).toBe('jamie@example.com')
    expect(approvals[0].data.email).toBe('jamie@example.com')
  })

  // --- Full setup payload ---

  it('saves all optional setup fields on the project', async () => {
    const res = await POST(makeRequest({
      title: 'Full Setup',
      context: 'Background info',
      requester_first_name: 'Jamie',
      requester_last_name: 'Baker',
      requester_email: 'jamie@example.com',
      session_mode: 'discover',
      seed_questions: ['What problem are you solving?', 'Who are your users?'],
      builder_directives: ['Push toward single page'],
      welcome_message: 'Hi Jamie!',
      layout_mockups: [{ title: 'Layout A', sections: [] }],
    }))

    expect(res.status).toBe(201)
    const data = await res.json()

    // All fields should be in the response
    expect(data.context).toBe('Background info')
    expect(data.requester_first_name).toBe('Jamie')
    expect(data.requester_last_name).toBe('Baker')
    expect(data.requester_email).toBe('jamie@example.com')
    expect(data.session_mode).toBe('discover')
    expect(data.seed_questions).toEqual(['What problem are you solving?', 'Who are your users?'])
    expect(data.builder_directives).toEqual(['Push toward single page'])
    expect(data.welcome_message).toBe('Hi Jamie!')
    expect(data.layout_mockups).toEqual([{ title: 'Layout A', sections: [] }])
  })

  it('snapshots config fields onto the first session', async () => {
    await POST(makeRequest({
      title: 'With Config',
      session_mode: 'converge',
      seed_questions: ['Q1'],
      builder_directives: ['D1'],
      welcome_message: 'Hello!',
      layout_mockups: [{ title: 'Mock', sections: [] }],
    }))

    const sessions = addedDocs['sessions']
    expect(sessions).toHaveLength(1)
    expect(sessions[0]).toMatchObject({
      session_mode: 'converge',
      seed_questions: ['Q1'],
      builder_directives: ['D1'],
      welcome_message: 'Hello!',
      layout_mockups: [{ title: 'Mock', sections: [] }],
    })
  })

  // --- Field validation / sanitization ---

  it('trims whitespace from string fields', async () => {
    const res = await POST(makeRequest({
      title: '  Trimmed Title  ',
      context: '  some context  ',
    }))

    const data = await res.json()
    expect(data.title).toBe('Trimmed Title')
    expect(data.context).toBe('some context')
  })

  it('ignores empty optional string fields', async () => {
    const res = await POST(makeRequest({
      title: 'Test',
      context: '   ',        // whitespace-only → ignored
      requester_email: '',   // empty → ignored
    }))

    const data = await res.json()
    expect(data.context).toBeUndefined()
    expect(data.requester_email).toBeUndefined()
  })

  it('ignores invalid session_mode values', async () => {
    const res = await POST(makeRequest({
      title: 'Test',
      session_mode: 'invalid',
    }))

    const data = await res.json()
    expect(data.session_mode).toBeUndefined()
  })

  it('filters non-string values from seed_questions', async () => {
    const res = await POST(makeRequest({
      title: 'Test',
      seed_questions: ['Valid question', 42, '', null, 'Another valid one'],
    }))

    const data = await res.json()
    expect(data.seed_questions).toEqual(['Valid question', 'Another valid one'])
  })

  it('does not include empty arrays in project data', async () => {
    const res = await POST(makeRequest({
      title: 'Test',
      seed_questions: [],
      builder_directives: [],
      layout_mockups: [],
    }))

    const data = await res.json()
    expect(data.seed_questions).toBeUndefined()
    expect(data.builder_directives).toBeUndefined()
    expect(data.layout_mockups).toBeUndefined()
  })

  it('does not snapshot config fields onto session when none provided', async () => {
    await POST(makeRequest({ title: 'Bare Project' }))

    const sessions = addedDocs['sessions']
    expect(sessions[0].session_mode).toBeUndefined()
    expect(sessions[0].seed_questions).toBeUndefined()
    expect(sessions[0].welcome_message).toBeUndefined()
  })
})
