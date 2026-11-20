import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextResponse } from 'next/server'

// POST /api/projects/email-in: mints the project's email address once.
// Firestore and the role helpers are mocked; the address module is real,
// except randomTail, which the collision tests need to control.

const mockGetProjectRole = vi.fn()
// A write merges into projectData, so a later read sees it (as Firestore would).
const mockUpdate = vi.fn(async (data: Record<string, unknown>) => {
  projectData = { ...projectData, ...data }
})
const mockTail = vi.fn()
let projectData: Record<string, unknown> | undefined
let takenAddresses: string[] = []

const mockCollection = vi.fn((name: string) => {
  if (name !== 'projects') throw new Error(`unexpected collection ${name}`)
  return {
    doc: vi.fn(() => ({
      get: async () => ({ exists: projectData !== undefined, data: () => projectData }),
      update: mockUpdate,
    })),
    where: (_field: string, _op: string, value: string) => ({
      limit: () => ({
        get: async () => ({ empty: !takenAddresses.includes(value) }),
      }),
    }),
  }
})

// Transactions run one at a time, as Firestore serializes conflicting ones
// (it retries the loser, which then re-reads). That is what lets the
// concurrent test see a real race.
let txChain: Promise<unknown> = Promise.resolve()
type MockRef = { get: () => Promise<unknown>; update: (d: Record<string, unknown>) => Promise<void> }
const mockRunTransaction = vi.fn(<T,>(fn: (tx: unknown) => Promise<T>): Promise<T> => {
  const run = txChain.then(() =>
    fn({
      get: (ref: MockRef) => ref.get(),
      update: (ref: MockRef, data: Record<string, unknown>) => {
        void ref.update(data)
      },
    })
  )
  txChain = run.catch(() => {})
  return run
})

let authResult: Record<string, unknown>

vi.mock('@/lib/api/firebase-server-helpers', () => ({
  getAuthenticatedUser: vi.fn(async () => authResult),
  getAdminDb: vi.fn(() => ({ collection: mockCollection, runTransaction: mockRunTransaction })),
  getProjectRole: (...args: unknown[]) => mockGetProjectRole(...args),
  requireRole: (role: string | null, minimum: string) => {
    const levels: Record<string, number> = { maker: 0, apprentice: 1, builder: 2, owner: 3 }
    if (!role || levels[role] < levels[minimum]) {
      return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
    }
    return null
  },
}))

vi.mock('@/lib/email-in/address', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/email-in/address')>()
  return { ...actual, randomTail: () => mockTail() }
})

let storedEmails: Record<string, unknown>[] = []
// The route reads the panel's rows through the bounded read, not the full list.
const mockListRecent = vi.fn(async (_db: unknown, _projectId: string, limit: number) =>
  [...storedEmails]
    .sort((a, b) => String(b.received_at).localeCompare(String(a.received_at)))
    .slice(0, limit)
    .map((e) => ({
      from_name: e.from_name,
      from_role: e.from_role,
      received_at: e.received_at,
      subject: e.subject,
    }))
)
const mockListAll = vi.fn()
vi.mock('@/lib/email-in/store', () => ({
  listRecentProjectEmailRows: (...a: [unknown, string, number]) => mockListRecent(...a),
  listProjectEmails: (...a: unknown[]) => mockListAll(...a),
}))

import { GET, POST } from '../route'

const postReq = (body: unknown) =>
  new Request('http://localhost/api/projects/email-in', { method: 'POST', body: JSON.stringify(body) })

const getReq = (projectId?: string) =>
  new Request(`http://localhost/api/projects/email-in${projectId ? `?project_id=${projectId}` : ''}`)

beforeEach(() => {
  vi.clearAllMocks()
  storedEmails = []
  authResult = { uid: 'u1', email: 'b@ibuild4you.com', systemRoles: [], error: null }
  mockGetProjectRole.mockResolvedValue('builder')
  projectData = { title: 'Music Forge', slug: 'musicforge' }
  takenAddresses = []
  mockTail.mockReset() // also drops any unused mockReturnValueOnce values
  mockTail.mockReturnValue('7k2q')
})

