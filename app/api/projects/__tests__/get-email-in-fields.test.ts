import { describe, it, expect, vi, beforeEach } from 'vitest'

// =============================================================================
// GET /api/projects: the email-in fields (the project's address, when mail
// last came, and the drop counters, which can hold a member's address) are
// builder-side only. A viewer who is not an owner, a builder or a system admin
// gets the project without them, on every path (F7).
//
// Firestore is a small fake of the reads the GET makes; enrichProjects and the
// sort are stubbed to pass the projects through with their viewer_role.
// =============================================================================

type Doc = Record<string, unknown>
let projects: Record<string, Doc>
let members: Doc[]
let auth: { uid: string; email: string; systemRoles: string[]; error: null }
const mockGetProjectRole = vi.fn()
const mockGetViewerMembership = vi.fn()

const EMAIL_IN = {
  email_in_address: 'cafe-7k2q@inbox.ibuild4you.com',
  last_email_at: '2026-11-19T18:00:00.000Z',
  email_in_dropped: { auth_failed: 1, last_auth_failed_from: 'bduris@aol.com' },
}

// The last reminder: its time stays for everyone (the maker's dashboard card says
// "Nudged ..."), the addresses it went to are builder-side only.
const NUDGE = { last_nudged_at: '2026-11-23T22:10:00.000Z', last_nudged_to: ['sam@example.com'] }

function docSnap(id: string) {
  const d = projects[id]
  return { id, exists: d !== undefined, data: () => d }
}

const db = {
  collection: (name: string) => {
    if (name === 'projects') {
      return {
        doc: (id: string) => ({ get: async () => docSnap(id) }),
        where: (field: string, _op: string, value: unknown) => ({
          limit: () => ({
            get: async () => {
              const docs = Object.keys(projects)
                .filter((id) => projects[id][field] === value)
                .map(docSnap)
              return { empty: docs.length === 0, docs }
            },
          }),
          // where('__name__', 'in', ids)
          get: async () => ({ docs: (value as string[]).filter((id) => projects[id]).map(docSnap) }),
        }),
        orderBy: () => ({ get: async () => ({ docs: Object.keys(projects).map(docSnap) }) }),
      }
    }
    if (name === 'project_members') {
      return {
        where: (field: string, _op: string, value: unknown) => ({
          get: async () => ({
            docs: members.filter((m) => m[field] === value).map((m) => ({ data: () => m })),
          }),
        }),
      }
    }
    throw new Error(`unexpected collection ${name}`)
  },
}

vi.mock('@/lib/api/firebase-server-helpers', () => ({
  getAuthenticatedUser: vi.fn(async () => auth),
  getAdminDb: vi.fn(() => db),
  getProjectRole: (...args: unknown[]) => mockGetProjectRole(...args),
  getViewerMembership: (...args: unknown[]) => mockGetViewerMembership(...args),
  requireRole: vi.fn(() => null),
  hasSystemRole: (a: { systemRoles: string[] }, role: string) => a.systemRoles.includes(role),
}))

vi.mock('@/lib/api/enrich-projects', () => ({
  enrichProjects: async (_db: unknown, docs: Doc[], viewerRoles?: Map<string, string>) =>
    docs.map((p) => ({ ...p, viewer_role: viewerRoles?.get(p.id as string) ?? null })),
}))
vi.mock('@/lib/api/sort-projects-by-activity', () => ({
  sortProjectsByActivity: <T,>(list: T[]) => list,
}))

import { GET } from '../route'

const getRes = (query: string) => GET(new Request(`http://localhost/api/projects${query}`))
const get = async (query = '') => (await getRes(query)).json()

const hasNone = (p: Doc) =>
  !('email_in_address' in p) && !('last_email_at' in p) && !('email_in_dropped' in p)
const hasAll = (p: Doc) =>
  p.email_in_address === EMAIL_IN.email_in_address &&
  p.last_email_at === EMAIL_IN.last_email_at &&
  JSON.stringify(p.email_in_dropped) === JSON.stringify(EMAIL_IN.email_in_dropped)

beforeEach(() => {
  vi.clearAllMocks()
  mockGetViewerMembership.mockResolvedValue({ brief_role: null, archived: false })
  auth = { uid: 'u1', email: 'viewer@example.com', systemRoles: [], error: null }
  projects = {
    p1: { title: 'Cafe', slug: 'cafe', ...EMAIL_IN, ...NUDGE },
    p2: { title: 'Shop', slug: 'shop', ...EMAIL_IN, ...NUDGE },
  }
  members = []
})

