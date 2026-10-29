import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextResponse } from 'next/server'

// GET/POST /api/briefs/notes. The note writer and notes store are mocked so
// these tests cover auth, role gating, error mapping and the breaker reset.

const mockWriteNote = vi.fn()
const mockListUnfolded = vi.fn()
const mockGetProjectRole = vi.fn()
const mockUpdate = vi.fn(async () => {})
let briefDocs: { id: string; data: () => Record<string, unknown> }[] = []

const mockCollection = vi.fn((name: string) => {
  if (name === 'briefs') {
    return {
      where: () => ({
        orderBy: () => ({
          limit: () => ({
            get: async () => ({ docs: briefDocs, empty: briefDocs.length === 0 }),
          }),
        }),
      }),
    }
  }
  return { doc: vi.fn(() => ({ update: mockUpdate })) }
})

let authResult: Record<string, unknown>

vi.mock('@/lib/api/firebase-server-helpers', () => ({
  getAuthenticatedUser: vi.fn(async () => authResult),
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

vi.mock('@/lib/api/note-writer', () => ({
  writeNoteForProject: (...args: unknown[]) => mockWriteNote(...args),
}))

vi.mock('@/lib/api/brief-notes', () => ({
  listUnfoldedNotes: (...args: unknown[]) => mockListUnfolded(...args),
}))

import { GET, POST } from '../route'

const postReq = (body: unknown) =>
  new Request('http://localhost/api/briefs/notes', { method: 'POST', body: JSON.stringify(body) })
const getReq = (qs = '?project_id=p1') => new Request(`http://localhost/api/briefs/notes${qs}`)

beforeEach(() => {
  vi.clearAllMocks()
  authResult = { uid: 'u1', email: 'b@ibuild4you.com', systemRoles: [], error: null }
  mockGetProjectRole.mockResolvedValue('builder')
  mockWriteNote.mockResolvedValue({ note_id: 'n1', covered: 4, through: '2026-10-29T00:00:00.000Z' })
  mockListUnfolded.mockResolvedValue([])
  briefDocs = []
})

describe('GET /api/briefs/notes', () => {
  it('returns unfolded notes and the live brief version', async () => {
    briefDocs = [{ id: 'b1', data: () => ({ version: 5 }) }]
    mockListUnfolded.mockResolvedValue([{ id: 'n1', text: 'hi' }])
    const res = await GET(getReq())
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ brief_id: 'b1', brief_version: 5, notes: [{ id: 'n1', text: 'hi' }] })
    expect(mockListUnfolded).toHaveBeenCalledWith(expect.anything(), 'b1')
  })

  it('returns version 0 and [] with no brief', async () => {
    const res = await GET(getReq())
    expect(await res.json()).toEqual({ brief_id: null, brief_version: 0, notes: [] })
    expect(mockListUnfolded).not.toHaveBeenCalled()
  })

  it('403 for a maker', async () => {
    mockGetProjectRole.mockResolvedValue('maker')
    expect((await GET(getReq())).status).toBe(403)
  })

  it('400 without project_id', async () => {
    expect((await GET(getReq(''))).status).toBe(400)
  })

  it('returns the auth error when unauthenticated', async () => {
    authResult = { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
    expect((await GET(getReq())).status).toBe(401)
  })
})

describe('POST /api/briefs/notes', () => {
  it('403 for a maker', async () => {
    mockGetProjectRole.mockResolvedValue('maker')
    const res = await POST(postReq({ project_id: 'p1' }))
    expect(res.status).toBe(403)
    expect(mockWriteNote).not.toHaveBeenCalled()
  })

  it('400 without project_id', async () => {
    expect((await POST(postReq({}))).status).toBe(400)
  })

  it('400 when nothing is new', async () => {
    mockWriteNote.mockRejectedValue(new Error('write_note_no_messages'))
    const res = await POST(postReq({ project_id: 'p1' }))
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'Nothing new since the last note' })
    expect(mockUpdate).not.toHaveBeenCalled()
  })

  it('500 on an unexpected error', async () => {
    mockWriteNote.mockRejectedValue(new Error('boom'))
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect((await POST(postReq({ project_id: 'p1' }))).status).toBe(500)
    spy.mockRestore()
  })

  it('clears breaker fields on success', async () => {
    const res = await POST(postReq({ project_id: 'p1' }))
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ note_id: 'n1', covered: 4 })
    expect(mockWriteNote).toHaveBeenCalledWith(expect.anything(), 'p1')
    expect(mockUpdate).toHaveBeenCalledWith({
      brief_regen_failures: 0,
      brief_regen_failures_since: null,
      brief_regen_last_error: null,
    })
  })
})