describe('POST /api/projects/email-in', () => {
  it('returns the auth error when not signed in', async () => {
    authResult = { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
    const res = await POST(postReq({ project_id: 'p1' }))
    expect(res.status).toBe(401)
  })

  it('is 400 without a project_id', async () => {
    const res = await POST(postReq({}))
    expect(res.status).toBe(400)
    expect(mockUpdate).not.toHaveBeenCalled()
  })

  it('is 403 for a maker', async () => {
    mockGetProjectRole.mockResolvedValue('maker')
    const res = await POST(postReq({ project_id: 'p1' }))
    expect(res.status).toBe(403)
    expect(mockUpdate).not.toHaveBeenCalled()
  })

  it('is 404 when the project does not exist', async () => {
    projectData = undefined
    const res = await POST(postReq({ project_id: 'p1' }))
    expect(res.status).toBe(404)
  })

  it('mints and stores an address for a builder on a project without one', async () => {
    const res = await POST(postReq({ project_id: 'p1' }))
    expect(res.status).toBe(200)
    const { address } = await res.json()
    expect(address).toMatch(/^[a-z0-9-]+-[a-z2-9]{4}@inbox\.ibuild4you\.com$/)
    expect(address).toBe('musicforge-7k2q@inbox.ibuild4you.com')
    expect(mockUpdate).toHaveBeenCalledTimes(1)
    expect(mockUpdate).toHaveBeenCalledWith({ email_in_address: address })
  })

  it('returns the same address and writes nothing on a second call', async () => {
    projectData = { slug: 'musicforge', email_in_address: 'musicforge-abcd@inbox.ibuild4you.com' }
    const res = await POST(postReq({ project_id: 'p1' }))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ address: 'musicforge-abcd@inbox.ibuild4you.com' })
    expect(mockUpdate).not.toHaveBeenCalled()
  })

  it('tries a new tail when another project holds the address', async () => {
    takenAddresses = ['musicforge-7k2q@inbox.ibuild4you.com']
    mockTail.mockReturnValueOnce('7k2q').mockReturnValueOnce('m3n4')
    const res = await POST(postReq({ project_id: 'p1' }))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ address: 'musicforge-m3n4@inbox.ibuild4you.com' })
    expect(mockUpdate).toHaveBeenCalledWith({ email_in_address: 'musicforge-m3n4@inbox.ibuild4you.com' })
  })

  it('keeps the first address when two mints for the same project run at once', async () => {
    mockTail.mockReturnValueOnce('aaaa').mockReturnValueOnce('bbbb')
    const [first, second] = await Promise.all([
      POST(postReq({ project_id: 'p1' })),
      POST(postReq({ project_id: 'p1' })),
    ])
    const a = (await first.json()).address
    const b = (await second.json()).address
    expect(a).toBe('musicforge-aaaa@inbox.ibuild4you.com')
    expect(b).toBe(a)
    expect(mockUpdate).toHaveBeenCalledTimes(1)
    expect(projectData?.email_in_address).toBe(a)
  })

  it('gives up with a 500 after 5 collisions and writes nothing', async () => {
    takenAddresses = ['musicforge-7k2q@inbox.ibuild4you.com']
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const res = await POST(postReq({ project_id: 'p1' }))
    errorSpy.mockRestore()
    expect(res.status).toBe(500)
    expect(mockTail).toHaveBeenCalledTimes(5)
    expect(mockUpdate).not.toHaveBeenCalled()
  })
})

