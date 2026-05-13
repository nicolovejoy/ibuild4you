import { describe, it, expect, vi, beforeEach } from 'vitest'
import { PATCH } from '../route'

// =============================================================================
// Tests for PATCH /api/admin/feedback/[id].
// Updates status / internal_notes / github_issue_url. Sends a submitter
// notification email on first transition into acknowledged or done.
// =============================================================================

const mockGetAuthenticatedUser = vi.fn()
const mockHasSystemRole = vi.fn()
const mockDocGet = vi.fn()
const mockUpdate = vi.fn<(patch: Record<string, unknown>) => Promise<void>>(async () => undefined)
const mockResendSend = vi.fn<(payload: Record<string, unknown>) => Promise<{ id: string }>>(
  async () => ({ id: 'email-1' })
)

vi.mock('@/lib/api/firebase-server-helpers', () => ({
  getAuthenticatedUser: (req: Request) => mockGetAuthenticatedUser(req),
  hasSystemRole: (auth: unknown, role: string) => mockHasSystemRole(auth, role),
  getAdminDb: () => ({
    collection: () => ({
      doc: () => ({ get: mockDocGet, update: mockUpdate }),
    }),
  }),
}))

vi.mock('resend', () => ({
  Resend: vi.fn(() => ({ emails: { send: mockResendSend } })),
}))

const adminAuth = { uid: 'u1', email: 'admin@x.com', systemRoles: ['admin'], error: null }

function makeReq(body: Record<string, unknown>) {
  return new Request('http://localhost/api/admin/feedback/abc', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

const params = Promise.resolve({ id: 'abc' })

beforeEach(() => {
  vi.clearAllMocks()
  mockGetAuthenticatedUser.mockResolvedValue(adminAuth)
  mockHasSystemRole.mockReturnValue(true)
  mockDocGet.mockResolvedValue({
    exists: true,
    data: () => ({
      project_id: 'bakery-louise',
      type: 'bug',
      body: 'Footer link broken',
      status: 'new',
      submitter_email: 'jamie@example.com',
    }),
  })
})

describe('PATCH /api/admin/feedback/[id]', () => {
  it('returns 401 when unauthenticated', async () => {
    mockGetAuthenticatedUser.mockResolvedValueOnce({
      error: new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 }),
    })
    const res = await PATCH(makeReq({ status: 'acknowledged' }), { params })
    expect(res.status).toBe(401)
  })

  it('returns 403 for non-admins', async () => {
    mockHasSystemRole.mockReturnValueOnce(false)
    const res = await PATCH(makeReq({ status: 'acknowledged' }), { params })
    expect(res.status).toBe(403)
  })

  it('returns 404 when the doc does not exist', async () => {
    mockDocGet.mockResolvedValueOnce({ exists: false, data: () => undefined })
    const res = await PATCH(makeReq({ status: 'acknowledged' }), { params })
    expect(res.status).toBe(404)
  })

  it('updates status and notifies submitter on acknowledged', async () => {
    const res = await PATCH(makeReq({ status: 'acknowledged' }), { params })
    expect(res.status).toBe(200)
    expect(mockUpdate).toHaveBeenCalledOnce()
    const patch = mockUpdate.mock.calls[0][0]
    expect(patch.status).toBe('acknowledged')
    expect(mockResendSend).toHaveBeenCalledOnce()
    const email = mockResendSend.mock.calls[0][0]
    expect((email.to as string[])[0]).toBe('jamie@example.com')
  })

  it('does not re-notify when status does not change', async () => {
    mockDocGet.mockResolvedValueOnce({
      exists: true,
      data: () => ({ status: 'acknowledged', body: 'x', submitter_email: 'jamie@example.com' }),
    })
    const res = await PATCH(makeReq({ status: 'acknowledged' }), { params })
    expect(res.status).toBe(200)
    expect(mockResendSend).not.toHaveBeenCalled()
  })

  it('does not notify on intermediate statuses like in_progress', async () => {
    const res = await PATCH(makeReq({ status: 'in_progress' }), { params })
    expect(res.status).toBe(200)
    expect(mockResendSend).not.toHaveBeenCalled()
  })

  it('does not send email when submitter_email is null', async () => {
    mockDocGet.mockResolvedValueOnce({
      exists: true,
      data: () => ({ status: 'new', body: 'anon', submitter_email: null }),
    })
    const res = await PATCH(makeReq({ status: 'acknowledged' }), { params })
    expect(res.status).toBe(200)
    expect(mockResendSend).not.toHaveBeenCalled()
  })

  it('rejects invalid status', async () => {
    const res = await PATCH(makeReq({ status: 'banana' }), { params })
    expect(res.status).toBe(400)
    expect(mockUpdate).not.toHaveBeenCalled()
  })

  it('updates internal_notes and github_issue_url without sending email', async () => {
    const res = await PATCH(
      makeReq({ internal_notes: 'Talked to Jamie', github_issue_url: 'https://github.com/x/y/issues/1' }),
      { params }
    )
    expect(res.status).toBe(200)
    const patch = mockUpdate.mock.calls[0][0]
    expect(patch.internal_notes).toBe('Talked to Jamie')
    expect(patch.github_issue_url).toBe('https://github.com/x/y/issues/1')
    expect(mockResendSend).not.toHaveBeenCalled()
  })

  it('allows clearing internal_notes with null', async () => {
    const res = await PATCH(makeReq({ internal_notes: null }), { params })
    expect(res.status).toBe(200)
    const patch = mockUpdate.mock.calls[0][0]
    expect(patch.internal_notes).toBeNull()
  })

  it('rejects non-string non-null internal_notes', async () => {
    const res = await PATCH(makeReq({ internal_notes: 123 }), { params })
    expect(res.status).toBe(400)
  })
})
