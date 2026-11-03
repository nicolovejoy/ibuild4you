import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextResponse } from 'next/server'
import { FieldValue } from 'firebase-admin/firestore'
import { GET, DELETE, PATCH } from '../route'

// =============================================================================
// MESSAGE ROUTE TESTS
//
// GET /api/messages?session_id=xxx
//   Looks up the session to find its project, checks the user has a role,
//   then returns all messages ordered by created_at ascending.
//
// DELETE /api/messages?message_id=xxx
//   Traverses message → session → project to verify builder role,
//   then deletes the message. This chain is a common pattern:
//   the test needs to return different data depending on which
//   collection/doc is being queried.
//
// New concept here: the mock uses the COLLECTION NAME to decide what
// data to return. When the route calls db.collection('sessions').doc(id).get(),
// we return session data. When it calls db.collection('messages').doc(id).get(),
// we return message data. One mock handles both via a lookup table.
// =============================================================================

const mockGetProjectRole = vi.fn()
const mockDelete = vi.fn(async () => {})
const mockUpdate = vi.fn(async () => {})
// Updates to the project doc (the 👎 counter) are kept apart from message updates.
const mockProjectUpdate = vi.fn(async () => {})

// Data returned by doc(id).get() — keyed by collection name
let docData: Record<string, { exists: boolean; data: () => Record<string, unknown> }>

// Data returned by collection().where().orderBy().get()
let queryDocs: { id: string; data: () => Record<string, unknown> }[]

const mockGet = vi.fn(async () => ({ docs: queryDocs }))
const mockOrderBy = vi.fn(() => ({ get: mockGet }))
const mockWhere = vi.fn(() => ({ orderBy: mockOrderBy }))

// This mock figures out which collection is being queried and returns
// the right doc data. It captures the collection name from the last call.
let lastCollection = ''
const mockCollection = vi.fn((name: string) => {
  lastCollection = name
  return {
    where: mockWhere,
    doc: vi.fn(() => ({
      get: vi.fn(async () => docData[name] || { exists: false }),
      delete: mockDelete,
      update: name === 'projects' ? mockProjectUpdate : mockUpdate,
    })),
  }
})

