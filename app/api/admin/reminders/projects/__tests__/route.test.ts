import { describe, it, expect, vi, beforeEach } from 'vitest'
import { GET } from '../route'

// Tests for GET /api/admin/reminders/projects — admin-only list of
// reminder-eligible projects (those with a maker email) + their auto-reminder
// toggle state, used by the /admin/reminders dashboard toggle.

const mockGetAuthenticatedUser = vi.fn()
const mockHasSystemRole = vi.fn()
const mockGet = vi.fn()

vi.mock('@/lib/api/firebase-server-helpers', () => ({
  getAuthenticatedUser: (req: Request) => mockGetAuthenticatedUser(req),
  hasSystemRole: (auth: unknown, role: string) => mockHasSystemRole(auth, role),
  getAdminDb: () => ({
    collection: () => ({ get: mockGet }),
  }),
}))

const adminAuth = { uid: 'u1', email: 'admin@x.com', systemRoles: ['admin'], error: null }

beforeEach(() => {
  vi.clearAllMocks()
  mockGetAuthenticatedUser.mockResolvedValue(adminAuth)
  mockHasSystemRole.mockReturnValue(true)
})

function makeReq() {
  return new Request('http://localhost/api/admin/reminders/projects')
}

describe('GET /api/admin/reminders/projects', () => {
  it('returns 401 when unauthenticated', async () => {
    mockGetAuthenticatedUser.mockResolvedValueOnce({
      error: new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 }),
    })
    const res = await GET(makeReq())
    expect(res.status).toBe(401)
  })

  it('returns 403 for non-admins', async () => {
    mockHasSystemRole.mockReturnValueOnce(false)
    const res = await GET(makeReq())
    expect(res.status).toBe(403)
  })

  it('lists only projects with a maker email, sorted by title, with toggle state', async () => {
    mockGet.mockResolvedValueOnce({
      docs: [
        {
          id: 'p2',
          data: () => ({
            title: 'Zebra App',
            requester_email: 'z@x.com',
            auto_reminders_enabled: true,
            reminders_sent_count: 2,
            last_reminder_sent_at: '2026-06-01T00:00:00Z',
          }),
        },
        {
          id: 'p1',
          data: () => ({
            title: 'Apple App',
            requester_email: 'a@x.com',
            auto_reminders_enabled: false,
          }),
        },
        // No maker email — excluded.
        { id: 'p3', data: () => ({ title: 'No Maker' }) },
      ],
    })
    const res = await GET(makeReq())
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.projects).toHaveLength(2)
    // Sorted by title: Apple before Zebra.
    expect(body.projects[0]).toMatchObject({
      id: 'p1',
      title: 'Apple App',
      requester_email: 'a@x.com',
      auto_reminders_enabled: false,
      reminders_sent_count: 0,
    })
    expect(body.projects[1]).toMatchObject({
      id: 'p2',
      auto_reminders_enabled: true,
      reminders_sent_count: 2,
      last_reminder_sent_at: '2026-06-01T00:00:00Z',
    })
  })

  it('coerces a missing auto_reminders_enabled to false', async () => {
    mockGet.mockResolvedValueOnce({
      docs: [{ id: 'p1', data: () => ({ title: 'X', requester_email: 'a@x.com' }) }],
    })
    const res = await GET(makeReq())
    const body = await res.json()
    expect(body.projects[0].auto_reminders_enabled).toBe(false)
  })
})
