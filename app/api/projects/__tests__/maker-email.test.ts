import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { NextResponse } from 'next/server'
import { POST } from '../[id]/email/route'

// --- db mock: collection('projects').doc(id).get() + project_members query ---
const mockProjectUpdate = vi.fn()
let projectData: Record<string, unknown>
let memberSnap: { empty: boolean; docs: Array<{ data: () => Record<string, unknown>; ref: { update: ReturnType<typeof vi.fn> } }> }

const mockMemberUpdate = vi.fn()
const mockMemberGet = vi.fn()
const mockLimit = vi.fn(() => ({ get: mockMemberGet }))
const mockWhere = vi.fn(() => ({ where: mockWhere, limit: mockLimit }))
const mockProjectGet = vi.fn()
const mockDoc = vi.fn(() => ({ get: mockProjectGet }))
const mockCollection = vi.fn((name: string) =>
  name === 'project_members' ? { where: mockWhere } : { doc: mockDoc }
)

const mockGetProjectRole = vi.fn()
const sendMakerEmailMock = vi.fn()

vi.mock('@/lib/api/firebase-server-helpers', () => ({
  getAuthenticatedUser: vi.fn(async () => ({
    uid: 'builder-uid',
    email: 'builder@example.com',
    error: null,
    systemRoles: [],
  })),
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

vi.mock('@/lib/email/send-maker-email', () => ({
  sendMakerEmail: (...args: unknown[]) => sendMakerEmailMock(...args),
}))

function makeReq(body: Record<string, unknown>) {
  return new Request('http://localhost/api/projects/p1/email', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}
const params = Promise.resolve({ id: 'p1' })

describe('POST /api/projects/[id]/email', () => {
  const origVercelEnv = process.env.VERCEL_ENV
  beforeEach(() => {
    vi.clearAllMocks()
    // Default these tests to prod so the real send path runs; the suppression
    // test below flips to a non-prod env explicitly.
    process.env.VERCEL_ENV = 'production'
    mockGetProjectRole.mockResolvedValue('builder')
    projectData = {
      title: 'BySide',
      slug: 'byside',
      requester_email: 'maker@example.com',
      session_mode: 'converge',
    }
    mockProjectGet.mockImplementation(async () => ({
      exists: true,
      data: () => projectData,
      ref: { update: mockProjectUpdate },
    }))
    memberSnap = {
      empty: false,
      docs: [{ data: () => ({ passcode: 'ABC123' }), ref: { update: mockMemberUpdate } }],
    }
    mockMemberGet.mockImplementation(async () => memberSnap)
    sendMakerEmailMock.mockResolvedValue({ emailId: 'em_test' })
  })

  it('returns 400 for an invalid kind', async () => {
    const res = await POST(makeReq({ kind: 'spam' }), { params })
    expect(res.status).toBe(400)
    expect(sendMakerEmailMock).not.toHaveBeenCalled()
  })

  it('returns 403 when caller is below builder', async () => {
    mockGetProjectRole.mockResolvedValue('maker')
    const res = await POST(makeReq({ kind: 'reminder' }), { params })
    expect(res.status).toBe(403)
  })

  it('returns 404 when the project does not exist', async () => {
    mockProjectGet.mockResolvedValue({ exists: false, data: () => undefined })
    const res = await POST(makeReq({ kind: 'reminder' }), { params })
    expect(res.status).toBe(404)
  })

  it('returns 400 when the brief has no maker email', async () => {
    projectData = { title: 'BySide', slug: 'byside' }
    const res = await POST(makeReq({ kind: 'reminder' }), { params })
    expect(res.status).toBe(400)
    expect(sendMakerEmailMock).not.toHaveBeenCalled()
  })

  it('sends a reminder to the maker, replyTo + bcc the builder, and stamps last_nudged_at', async () => {
    const res = await POST(makeReq({ kind: 'reminder' }), { params })
    expect(res.status).toBe(200)
    const call = sendMakerEmailMock.mock.calls[0][0]
    expect(call.to).toBe('maker@example.com')
    expect(call.replyTo).toBe('builder@example.com')
    expect(call.bcc).toEqual(['builder@example.com'])
    expect(call.text).toContain('https://ibuild4you.com/projects/byside')
    expect(mockProjectUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ last_nudged_at: expect.any(String) })
    )
  })

  it('includes the resolved passcode in the invite body and stamps shared_at', async () => {
    const res = await POST(makeReq({ kind: 'invite' }), { params })
    expect(res.status).toBe(200)
    const call = sendMakerEmailMock.mock.calls[0][0]
    expect(call.text).toContain('ABC123')
    expect(mockProjectUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ shared_at: expect.any(String) })
    )
  })

  it('mints a passcode for the invite when the member has none', async () => {
    memberSnap = {
      empty: false,
      docs: [{ data: () => ({}), ref: { update: mockMemberUpdate } }],
    }
    const res = await POST(makeReq({ kind: 'invite' }), { params })
    expect(res.status).toBe(200)
    expect(mockMemberUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ passcode: expect.any(String) })
    )
  })

  it('sends the nudge_message override verbatim when set', async () => {
    projectData.nudge_message = 'Custom hello, ready when you are.'
    const res = await POST(makeReq({ kind: 'nudge' }), { params })
    expect(res.status).toBe(200)
    const call = sendMakerEmailMock.mock.calls[0][0]
    expect(call.text).toContain('Custom hello, ready when you are.')
    expect(call.text).toContain('https://ibuild4you.com/projects/byside')
  })

  it('suppresses the real send on preview for a non-allowlisted maker, but still stamps activity', async () => {
    process.env.VERCEL_ENV = 'preview'
    const res = await POST(makeReq({ kind: 'nudge' }), { params })
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.suppressed).toBe(true)
    expect(sendMakerEmailMock).not.toHaveBeenCalled()
    expect(mockProjectUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ last_nudged_at: expect.any(String) })
    )
  })

  it('still sends on preview when the maker is allowlisted (@ibuild4you.com)', async () => {
    process.env.VERCEL_ENV = 'preview'
    projectData.requester_email = 'test@ibuild4you.com'
    const res = await POST(makeReq({ kind: 'nudge' }), { params })
    expect(res.status).toBe(200)
    expect(sendMakerEmailMock).toHaveBeenCalledOnce()
  })

  afterEach(() => {
    if (origVercelEnv === undefined) delete process.env.VERCEL_ENV
    else process.env.VERCEL_ENV = origVercelEnv
  })
})
