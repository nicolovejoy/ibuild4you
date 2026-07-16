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
  return { id: `mock-${lastCollectionName}-id`, update: vi.fn(async () => {}) }
})

const mockSet = vi.fn(async (data: Record<string, unknown>) => {
  if (!setDocs[lastCollectionName]) setDocs[lastCollectionName] = []
  setDocs[lastCollectionName].push({ docId: lastDocId, data })
})

let lastDocId = ''

// Mock .where().limit().get() chain for slug uniqueness check
const mockWhere = vi.fn(() => ({
  limit: vi.fn(() => ({
    get: vi.fn(async () => ({ empty: true })),  // no slug collisions in tests
  })),
}))

const mockCollection = vi.fn((name: string) => {
  lastCollectionName = name
  return {
    add: mockAdd,
    where: mockWhere,
    doc: vi.fn((id: string) => {
      lastDocId = id
      return { set: mockSet, update: vi.fn(async () => {}) }
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

    // Should have created 4 documents: project, member, session, welcome message
    expect(mockAdd).toHaveBeenCalledTimes(4)
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
      requester_email: 'sam@example.com',
      requester_first_name: 'Sam',
      requester_last_name: 'Lee',
    }))

    const members = addedDocs['project_members']
    // Should have 2 members: owner + maker
    expect(members).toHaveLength(2)
    const maker = members.find((m) => m.role === 'maker')
    expect(maker).toBeDefined()
    expect(maker).toMatchObject({
      project_id: 'mock-projects-id',
      email: 'sam@example.com',
      role: 'maker',
    })
    // Names no longer written to project_members (Phase 3)
    expect(maker!.first_name).toBeUndefined()
    expect(maker!.last_name).toBeUndefined()
    // Maker should have a passcode
    expect(maker!.passcode).toBeDefined()
    expect(typeof maker!.passcode).toBe('string')
  })

  // --- Brief role (RAAC Phase 3a) ---

  it('assigns brief_role originator to the maker and null to the owner', async () => {
    await POST(makeRequest({ title: 'Test', requester_email: 'sam@example.com' }))

    const members = addedDocs['project_members']
    const owner = members.find((m) => m.role === 'owner')
    const maker = members.find((m) => m.role === 'maker')
    expect(owner!.brief_role).toBeNull()
    expect(maker!.brief_role).toBe('originator')
  })

  it('honors an explicit brief_role override for the maker', async () => {
    await POST(makeRequest({
      title: 'Test',
      requester_email: 'sam@example.com',
      brief_role: 'contributor',
    }))

    const maker = addedDocs['project_members'].find((m) => m.role === 'maker')
    expect(maker!.brief_role).toBe('contributor')
  })

  it('ignores an invalid brief_role and falls back to the default', async () => {
    await POST(makeRequest({
      title: 'Test',
      requester_email: 'sam@example.com',
      brief_role: 'nonsense',
    }))

    const maker = addedDocs['project_members'].find((m) => m.role === 'maker')
    expect(maker!.brief_role).toBe('originator')
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
      requester_email: 'Sam@Example.com',
    }))

    // Should use doc(email).set(), not add(), so the doc ID is the email
    const approvals = setDocs['approved_emails']
    expect(approvals).toHaveLength(1)
    expect(approvals[0].docId).toBe('sam@example.com')
    expect(approvals[0].data.email).toBe('sam@example.com')
  })

  // --- Multiple participants ---

  it('creates a membership + approval + passcode for each participant', async () => {
    await POST(makeRequest({
      title: 'Team Brief',
      participants: [
        { email: 'a@example.com', first_name: 'A', role: 'maker' },
        { email: 'b@example.com', first_name: 'B', role: 'apprentice' },
        { email: 'c@example.com', role: 'builder' },
      ],
    }))

    const members = addedDocs['project_members']
    // owner + 3 participants
    expect(members).toHaveLength(4)
    const byEmail = (e: string) => members.find((m) => m.email === e)!
    expect(byEmail('a@example.com')).toMatchObject({ role: 'maker', brief_role: 'originator' })
    expect(byEmail('b@example.com')).toMatchObject({ role: 'apprentice', brief_role: 'contributor' })
    expect(byEmail('c@example.com')).toMatchObject({ role: 'builder', brief_role: 'reviewer' })
    for (const e of ['a@example.com', 'b@example.com', 'c@example.com']) {
      expect(typeof byEmail(e).passcode).toBe('string')
    }

    // Each participant email is approved (lowercased doc id)
    const approvals = setDocs['approved_emails'].map((a) => a.docId)
    expect(approvals).toEqual(
      expect.arrayContaining(['a@example.com', 'b@example.com', 'c@example.com'])
    )
  })

  it('returns the participant invite creds in the response', async () => {
    const res = await POST(makeRequest({
      title: 'Team Brief',
      participants: [{ email: 'a@example.com', role: 'maker' }],
    }))
    const data = await res.json()
    expect(data.members).toEqual([
      expect.objectContaining({ email: 'a@example.com', role: 'maker', brief_role: 'originator', passcode: expect.any(String) }),
    ])
  })

  it('stamps the first maker participant as the project requester', async () => {
    const res = await POST(makeRequest({
      title: 'Team Brief',
      participants: [
        { email: 'reviewer@example.com', role: 'builder' },
        { email: 'maker@example.com', first_name: 'Mae', last_name: 'Ker', role: 'maker' },
      ],
    }))
    const data = await res.json()
    expect(data.requester_email).toBe('maker@example.com')
    expect(data.requester_first_name).toBe('Mae')
    expect(data.requester_last_name).toBe('Ker')
    expect(data.shared_at).toBeDefined()
  })

  it('merges legacy requester_email with participants and dedups', async () => {
    await POST(makeRequest({
      title: 'Team Brief',
      requester_email: 'sam@example.com',
      requester_first_name: 'Sam',
      participants: [
        { email: 'Sam@example.com', role: 'maker' }, // dup of requester (case-insensitive)
        { email: 'other@example.com', role: 'apprentice' },
      ],
    }))
    const members = addedDocs['project_members'].filter((m) => m.role !== 'owner')
    const emails = members.map((m) => m.email).sort()
    expect(emails).toEqual(['other@example.com', 'sam@example.com'])
  })

  it('skips a participant whose email is the creator (already the owner)', async () => {
    await POST(makeRequest({
      title: 'Team Brief',
      participants: [{ email: 'nico@ibuild4you.com', role: 'maker' }],
    }))
    const members = addedDocs['project_members']
    expect(members).toHaveLength(1)
    expect(members[0].role).toBe('owner')
  })

  it('normalizes (trim+lowercase) a mixed-case participant email in project_members, not just trims it', async () => {
    // #152 regression: participants[] used to store the trimmed-but-not-
    // lowercased email on project_members, while passcode login and
    // getProjectRole match on a fully normalized email — a mixed-case-only
    // participant could never sign in via passcode.
    await POST(makeRequest({
      title: 'Team Brief',
      participants: [{ email: '  Jamie@Example.COM  ', role: 'maker' }],
    }))

    const member = addedDocs['project_members'].find((m) => m.role === 'maker')!
    expect(member.email).toBe('jamie@example.com')

    const approval = setDocs['approved_emails'].find((a) => a.docId === 'jamie@example.com')
    expect(approval).toBeDefined()
    expect(approval!.data.email).toBe('jamie@example.com')
  })

  it('defaults an unspecified participant role to maker', async () => {
    await POST(makeRequest({
      title: 'Team Brief',
      participants: [{ email: 'a@example.com' }],
    }))
    const member = addedDocs['project_members'].find((m) => m.email === 'a@example.com')!
    expect(member.role).toBe('maker')
    expect(member.brief_role).toBe('originator')
  })

  it('ignores participants with no email and an invalid role', async () => {
    await POST(makeRequest({
      title: 'Team Brief',
      participants: [
        { first_name: 'No Email' },
        { email: '   ' },
        { email: 'ok@example.com', role: 'wizard' }, // invalid role → default maker
      ],
    }))
    const members = addedDocs['project_members'].filter((m) => m.role !== 'owner')
    expect(members).toHaveLength(1)
    expect(members[0]).toMatchObject({ email: 'ok@example.com', role: 'maker' })
  })

  it('rejects more than 20 distinct participants', async () => {
    const participants = Array.from({ length: 21 }, (_, i) => ({ email: `p${i}@example.com` }))
    const res = await POST(makeRequest({ title: 'Crowd', participants }))
    expect(res.status).toBe(400)
    const data = await res.json()
    expect(data.error).toMatch(/participant/i)
  })

  // --- Full setup payload ---

  it('saves all optional setup fields on the project', async () => {
    const res = await POST(makeRequest({
      title: 'Full Setup',
      context: 'Background info',
      requester_first_name: 'Sam',
      requester_last_name: 'Lee',
      requester_email: 'sam@example.com',
      session_mode: 'discover',
      seed_questions: ['What problem are you solving?', 'Who are your users?'],
      builder_directives: ['Push toward single page'],
      welcome_message: 'Hi Sam!',
      layout_mockups: [{ title: 'Layout A', sections: [] }],
    }))

    expect(res.status).toBe(201)
    const data = await res.json()

    // All fields should be in the response
    expect(data.context).toBe('Background info')
    expect(data.requester_first_name).toBe('Sam')
    expect(data.requester_last_name).toBe('Lee')
    expect(data.requester_email).toBe('sam@example.com')
    expect(data.session_mode).toBe('discover')
    expect(data.seed_questions).toEqual(['What problem are you solving?', 'Who are your users?'])
    expect(data.builder_directives).toEqual(['Push toward single page'])
    expect(data.welcome_message).toBe('Hi Sam!')
    expect(data.layout_mockups).toEqual([{ title: 'Layout A', sections: [] }])
  })

  it('saves nudge_message and voice_sample on the project', async () => {
    const res = await POST(makeRequest({
      title: 'With Nudge Setup',
      nudge_message: 'Hey — quick check-in, two questions when you have a sec.',
      voice_sample: 'I write short. No emoji. Mostly questions.',
    }))

    expect(res.status).toBe(201)
    const data = await res.json()
    expect(data.nudge_message).toBe('Hey — quick check-in, two questions when you have a sec.')
    expect(data.voice_sample).toBe('I write short. No emoji. Mostly questions.')
  })

  it('does not snapshot nudge_message or voice_sample onto the session', async () => {
    // These are project-level outbound copy fields, not session-scoped agent config.
    await POST(makeRequest({
      title: 'Test',
      nudge_message: 'override',
      voice_sample: 'voice anchor',
    }))

    const sessions = addedDocs['sessions']
    expect(sessions[0].nudge_message).toBeUndefined()
    expect(sessions[0].voice_sample).toBeUndefined()
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

  // --- Brief seeding ---

  it('seeds the initial brief and preserves open_risks', async () => {
    await POST(makeRequest({
      title: 'With Brief',
      brief: {
        problem: 'no online ordering',
        target_users: 'cafe customers',
        features: ['catalog', 'checkout'],
        constraints: 'mobile-first',
        additional_context: '',
        decisions: [{ topic: 'payments', decision: 'Stripe only' }],
        open_risks: ['unclear how inventory syncs', 'no plan for refunds'],
      },
    }))

    const briefs = addedDocs['briefs']
    expect(briefs).toHaveLength(1)
    expect(briefs[0].content).toMatchObject({
      problem: 'no online ordering',
      target_users: 'cafe customers',
      features: ['catalog', 'checkout'],
      constraints: 'mobile-first',
      decisions: [{ topic: 'payments', decision: 'Stripe only' }],
      open_risks: ['unclear how inventory syncs', 'no plan for refunds'],
    })
  })

  it('filters non-string open_risks entries when seeding', async () => {
    await POST(makeRequest({
      title: 'Risks Test',
      brief: {
        problem: 'p',
        open_risks: ['valid risk', 42, '', null, 'another valid'],
      },
    }))

    const briefs = addedDocs['briefs']
    expect(briefs[0].content).toMatchObject({
      open_risks: ['valid risk', 'another valid'],
    })
  })
})
