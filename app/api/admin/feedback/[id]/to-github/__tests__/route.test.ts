import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { POST } from '../route'

const mockGetAuthenticatedUser = vi.fn()
const mockHasSystemRole = vi.fn()
const mockDocGet = vi.fn()
const mockDocUpdate = vi.fn<(patch: Record<string, unknown>) => Promise<void>>(async () => undefined)
const mockProjectsGet = vi.fn()

vi.mock('@/lib/api/firebase-server-helpers', () => ({
  getAuthenticatedUser: (req: Request) => mockGetAuthenticatedUser(req),
  hasSystemRole: (auth: unknown, role: string) => mockHasSystemRole(auth, role),
  getAdminDb: () => ({
    collection: (name: string) => {
      if (name === 'feedback') {
        return { doc: () => ({ get: mockDocGet, update: mockDocUpdate }) }
      }
      // 'projects'
      return {
        where: () => ({ limit: () => ({ get: mockProjectsGet }) }),
      }
    },
  }),
}))

const adminAuth = { uid: 'u1', email: 'admin@x.com', systemRoles: ['admin'], error: null }
const params = Promise.resolve({ id: 'fb_1' })

function makeReq() {
  return new Request('http://localhost/api/admin/feedback/fb_1/to-github', { method: 'POST' })
}

const baseFeedback = {
  project_id: 'bakery-louise',
  type: 'bug' as const,
  body: 'Footer link broken',
  submitter_email: 'jamie@example.com',
  submitter_uid: null,
  page_url: 'https://bakerylouise.com/menu',
  user_agent: 'UA',
  viewport: '375x812',
  status: 'new' as const,
  internal_notes: null,
  github_issue_url: null,
  created_at: '2026-05-13T18:00:00.000Z',
  updated_at: '2026-05-13T18:00:00.000Z',
}

beforeEach(() => {
  vi.clearAllMocks()
  process.env.GITHUB_TOKEN = 'test-token'
  mockGetAuthenticatedUser.mockResolvedValue(adminAuth)
  mockHasSystemRole.mockReturnValue(true)
  mockDocGet.mockResolvedValue({ exists: true, data: () => baseFeedback })
  mockProjectsGet.mockResolvedValue({
    empty: false,
    docs: [{ data: () => ({ title: 'Bakery Louise', github_repo: 'nicolovejoy/bakery-louise' }) }],
  })
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(
    new Response(
      JSON.stringify({ number: 7, html_url: 'https://github.com/nicolovejoy/bakery-louise/issues/7' }),
      { status: 201 }
    )
  )
})

afterEach(() => {
  vi.restoreAllMocks()
  delete process.env.GITHUB_TOKEN
})

describe('POST /api/admin/feedback/[id]/to-github', () => {
  it('returns 401 when unauthenticated', async () => {
    mockGetAuthenticatedUser.mockResolvedValueOnce({
      error: new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 }),
    })
    const res = await POST(makeReq(), { params })
    expect(res.status).toBe(401)
  })

  it('returns 403 for non-admins', async () => {
    mockHasSystemRole.mockReturnValueOnce(false)
    const res = await POST(makeReq(), { params })
    expect(res.status).toBe(403)
  })

  it('returns 500 when GITHUB_TOKEN is missing', async () => {
    delete process.env.GITHUB_TOKEN
    const res = await POST(makeReq(), { params })
    expect(res.status).toBe(500)
  })

  it('returns 404 when feedback does not exist', async () => {
    mockDocGet.mockResolvedValueOnce({ exists: false, data: () => undefined })
    const res = await POST(makeReq(), { params })
    expect(res.status).toBe(404)
  })

  it('is idempotent — returns existing url without hitting GitHub', async () => {
    mockDocGet.mockResolvedValueOnce({
      exists: true,
      data: () => ({ ...baseFeedback, github_issue_url: 'https://github.com/x/y/issues/1' }),
    })
    const res = await POST(makeReq(), { params })
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.github_issue_url).toBe('https://github.com/x/y/issues/1')
    expect(globalThis.fetch).not.toHaveBeenCalled()
    expect(mockDocUpdate).not.toHaveBeenCalled()
  })

  it('returns 404 when the project no longer exists', async () => {
    mockProjectsGet.mockResolvedValueOnce({ empty: true, docs: [] })
    const res = await POST(makeReq(), { params })
    expect(res.status).toBe(404)
  })

  it('returns 400 when project has no github_repo set', async () => {
    mockProjectsGet.mockResolvedValueOnce({
      empty: false,
      docs: [{ data: () => ({ title: 'X' }) }],
    })
    const res = await POST(makeReq(), { params })
    expect(res.status).toBe(400)
  })

  it('returns 400 when github_repo is malformed', async () => {
    mockProjectsGet.mockResolvedValueOnce({
      empty: false,
      docs: [{ data: () => ({ title: 'X', github_repo: 'not-a-repo' }) }],
    })
    const res = await POST(makeReq(), { params })
    expect(res.status).toBe(400)
  })

  it('creates the issue, persists the url, and returns the updated feedback', async () => {
    const res = await POST(makeReq(), { params })
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.github_issue_url).toBe('https://github.com/nicolovejoy/bakery-louise/issues/7')

    expect(globalThis.fetch).toHaveBeenCalledTimes(1)
    const [url, init] = vi.mocked(globalThis.fetch).mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://api.github.com/repos/nicolovejoy/bakery-louise/issues')
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer test-token')
    const body = JSON.parse(init.body as string)
    expect(body.title).toContain('[bug]')
    expect(body.labels).toEqual(['feedback', 'bug'])

    expect(mockDocUpdate).toHaveBeenCalledOnce()
    const patch = mockDocUpdate.mock.calls[0][0]
    expect(patch.github_issue_url).toBe('https://github.com/nicolovejoy/bakery-louise/issues/7')
  })

  it('returns 502 when the GitHub API call fails', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValueOnce(
      new Response(JSON.stringify({ message: 'Bad credentials' }), { status: 401 })
    )
    const res = await POST(makeReq(), { params })
    expect(res.status).toBe(502)
    const data = await res.json()
    expect(data.error).toContain('Bad credentials')
    expect(mockDocUpdate).not.toHaveBeenCalled()
  })
})