vi.mock('@/lib/api/firebase-server-helpers', () => ({
  getAuthenticatedUser: vi.fn(async () => ({
    uid: 'user-123',
    email: 'user@ibuild4you.com',
    error: null,
  })),
  getAdminDb: vi.fn(() => ({
    collection: mockCollection,
    // Transactions run against the same doc mocks: tx.get/update/delete
    // forward to the ref's own get/update/delete.
    runTransaction: async (fn: (tx: unknown) => Promise<unknown>) =>
      fn({
        get: (ref: { get: () => Promise<unknown> }) => ref.get(),
        update: (ref: { update: (d: unknown) => Promise<unknown> }, d: unknown) => ref.update(d),
        delete: (ref: { delete: () => Promise<unknown> }) => ref.delete(),
      }),
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

describe('GET /api/messages', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetProjectRole.mockResolvedValue('maker')
    docData = {
      sessions: {
        exists: true,
        data: () => ({ project_id: 'proj1' }),
      },
    }
    queryDocs = []
  })

  it('returns 400 when session_id is missing', async () => {
    const req = new Request('http://localhost/api/messages')
    const res = await GET(req)
    expect(res.status).toBe(400)
  })

  it('returns 404 when session does not exist', async () => {
    docData = { sessions: { exists: false, data: () => ({}) } }
    const req = new Request('http://localhost/api/messages?session_id=s1')
    const res = await GET(req)
    expect(res.status).toBe(404)
  })

  it('returns 404 when user has no role on the project', async () => {
    mockGetProjectRole.mockResolvedValue(null)
    const req = new Request('http://localhost/api/messages?session_id=s1')
    const res = await GET(req)
    expect(res.status).toBe(404)
  })

  it('returns messages for a valid session', async () => {
    queryDocs = [
      { id: 'm1', data: () => ({ role: 'agent', content: 'Hello!', created_at: '2026-01-01T00:00:00Z' }) },
      { id: 'm2', data: () => ({ role: 'user', content: 'Hi!', created_at: '2026-01-01T00:01:00Z' }) },
    ]

    const req = new Request('http://localhost/api/messages?session_id=s1')
    const res = await GET(req)
    expect(res.status).toBe(200)

    const data = await res.json()
    expect(data).toHaveLength(2)
    expect(data[0].id).toBe('m1')
    expect(data[1].content).toBe('Hi!')
  })

  it('allows makers to read messages', async () => {
    mockGetProjectRole.mockResolvedValue('maker')
    const req = new Request('http://localhost/api/messages?session_id=s1')
    const res = await GET(req)
    expect(res.status).toBe(200)
  })
})

describe('DELETE /api/messages', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetProjectRole.mockResolvedValue('builder')
    docData = {
      messages: {
        exists: true,
        data: () => ({ session_id: 'session-1', role: 'agent', content: 'Hello' }),
      },
      sessions: {
        exists: true,
        data: () => ({ project_id: 'proj1' }),
      },
    }
  })

  it('returns 400 when message_id is missing', async () => {
    const req = new Request('http://localhost/api/messages', { method: 'DELETE' })
    const res = await DELETE(req)
    expect(res.status).toBe(400)
  })

  it('returns 404 when message does not exist', async () => {
    docData = {
      ...docData,
      messages: { exists: false, data: () => ({}) },
    }
    const req = new Request('http://localhost/api/messages?message_id=m1', { method: 'DELETE' })
    const res = await DELETE(req)
    expect(res.status).toBe(404)
  })

  it('returns 403 when caller is a maker', async () => {
    mockGetProjectRole.mockResolvedValue('maker')
    const req = new Request('http://localhost/api/messages?message_id=m1', { method: 'DELETE' })
    const res = await DELETE(req)
    expect(res.status).toBe(403)
  })

  it('deletes the message and returns success', async () => {
    const req = new Request('http://localhost/api/messages?message_id=m1', { method: 'DELETE' })
    const res = await DELETE(req)
    expect(res.status).toBe(200)

    const data = await res.json()
    expect(data.deleted).toBe(true)
    expect(data.message_id).toBe('m1')
    expect(mockDelete).toHaveBeenCalledTimes(1)
    expect(mockProjectUpdate).not.toHaveBeenCalled()
  })

  it('deleting a 👎 reply takes one off the brief counter', async () => {
    docData = {
      ...docData,
      messages: { exists: true, data: () => ({ session_id: 'session-1', role: 'agent', rating: 'down' }) },
    }
    const res = await DELETE(new Request('http://localhost/api/messages?message_id=m1', { method: 'DELETE' }))
    expect(res.status).toBe(200)
    expect(mockProjectUpdate).toHaveBeenCalledWith({ thumbs_down_count: FieldValue.increment(-1) })
  })
})

