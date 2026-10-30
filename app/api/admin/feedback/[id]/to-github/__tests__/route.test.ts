import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { NextResponse } from 'next/server'
import { POST } from '../route'

const mockGetAuthenticatedUser = vi.fn()
const mockHasSystemRole = vi.fn()
const mockDocGet = vi.fn()
const mockDocUpdate = vi.fn<(patch: Record<string, unknown>) => Promise<void>>(async () => undefined)
const mockAppDocGet = vi.fn()
const mockAppLegacyGet = vi.fn()
const mockCollectionNames: string[] = []

vi.mock('@/lib/api/firebase-server-helpers', () => ({
  getAuthenticatedUser: (req: Request) => mockGetAuthenticatedUser(req),
  hasSystemRole: (auth: unknown, role: string) => mockHasSystemRole(auth, role),
  getAdminDb: () => ({
    collection: (name: string) => {
      if (name === 'feedback') {
        return { doc: () => ({ get: mockDocGet, update: mockDocUpdate }) }
      }
      mockCollectionNames.push(name)
      // 'apps': direct doc lookup, then legacy_slugs array-contains
      return {
        doc: () => ({ get: mockAppDocGet }),
        where: () => ({ limit: () => ({ get: mockAppLegacyGet }) }),
      }
    },
  }),
}))

const mockRequireFeedbackAccess = vi.fn()
vi.mock('@/lib/api/feedback-access', () => ({
  requireFeedbackAccess: (...args: unknown[]) => mockRequireFeedbackAccess(...args),
}))

const adminAuth = { uid: 'u1', email: 'admin@x.com', systemRoles: ['admin'], error: null }
const params = Promise.resolve({ id: 'fb_1' })

function makeReq() {
  return new Request('http://localhost/api/admin/feedback/fb_1/to-github', { method: 'POST' })
}

const baseFeedback = {
  project_id: 'sample-cafe',
  type: 'bug' as const,
  body: 'Footer link broken',
  submitter_email: 'sam@example.com',
  submitter_uid: null,
  page_url: 'https://samplecafe.com/menu',
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
  mockRequireFeedbackAccess.mockResolvedValue(null)
  mockDocGet.mockResolvedValue({ exists: true, data: () => baseFeedback })
  mockCollectionNames.length = 0
  mockAppDocGet.mockResolvedValue({
    exists: true,
    id: 'sample-cafe',
    data: () => ({ name: 'Sample Cafe', github_repo: 'nicolovejoy/sample-cafe' }),
  })
  mockAppLegacyGet.mockResolvedValue({ empty: true, docs: [] })
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(
    new Response(
      JSON.stringify({ number: 7, html_url: 'https://github.com/nicolovejoy/sample-cafe/issues/7' }),
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

  it('returns 403 for a non-admin without access to the row\'s app', async () => {
    mockHasSystemRole.mockReturnValue(false)
    mockRequireFeedbackAccess.mockResolvedValue(NextResponse.json({ error: 'Forbidden' }, { status: 403 }))
    const res = await POST(makeReq(), { params })
    expect(res.status).toBe(403)
    expect(mockRequireFeedbackAccess).toHaveBeenCalledWith(expect.anything(), 'sample-cafe')
    expect(mockDocUpdate).not.toHaveBeenCalled()
  })

  it('lets a non-admin collaborator on the row\'s app file the issue', async () => {
    mockHasSystemRole.mockReturnValue(false)
    const res = await POST(makeReq(), { params })
    expect(res.status).toBe(200)
    expect(mockDocUpdate).toHaveBeenCalledOnce()
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

  it('404 Unknown app when no app matches the feedback slug', async () => {
    mockAppDocGet.mockResolvedValueOnce({ exists: false, data: () => undefined })
    const res = await POST(makeReq(), { params })
    expect(res.status).toBe(404)
    expect((await res.json()).error).toBe('Unknown app')
  })

  it('400 when the app has no github_repo', async () => {
    mockAppDocGet.mockResolvedValueOnce({ exists: true, id: 'sample-cafe', data: () => ({ name: 'X' }) })
    const res = await POST(makeReq(), { params })
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe('App has no github_repo set')
    // Never falls through to a projects lookup (would 500/404 for app-only slugs).
    expect(mockCollectionNames).not.toContain('projects')
  })

  it('resolves a legacy slug stored on older feedback rows', async () => {
    mockAppDocGet.mockResolvedValueOnce({ exists: false, data: () => undefined })
    mockAppLegacyGet.mockResolvedValueOnce({
      empty: false,
      docs: [{ id: 'sample-cafe', data: () => ({ name: 'Sample Cafe', github_repo: 'nicolovejoy/sample-cafe' }) }],
    })
    const res = await POST(makeReq(), { params })
    expect(res.status).toBe(200)
  })

  it('issue title uses apps.name', async () => {
    mockAppDocGet.mockResolvedValueOnce({
      exists: true,
      id: 'sample-cafe',
      data: () => ({ name: 'The Sample Cafe App', github_repo: 'nicolovejoy/sample-cafe' }),
    })
    await POST(makeReq(), { params })
    const [, init] = vi.mocked(globalThis.fetch).mock.calls[0] as [string, RequestInit]
    expect(JSON.parse(init.body as string).body).toContain('The Sample Cafe App')
  })

  it('returns 400 when github_repo is malformed', async () => {
    mockAppDocGet.mockResolvedValueOnce({
      exists: true,
      id: 'sample-cafe',
      data: () => ({ name: 'X', github_repo: 'not-a-repo' }),
    })
    const res = await POST(makeReq(), { params })
    expect(res.status).toBe(400)
  })

  it('creates the issue, persists the url, and returns the updated feedback', async () => {
    const res = await POST(makeReq(), { params })
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.github_issue_url).toBe('https://github.com/nicolovejoy/sample-cafe/issues/7')

    expect(globalThis.fetch).toHaveBeenCalledTimes(1)
    const [url, init] = vi.mocked(globalThis.fetch).mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://api.github.com/repos/nicolovejoy/sample-cafe/issues')
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer test-token')
    const body = JSON.parse(init.body as string)
    expect(body.title).toContain('[bug]')
    expect(body.labels).toEqual(['feedback', 'bug'])

    expect(mockDocUpdate).toHaveBeenCalledOnce()
    const patch = mockDocUpdate.mock.calls[0][0]
    expect(patch.github_issue_url).toBe('https://github.com/nicolovejoy/sample-cafe/issues/7')
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