describe('GET /api/projects?slug=: who may read one project', () => {
  it('answers 404 to a viewer with no role on the brief, as for an unknown one', async () => {
    mockGetProjectRole.mockResolvedValue(null)
    const res = await getRes('?slug=cafe')
    expect(res.status).toBe(404)
    expect(await res.json()).toEqual({ error: 'Project not found' })
  })

  it('answers 404 for an unknown slug', async () => {
    const res = await getRes('?slug=nope')
    expect(res.status).toBe(404)
    expect(await res.json()).toEqual({ error: 'Project not found' })
  })

  it('does not read the membership of a viewer with no role', async () => {
    mockGetProjectRole.mockResolvedValue(null)
    await getRes('?slug=cafe')
    expect(mockGetViewerMembership).not.toHaveBeenCalled()
  })
})

describe('GET /api/projects?slug= (one project)', () => {
  for (const role of ['maker', 'apprentice']) {
    it(`leaves the email-in fields out for role ${role}`, async () => {
      mockGetProjectRole.mockResolvedValue(role)
      const body = await get('?slug=cafe')
      expect(body.title).toBe('Cafe')
      expect(body.viewer_role).toBe(role)
      expect(hasNone(body)).toBe(true)
    })
  }

  for (const role of ['builder', 'owner']) {
    it(`keeps them for role ${role}`, async () => {
      mockGetProjectRole.mockResolvedValue(role)
      expect(hasAll(await get('?slug=cafe'))).toBe(true)
    })
  }

  it('keeps them for a system admin', async () => {
    auth.systemRoles = ['admin']
    const body = await get('?slug=p1')
    expect(body.viewer_role).toBe('admin')
    expect(hasAll(body)).toBe(true)
  })

  // The Settings tab's Archive button reads these from the one-project lookup.
  it("carries the viewer's brief role and whether they archived the brief", async () => {
    mockGetProjectRole.mockResolvedValue('builder')
    expect((await get('?slug=cafe')).viewer_archived).toBe(false)

    mockGetViewerMembership.mockResolvedValue({ brief_role: 'contributor', archived: true })
    const body = await get('?slug=cafe')
    expect(body.viewer_archived).toBe(true)
    expect(body.viewer_brief_role).toBe('contributor')
  })
})

describe('GET /api/projects (the list)', () => {
  it("strips them per project by the viewer's role there", async () => {
    members = [
      { project_id: 'p1', user_id: 'u1', email: 'viewer@example.com', role: 'maker' },
      { project_id: 'p2', user_id: 'u1', email: 'viewer@example.com', role: 'builder' },
    ]
    const list = (await get()) as Doc[]
    const p1 = list.find((p) => p.id === 'p1')!
    const p2 = list.find((p) => p.id === 'p2')!
    expect(hasNone(p1)).toBe(true)
    expect(hasAll(p2)).toBe(true)
  })

  it('strips them for an apprentice', async () => {
    members = [{ project_id: 'p1', user_id: 'u1', email: 'viewer@example.com', role: 'apprentice' }]
    const [p1] = (await get()) as Doc[]
    expect(p1.id).toBe('p1')
    expect(hasNone(p1)).toBe(true)
  })

  it('keeps them on every project for a system admin, even one where they are a maker', async () => {
    auth.systemRoles = ['admin']
    members = [{ project_id: 'p1', user_id: 'u1', email: 'viewer@example.com', role: 'maker' }]
    const list = (await get()) as Doc[]
    expect(list).toHaveLength(2)
    expect(list.every(hasAll)).toBe(true)
  })
})

describe('GET /api/projects: the addresses of the last reminder', () => {
  for (const role of ['maker', 'apprentice']) {
    it(`leaves last_nudged_to out for role ${role} and keeps the time`, async () => {
      mockGetProjectRole.mockResolvedValue(role)
      const body = await get('?slug=cafe')
      expect('last_nudged_to' in body).toBe(false)
      expect(body.last_nudged_at).toBe(NUDGE.last_nudged_at)
    })
  }

  it('keeps last_nudged_to for a builder', async () => {
    mockGetProjectRole.mockResolvedValue('builder')
    expect((await get('?slug=cafe')).last_nudged_to).toEqual(NUDGE.last_nudged_to)
  })

  it('strips it per project in the list by the viewer role there', async () => {
    members = [
      { project_id: 'p1', user_id: 'u1', email: 'viewer@example.com', role: 'maker' },
      { project_id: 'p2', user_id: 'u1', email: 'viewer@example.com', role: 'builder' },
    ]
    const list = (await get()) as Doc[]
    const p1 = list.find((p) => p.id === 'p1')!
    const p2 = list.find((p) => p.id === 'p2')!
    expect('last_nudged_to' in p1).toBe(false)
    expect(p1.last_nudged_at).toBe(NUDGE.last_nudged_at)
    expect(p2.last_nudged_to).toEqual(NUDGE.last_nudged_to)
  })
})
