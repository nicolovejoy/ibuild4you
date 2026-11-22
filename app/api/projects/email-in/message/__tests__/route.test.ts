import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextResponse } from 'next/server'

// GET /api/projects/email-in/message: one stored email as the note writer read
// it. Firestore, the role helpers and the member loader are mocked; the reading
// itself (readProjectEmails) is real, so the shape is the one the writer gets.

const mockGetProjectRole = vi.fn()
let projectData: Record<string, unknown> | undefined
let authResult: Record<string, unknown>

vi.mock('@/lib/api/firebase-server-helpers', () => ({
  getAuthenticatedUser: vi.fn(async () => authResult),
  getAdminDb: vi.fn(() => ({
    collection: (name: string) => {
      if (name !== 'projects') throw new Error(`unexpected collection ${name}`)
      return {
        doc: () => ({
          get: async () => ({ exists: projectData !== undefined, data: () => projectData }),
        }),
      }
    },
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

vi.mock('@/lib/email-in/members', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/email-in/members')>()
  return {
    ...actual,
    loadSenderMembers: vi.fn(async () => [
      { email: 'tm@yahoo.com', role: 'maker', display_name: 'Test M' },
      { email: 'nico@example.com', role: 'owner', display_name: 'Nico L' },
    ]),
  }
})

// Every stored email of every project; the fake read filters by project, as the
// real listProjectEmails does, and returns them oldest first.
let storedEmails: Record<string, unknown>[] = []
vi.mock('@/lib/email-in/store', () => ({
  listProjectEmails: vi.fn(async (_db: unknown, projectId: string) =>
    storedEmails
      .filter((e) => e.project_id === projectId)
      .sort((a, b) => String(a.received_at).localeCompare(String(b.received_at)))
  ),
}))

import { GET } from '../route'

const getReq = (projectId?: string, emailId?: string) => {
  const params = new URLSearchParams()
  if (projectId !== undefined) params.set('project_id', projectId)
  if (emailId !== undefined) params.set('email_id', emailId)
  return new Request(`http://localhost/api/projects/email-in/message?${params}`)
}

const NICO_HEADER = 'On Nov 22, 2026, at 10:40 AM, Nico L <nico@example.com> wrote:'
const QUESTIONS = [
  'Hi Test,',
  'What colour should the start button be?',
  'Should payment be by card or by invoice?',
  'Thanks,',
  'Nico',
].join('\n')
const INLINE_REPLY = [
  NICO_HEADER,
  '> Hi Test,',
  '> What colour should the start button be?',
  'Green.',
  '> Should payment be by card or by invoice?',
  'By card, please, no invoices.',
  '> Thanks,',
  '> Nico',
].join('\n')

function stored(overrides: Record<string, unknown>) {
  return {
    project_id: 'p1',
    from_email: 'nico@example.com',
    from_name: 'Nico L',
    from_role: 'builder',
    received_at: '2026-11-22T18:00:00.000Z',
    sent_at: null,
    subject: 'Start screen',
    message_id: '<m@example.com>',
    text: '',
    truncated: false,
    attachments: [{ filename: 'secret.pdf', content_type: 'application/pdf' }],
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  authResult = { uid: 'u1', email: 'b@ibuild4you.com', systemRoles: [], error: null }
  mockGetProjectRole.mockResolvedValue('builder')
  projectData = { title: 'Music Forge', requester_email: 'tm@yahoo.com' }
  storedEmails = [
    stored({ id: 'e1_p1', text: QUESTIONS }),
    stored({
      id: 'e2_p1',
      from_email: 'tm@yahoo.com',
      from_name: 'Test M',
      from_role: 'maker',
      received_at: '2026-11-22T18:30:00.000Z',
      subject: 'Re: Start screen',
      message_id: '<m2@example.com>',
      text: INLINE_REPLY,
    }),
    // Another project's email, with text that must never come back from p1.
    stored({ id: 'e9_p2', project_id: 'p2', text: 'OTHER PROJECT SECRET', subject: 'Other subject' }),
  ]
})

describe('GET /api/projects/email-in/message', () => {
  it('returns the auth error when not signed in', async () => {
    authResult = { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
    const res = await GET(getReq('p1', 'e1_p1'))
    expect(res.status).toBe(401)
  })

  it('is 400 without a project_id', async () => {
    const res = await GET(getReq(undefined, 'e1_p1'))
    expect(res.status).toBe(400)
  })

  it('is 400 without an email_id', async () => {
    const res = await GET(getReq('p1'))
    expect(res.status).toBe(400)
  })

  it('is 400 for an id longer than 200 characters', async () => {
    expect((await GET(getReq('p'.repeat(201), 'e1_p1'))).status).toBe(400)
    expect((await GET(getReq('p1', 'e'.repeat(201)))).status).toBe(400)
  })

  it('is 403 for a maker', async () => {
    mockGetProjectRole.mockResolvedValue('maker')
    const res = await GET(getReq('p1', 'e1_p1'))
    expect(res.status).toBe(403)
  })

  it('is 404 when the project does not exist', async () => {
    projectData = undefined
    const res = await GET(getReq('p1', 'e1_p1'))
    expect(res.status).toBe(404)
    expect(await res.json()).toEqual({ error: 'Project not found' })
  })

  it('is 404 when no email of the project has that id', async () => {
    const res = await GET(getReq('p1', 'nope'))
    expect(res.status).toBe(404)
    expect(await res.json()).toEqual({ error: 'Email not found' })
  })

  it("is 404 for another project's email id, with none of its text in the body", async () => {
    const res = await GET(getReq('p1', 'e9_p2'))
    expect(res.status).toBe(404)
    const raw = JSON.stringify(await res.json())
    expect(raw).toBe(JSON.stringify({ error: 'Email not found' }))
    expect(raw).not.toContain('OTHER PROJECT SECRET')
    expect(raw).not.toContain('Other subject')
  })

  it('gives a builder the email as the note writer read it: context and inside lines, authors credited', async () => {
    const res = await GET(getReq('p1', 'e2_p1'))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({
      id: 'e2_p1',
      from_name: 'Test M',
      from_role: 'maker',
      received_at: '2026-11-22T18:30:00.000Z',
      subject: 'Re: Start screen',
      truncated: false,
      repeat: false,
      typed: '',
      quotes: [
        {
          header: NICO_HEADER,
          author: 'member',
          label: 'Builder (Nico L)',
          lines: [
            { text: 'Hi Test,', kind: 'context', by: null },
            { text: 'What colour should the start button be?', kind: 'context', by: null },
            { text: 'Green.', kind: 'inside', by: 'Maker (Test M)' },
            { text: 'Should payment be by card or by invoice?', kind: 'context', by: null },
            { text: 'By card, please, no invoices.', kind: 'inside', by: 'Maker (Test M)' },
            { text: 'Thanks,', kind: 'context', by: null },
            { text: 'Nico', kind: 'context', by: null },
          ],
        },
      ],
    })
  })

  // A reading depends only on the emails before it, so the route reads up to
  // the target and no further.
  it('gives the same reading when a later email quotes and repeats the target', async () => {
    const before = await (await GET(getReq('p1', 'e2_p1'))).json()
    storedEmails.push(
      stored({
        id: 'e3_p1',
        received_at: '2026-11-22T19:00:00.000Z',
        text: `Thanks.\n\nOn Nov 22, 2026, at 11:00 AM, Test M <tm@yahoo.com> wrote:\n${INLINE_REPLY.split('\n')
          .map((line) => `> ${line}`)
          .join('\n')}`,
      }),
      stored({
        id: 'e4_p1',
        from_email: 'tm@yahoo.com',
        from_name: 'Test M',
        from_role: 'maker',
        received_at: '2026-11-22T19:30:00.000Z',
        text: INLINE_REPLY,
      })
    )
    const after = await (await GET(getReq('p1', 'e2_p1'))).json()
    expect(after).toEqual(before)
    expect(after.repeat).toBe(false)
    // The later repeat is read as a repeat when it is the target.
    expect((await (await GET(getReq('p1', 'e4_p1'))).json()).repeat).toBe(true)
  })

  it('shows the first email whole, as typed text with no quotes', async () => {
    const body = await (await GET(getReq('p1', 'e1_p1'))).json()
    expect(body.typed).toBe(QUESTIONS)
    expect(body.quotes).toEqual([])
    expect(body.repeat).toBe(false)
  })

  it('works for an owner', async () => {
    mockGetProjectRole.mockResolvedValue('owner')
    expect((await GET(getReq('p1', 'e1_p1'))).status).toBe(200)
  })

  it('carries no sender address, message id, attachments or raw text', async () => {
    const body = await (await GET(getReq('p1', 'e2_p1'))).json()
    expect(Object.keys(body).sort()).toEqual([
      'from_name',
      'from_role',
      'id',
      'quotes',
      'received_at',
      'repeat',
      'subject',
      'truncated',
      'typed',
    ])
    expect(body).not.toHaveProperty('from_email')
    const raw = JSON.stringify(body)
    expect(raw).not.toContain('tm@yahoo.com')
    expect(raw).not.toContain('<m2@example.com>')
    expect(raw).not.toContain('secret.pdf')
  })

  it('logs nothing, so no text or subject reaches the logs', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    await GET(getReq('p1', 'e2_p1'))
    await GET(getReq('p1', 'nope'))
    expect(logSpy).not.toHaveBeenCalled()
    expect(errorSpy).not.toHaveBeenCalled()
    logSpy.mockRestore()
    errorSpy.mockRestore()
  })
})