// GET /api/projects/email-in?project_id=: what the Setup panel shows. Counts and
// a short list of who wrote and when; never an email's text.
describe('GET /api/projects/email-in', () => {
  // Twelve stored emails, ascending by received_at as listProjectEmails returns them.
  const makeEmails = (n: number) =>
    Array.from({ length: n }, (_, i) => ({
      id: `e${i}_p1`,
      project_id: 'p1',
      from_email: `bill${i}@example.com`,
      from_name: `Bill ${i}`,
      from_role: i % 2 ? 'builder' : 'maker',
      received_at: `2026-11-${String(i + 1).padStart(2, '0')}T10:00:00.000Z`,
      sent_at: null,
      subject: `Subject ${i}`,
      message_id: `<m${i}@example.com>`,
      text: `SECRET BODY ${i}`,
      truncated: false,
      attachments: [{ filename: 'secret.pdf', content_type: 'application/pdf' }],
    }))

  it('returns the auth error when not signed in', async () => {
    authResult = { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
    const res = await GET(getReq('p1'))
    expect(res.status).toBe(401)
  })

  it('is 400 without a project_id', async () => {
    const res = await GET(getReq())
    expect(res.status).toBe(400)
  })

  it('is 403 for a maker', async () => {
    mockGetProjectRole.mockResolvedValue('maker')
    const res = await GET(getReq('p1'))
    expect(res.status).toBe(403)
  })

  it('is 404 when the project does not exist', async () => {
    projectData = undefined
    const res = await GET(getReq('p1'))
    expect(res.status).toBe(404)
  })

  it('has no address and zeroed counts for a project with none', async () => {
    const res = await GET(getReq('p1'))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({
      address: null,
      recent: [],
      dropped: { not_member: 0, auth_failed: 0, over_limit: 0, last_auth_failed_from: null },
    })
  })

  it('gives a builder the address, the newest 10 emails newest first, and no email text', async () => {
    projectData = { slug: 'musicforge', email_in_address: 'musicforge-abcd@inbox.ibuild4you.com' }
    storedEmails = makeEmails(12)
    const res = await GET(getReq('p1'))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.address).toBe('musicforge-abcd@inbox.ibuild4you.com')
    expect(body.recent).toHaveLength(10)
    expect(body.recent[0]).toEqual({
      from_name: 'Bill 11',
      from_role: 'builder',
      received_at: '2026-11-12T10:00:00.000Z',
      subject: 'Subject 11',
    })
    expect(body.recent[9].subject).toBe('Subject 2')
    expect(mockListRecent).toHaveBeenCalledWith(expect.anything(), 'p1', 10)
    expect(mockListAll).not.toHaveBeenCalled()
    for (const row of body.recent) {
      expect(Object.keys(row).sort()).toEqual(['from_name', 'from_role', 'received_at', 'subject'])
    }
    const raw = JSON.stringify(body)
    expect(raw).not.toContain('SECRET BODY')
    expect(raw).not.toContain('example.com')
    expect(raw).not.toContain('secret.pdf')
  })

  it('works for an owner', async () => {
    mockGetProjectRole.mockResolvedValue('owner')
    const res = await GET(getReq('p1'))
    expect(res.status).toBe(200)
  })

  it('passes the drop counts and the last failed sender through', async () => {
    projectData = {
      email_in_address: 'musicforge-abcd@inbox.ibuild4you.com',
      email_in_dropped: { not_member: 3, auth_failed: 2, over_limit: 1, last_at: 'x', last_auth_failed_from: 'bduris@aol.com' },
    }
    const body = await (await GET(getReq('p1'))).json()
    expect(body.dropped).toEqual({
      not_member: 3,
      auth_failed: 2,
      over_limit: 1,
      last_auth_failed_from: 'bduris@aol.com',
    })
  })

  it('reads a count that is missing or not a number as 0', async () => {
    projectData = { email_in_dropped: { not_member: 'lots', auth_failed: null, last_auth_failed_from: 7 } }
    const body = await (await GET(getReq('p1'))).json()
    expect(body.dropped).toEqual({ not_member: 0, auth_failed: 0, over_limit: 0, last_auth_failed_from: null })
  })
})
