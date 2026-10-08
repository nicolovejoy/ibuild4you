import { describe, it, expect, vi, beforeEach } from 'vitest'
import { GET } from '../[id]/usage/route'
import { PROJECT_USAGE_MAX_ROWS } from '@/lib/api/project-usage'

// Chainable Firestore mock: api_usage → where().limit().get(), sessions → where().get()
const mockUsageGet = vi.fn()
const mockSessionsGet = vi.fn()
const mockLimit = vi.fn(() => ({ get: mockUsageGet }))
const mockCollection = vi.fn((name: string) => ({
  where: () =>
    name === 'api_usage' ? { limit: mockLimit } : { get: mockSessionsGet },
}))

let systemRoles: string[] = ['admin']

vi.mock('@/lib/api/firebase-server-helpers', () => ({
  getAuthenticatedUser: vi.fn(async () => ({
    uid: 'u1',
    email: 'a@example.com',
    error: null,
    systemRoles,
  })),
  getAdminDb: vi.fn(() => ({ collection: mockCollection })),
  hasSystemRole: (auth: { systemRoles: string[] }, role: string) =>
    auth.systemRoles.includes(role),
}))

const req = () => new Request('http://localhost/api/projects/proj1/usage')
const ctx = { params: Promise.resolve({ id: 'proj1' }) }

function usageDoc(session_id: string | null) {
  return {
    data: () => ({
      route: 'chat',
      session_id,
      project_id: 'proj1',
      model: 'claude-sonnet-4-6',
      input_tokens: 1,
      output_tokens: 1,
      cache_read_tokens: 0,
      cache_creation_tokens: 0,
      created_at: '2026-10-01T17:00:00.000Z',
    }),
  }
}

describe('GET /api/projects/[id]/usage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    systemRoles = ['admin']
    mockSessionsGet.mockResolvedValue({ docs: [] })
  })

  it('returns 403 for a non-admin and never touches Firestore', async () => {
    systemRoles = []
    const res = await GET(req(), ctx)
    expect(res.status).toBe(403)
    expect(mockCollection).not.toHaveBeenCalled()
  })

  it('flags truncation and rolls up only the capped rows', async () => {
    const docs = Array.from({ length: PROJECT_USAGE_MAX_ROWS + 1 }, () => usageDoc(null))
    mockUsageGet.mockResolvedValue({ docs, size: docs.length })
    const res = await GET(req(), ctx)
    const body = await res.json()
    expect(mockLimit).toHaveBeenCalledWith(PROJECT_USAGE_MAX_ROWS + 1)
    expect(body.truncated).toBe(true)
    expect(body.total_calls).toBe(PROJECT_USAGE_MAX_ROWS)
  })

  it('does not flag a brief with exactly the cap', async () => {
    const docs = Array.from({ length: PROJECT_USAGE_MAX_ROWS }, () => usageDoc(null))
    mockUsageGet.mockResolvedValue({ docs, size: docs.length })
    const body = await (await GET(req(), ctx)).json()
    expect(body.truncated).toBe(false)
  })

  it('labels archived sessions and numbers the rest', async () => {
    mockSessionsGet.mockResolvedValue({
      docs: [
        { id: 'sA', data: () => ({ created_at: '2026-09-01T00:00:00Z', status: 'archived' }) },
        { id: 'sB', data: () => ({ created_at: '2026-09-02T00:00:00Z', status: 'active' }) },
      ],
    })
    const docs = [usageDoc('sA'), usageDoc('sB')]
    mockUsageGet.mockResolvedValue({ docs, size: docs.length })
    const body = await (await GET(req(), ctx)).json()
    const a = body.by_session.find((s: { key: string }) => s.key === 'sA')
    const b = body.by_session.find((s: { key: string }) => s.key === 'sB')
    expect(a.label).toBe('Conversation (archived)')
    expect(a.number).toBeNull()
    expect(b.label).toBe('Conversation 1')
  })
})