// PATCH /api/messages — maker rates an agent message (#130). Any member may
// rate; only agent messages are ratable; rating is up | down | null (clear).
describe('PATCH /api/messages', () => {
  const patchReq = (body: unknown) =>
    new Request('http://localhost/api/messages', { method: 'PATCH', body: JSON.stringify(body) })

  beforeEach(() => {
    vi.clearAllMocks()
    mockGetProjectRole.mockResolvedValue('maker')
    docData = {
      messages: {
        exists: true,
        data: () => ({ session_id: 'session-1', role: 'agent', content: 'Hello' }),
      },
      sessions: {
        exists: true,
        data: () => ({ project_id: 'proj1' }),
      },
    }
  })

  it('returns 400 when message_id is missing', async () => {
    const res = await PATCH(patchReq({ rating: 'up' }))
    expect(res.status).toBe(400)
  })

  it('returns 400 on an invalid rating value', async () => {
    const res = await PATCH(patchReq({ message_id: 'm1', rating: 'meh' }))
    expect(res.status).toBe(400)
  })

  it('returns 400 on invalid JSON body', async () => {
    const req = new Request('http://localhost/api/messages', { method: 'PATCH', body: 'not json' })
    const res = await PATCH(req)
    expect(res.status).toBe(400)
  })

  it('returns 404 when message does not exist', async () => {
    docData = { ...docData, messages: { exists: false, data: () => ({}) } }
    const res = await PATCH(patchReq({ message_id: 'm1', rating: 'up' }))
    expect(res.status).toBe(404)
  })

  it('returns 404 when user has no role on the project', async () => {
    mockGetProjectRole.mockResolvedValue(null)
    const res = await PATCH(patchReq({ message_id: 'm1', rating: 'up' }))
    expect(res.status).toBe(404)
  })

  it('returns 400 when rating a user message', async () => {
    docData = {
      ...docData,
      messages: { exists: true, data: () => ({ session_id: 'session-1', role: 'user', content: 'Hi' }) },
    }
    const res = await PATCH(patchReq({ message_id: 'm1', rating: 'up' }))
    expect(res.status).toBe(400)
  })

  it('makers can rate an agent message up', async () => {
    const res = await PATCH(patchReq({ message_id: 'm1', rating: 'up' }))
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data).toEqual({ message_id: 'm1', rating: 'up' })
    expect(mockUpdate).toHaveBeenCalledWith(expect.objectContaining({ rating: 'up' }))
  })

  it('rating down works too', async () => {
    const res = await PATCH(patchReq({ message_id: 'm1', rating: 'down' }))
    expect(res.status).toBe(200)
    expect(mockUpdate).toHaveBeenCalledWith(expect.objectContaining({ rating: 'down' }))
  })

  it('null clears the rating', async () => {
    const res = await PATCH(patchReq({ message_id: 'm1', rating: null }))
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data).toEqual({ message_id: 'm1', rating: null })
    expect(mockUpdate).toHaveBeenCalledWith(expect.objectContaining({ rating: null }))
  })

  // What was off? (optional reason on a 👎) and the brief's 👎 counter.
  it('stores a trimmed reason with a 👎', async () => {
    const res = await PATCH(patchReq({ message_id: 'm1', rating: 'down', reason: '  too many questions  ' }))
    expect(res.status).toBe(200)
    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ rating: 'down', rating_reason: 'too many questions' })
    )
  })

  it('a blank reason is stored as null', async () => {
    await PATCH(patchReq({ message_id: 'm1', rating: 'down', reason: '   ' }))
    expect(mockUpdate).toHaveBeenCalledWith(expect.objectContaining({ rating_reason: null }))
  })

  it('a 👍 or a cleared rating drops any reason', async () => {
    await PATCH(patchReq({ message_id: 'm1', rating: 'up', reason: 'ignored' }))
    expect(mockUpdate).toHaveBeenLastCalledWith(expect.objectContaining({ rating: 'up', rating_reason: null }))
    await PATCH(patchReq({ message_id: 'm1', rating: null }))
    expect(mockUpdate).toHaveBeenLastCalledWith(expect.objectContaining({ rating: null, rating_reason: null }))
  })

  it('returns 400 on a reason that is not a string or is over 500 characters', async () => {
    expect((await PATCH(patchReq({ message_id: 'm1', rating: 'down', reason: 42 }))).status).toBe(400)
    expect((await PATCH(patchReq({ message_id: 'm1', rating: 'down', reason: 'x'.repeat(501) }))).status).toBe(400)
    expect(mockUpdate).not.toHaveBeenCalled()
  })

  it('a new 👎 adds one to the brief counter', async () => {
    await PATCH(patchReq({ message_id: 'm1', rating: 'down' }))
    expect(mockProjectUpdate).toHaveBeenCalledWith({ thumbs_down_count: FieldValue.increment(1) })
  })

  it('moving off a 👎 takes one off the brief counter', async () => {
    docData = {
      ...docData,
      messages: { exists: true, data: () => ({ session_id: 'session-1', role: 'agent', rating: 'down' }) },
    }
    await PATCH(patchReq({ message_id: 'm1', rating: 'up' }))
    expect(mockProjectUpdate).toHaveBeenCalledWith({ thumbs_down_count: FieldValue.increment(-1) })
  })

  it('re-sending a 👎 with a reason leaves the counter alone', async () => {
    docData = {
      ...docData,
      messages: { exists: true, data: () => ({ session_id: 'session-1', role: 'agent', rating: 'down' }) },
    }
    await PATCH(patchReq({ message_id: 'm1', rating: 'down', reason: 'off topic' }))
    expect(mockProjectUpdate).not.toHaveBeenCalled()
  })

  it('counts from the rating as read inside the transaction, not the earlier read', async () => {
    // The first read (access check) still sees no rating; by the time the
    // transaction reads, the 👎 from a moment ago has landed.
    let reads = 0
    Object.defineProperty(docData, 'messages', {
      enumerable: true,
      get: () => {
        const rating = reads++ === 0 ? undefined : 'down'
        return { exists: true, data: () => ({ session_id: 'session-1', role: 'agent', rating }) }
      },
    })
    await PATCH(patchReq({ message_id: 'm1', rating: 'down', reason: 'off topic' }))
    expect(mockProjectUpdate).not.toHaveBeenCalled()
  })

  it('a 👍 leaves the counter alone', async () => {
    await PATCH(patchReq({ message_id: 'm1', rating: 'up' }))
    expect(mockProjectUpdate).not.toHaveBeenCalled()
  })
})
