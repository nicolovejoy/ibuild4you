import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import emailReceived from './fixtures/email-received.json'
import receivedEmail from './fixtures/received-email.json'

// =============================================================================
// Tests for POST /api/webhooks/resend/inbound.
//
// Mocks: svix verifier, Firebase admin (firestore), and global fetch (for the
// inbound body retrieval). The route never makes a real network call here.
//
// Two branches: Loop feedback replies (feedback+<id>@…, the feedback mocks
// below) and email-in project emails (a project's email_in_address, the
// in-memory tables below). The project tests use the two recorded fixtures.
// =============================================================================

// --- svix mock --------------------------------------------------------------
// vi.mock is hoisted, so all referenced names must be defined inside the
// factory. We grab the fake error class back out via `await import('svix')`
// in tests that need to throw it.
vi.mock('svix', () => {
  class FakeWebhookVerificationError extends Error {}
  const verify = vi.fn<(body: string) => unknown>()
  return {
    Webhook: vi.fn().mockImplementation(() => ({ verify })),
    WebhookVerificationError: FakeWebhookVerificationError,
    __mockVerify: verify, // test-only handle for assertions
  }
})

// FieldValue.increment as a marker the fake tables can apply.
vi.mock('firebase-admin/firestore', () => ({
  FieldValue: { increment: (n: number) => ({ __increment: n }) },
}))

// Re-fetch the mocked verify handle once at module load.
import * as svixMock from 'svix'
const mockVerify = (svixMock as unknown as { __mockVerify: ReturnType<typeof vi.fn> }).__mockVerify
const FakeWebhookVerificationError = (
  svixMock as unknown as { WebhookVerificationError: new (m: string) => Error }
).WebhookVerificationError

// --- firestore mock: Loop feedback -------------------------------------------
const mockReplyAdd = vi.fn<(doc: Record<string, unknown>) => Promise<{ id: string }>>(async () => ({
  id: 'reply-1',
}))
const mockFeedbackUpdate = vi.fn<(patch: Record<string, unknown>) => Promise<void>>(
  async () => undefined
)
const mockFeedbackGet = vi.fn<
  () => Promise<{ exists: boolean; data?: () => Record<string, unknown> }>
>(async () => ({ exists: true, data: () => ({ status: 'acknowledged' }) }))
const mockFeedbackDoc = vi.fn(() => ({
  get: mockFeedbackGet,
  update: mockFeedbackUpdate,
  collection: vi.fn(() => ({ add: mockReplyAdd })),
}))

// --- firestore mock: email-in tables -----------------------------------------
// In-memory projects, project_members, users and project_emails, with the
// calls the route and lib/email-in/store make: doc(id).get()/update(),
// where(field,'==',v)[.limit()|.select()].get(), and an all-or-nothing batch.
type Doc = Record<string, unknown>
const tables: Record<string, Map<string, Doc>> = {}

function table(name: string): Map<string, Doc> {
  if (!tables[name]) tables[name] = new Map()
  return tables[name]
}

// Apply an update patch with dotted keys and increment markers, the way
// Firestore's update() does.
function applyPatch(target: Doc, patch: Doc): Doc {
  const out: Doc = structuredClone(target)
  for (const [key, value] of Object.entries(patch)) {
    const path = key.split('.')
    let node = out
    for (const part of path.slice(0, -1)) {
      if (typeof node[part] !== 'object' || node[part] === null) node[part] = {}
      node = node[part] as Doc
    }
    const last = path[path.length - 1]
    const inc = (value as { __increment?: number } | null)?.__increment
    node[last] = inc !== undefined ? ((node[last] as number | undefined) ?? 0) + inc : value
  }
  return out
}

const alreadyExists = () => Object.assign(new Error('6 ALREADY_EXISTS'), { code: 6 })
const notFound = () => Object.assign(new Error('5 NOT_FOUND'), { code: 5 })

// Every where() query the route makes, to count lookups.
const queries: Array<{ collection: string; field: string; value: unknown }> = []

function fakeCollection(name: string) {
  const query = (field: string, value: unknown) => {
    queries.push({ collection: name, field, value })
    const q = {
      limit: () => q,
      select: () => q,
      get: async () => {
        const docs = [...table(name).entries()]
          .filter(([, d]) => d[field] === value)
          .map(([id, d]) => ({ id, data: () => structuredClone(d) }))
        return { docs, empty: docs.length === 0, size: docs.length }
      },
    }
    return q
  }
  return {
    doc: (id: string) => ({
      __collection: name,
      __id: id,
      get: async () => {
        const d = table(name).get(id)
        return { id, exists: d !== undefined, data: () => (d ? structuredClone(d) : undefined) }
      },
      update: async (patch: Doc) => {
        const d = table(name).get(id)
        if (!d) throw notFound()
        table(name).set(id, applyPatch(d, patch))
      },
    }),
    where: (field: string, op: string, value: unknown) => {
      if (op !== '==') throw new Error(`unexpected op ${op}`)
      return query(field, value)
    },
  }
}

function fakeBatch() {
  type Ref = { __collection: string; __id: string }
  const writes: Array<{ kind: 'create' | 'update'; ref: Ref; data: Doc }> = []
  const b = {
    create: (ref: Ref, data: Doc) => (writes.push({ kind: 'create', ref, data }), b),
    update: (ref: Ref, data: Doc) => (writes.push({ kind: 'update', ref, data }), b),
    commit: async () => {
      for (const w of writes) {
        const has = table(w.ref.__collection).has(w.ref.__id)
        if (w.kind === 'create' && has) throw alreadyExists()
        if (w.kind === 'update' && !has) throw notFound()
      }
      for (const w of writes) {
        const t = table(w.ref.__collection)
        t.set(
          w.ref.__id,
          w.kind === 'create' ? structuredClone(w.data) : applyPatch(t.get(w.ref.__id)!, w.data)
        )
      }
    },
  }
  return b
}

vi.mock('@/lib/firebase/admin', () => ({
  getAdminDb: vi.fn(() => ({
    batch: fakeBatch,
    collection: vi.fn((name: string) => {
      if (name === 'feedback') return { doc: mockFeedbackDoc }
      return fakeCollection(name)
    }),
  })),
  getAdminAuth: vi.fn(),
}))

// --- import under test (after mocks) ---------------------------------------
import { POST } from '../route'
import { FEEDBACK_INBOX_HOST } from '@/lib/feedback/inbound'
import { EMAIL_TEXT_MAX } from '@/lib/email-in/store'

// --- helpers ---------------------------------------------------------------
const ORIGINAL_FETCH = globalThis.fetch
const ORIGINAL_ENV = { ...process.env }

function makeRequest(
  body: Record<string, unknown>,
  opts: { headers?: Record<string, string> } = {}
) {
  return new Request('http://localhost/api/webhooks/resend/inbound', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'svix-id': 'msg_1',
      'svix-timestamp': String(Math.floor(Date.now() / 1000)),
      'svix-signature': 'v1,fake',
      ...(opts.headers ?? {}),
    },
    body: JSON.stringify(body),
  })
}

function receivedEvent(overrides: Record<string, unknown> = {}) {
  return {
    type: 'email.received',
    data: {
      email_id: 'em_123',
      from: 'sam@example.com',
      to: [`feedback+fb-1@${FEEDBACK_INBOX_HOST}`],
      subject: 'Re: Update on your feedback',
      message_id: '<thread@example.com>',
      ...overrides,
    },
  }
}

// The recorded webhook body, with fields of `data` replaced.
function projectEvent(dataOverrides: Record<string, unknown> = {}) {
  const event = structuredClone(emailReceived)
  return { ...event, data: { ...event.data, ...dataOverrides } }
}

// The recorded fetched email, with fields replaced. `headers` merges.
function fetchedEmail(overrides: Record<string, unknown> = {}) {
  const email = structuredClone(receivedEmail) as Record<string, unknown>
  const { headers, ...rest } = overrides
  return {
    ...email,
    ...rest,
    headers: { ...(email.headers as Doc), ...((headers as Doc | undefined) ?? {}) },
  }
}

// A fetch that answers with `body` as JSON, recording the calls.
function mockFetchJson(body: unknown, status = 200) {
  const fn = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(
    async () =>
      new Response(JSON.stringify(body), {
        status,
        headers: { 'Content-Type': 'application/json' },
      })
  )
  globalThis.fetch = fn as unknown as typeof fetch
  return fn
}

const EMAIL_ID = emailReceived.data.email_id
const P1_ADDRESS = 'capture-test@inbox.ibuild4you.com' // the recorded recipient
const P2_ADDRESS = 'second-ab12@inbox.ibuild4you.com'
const BILL = 'bduris@example.com' // the recorded sender

// Two projects with addresses; Bill is the maker of both, Nico owns p1.
// Bill has a users row (display name "Bill D"); Nico has none.
function seedTables() {
  for (const name of Object.keys(tables)) delete tables[name]
  queries.length = 0
  table('projects').set('p1', { title: 'One', email_in_address: P1_ADDRESS })
  table('projects').set('p2', { title: 'Two', email_in_address: P2_ADDRESS })
  table('projects').set('p3', { title: 'No address' })
  table('project_members').set('m1', {
    project_id: 'p1',
    email: BILL,
    role: 'maker',
    user_id: 'u1',
  })
  table('project_members').set('m2', { project_id: 'p1', email: 'nico@example.org', role: 'owner' })
  table('project_members').set('m3', {
    project_id: 'p2',
    email: BILL,
    role: 'maker',
    user_id: 'u1',
  })
  table('users').set('u1', { first_name: 'Bill', last_name: 'Duris' })
}

// Everything logged during the test, as one string.
let logSpies: Array<ReturnType<typeof vi.spyOn>> = []
function loggedText(): string {
  return logSpies
    .flatMap((s) => s.mock.calls)
    .flat()
    .map((a) => (typeof a === 'string' ? a : JSON.stringify(a)))
    .join('\n')
}

function loggedEvents(): Array<Record<string, unknown>> {
  return logSpies
    .flatMap((s) => s.mock.calls)
    .map((c) => c[0])
    .filter((a): a is string => typeof a === 'string' && a.startsWith('{'))
    .map((a) => JSON.parse(a))
}

beforeEach(() => {
  vi.clearAllMocks()
  process.env = { ...ORIGINAL_ENV, RESEND_INBOUND_SECRET: 'whsec_test', RESEND_API_KEY: 'rk_test' }
  delete process.env.RESEND_INBOUND_FETCH_URL
  // Default: signature valid — verify() returns the parsed payload.
  mockVerify.mockImplementation((raw: string) => JSON.parse(raw))
  // Default: body fetch returns text successfully.
  globalThis.fetch = vi.fn(
    async () =>
      new Response(JSON.stringify({ text: 'Two more notes on the bug.' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
  ) as unknown as typeof fetch
  // Default: feedback doc exists.
  mockFeedbackGet.mockResolvedValue({
    exists: true,
    data: () => ({ status: 'acknowledged' }),
  })
  seedTables()
  // Capture logs: keeps the output clean and lets tests check what is logged.
  logSpies = [
    vi.spyOn(console, 'log').mockImplementation(() => {}),
    vi.spyOn(console, 'warn').mockImplementation(() => {}),
    vi.spyOn(console, 'error').mockImplementation(() => {}),
  ]
})

afterEach(() => {
  globalThis.fetch = ORIGINAL_FETCH
  process.env = ORIGINAL_ENV
  for (const s of logSpies) s.mockRestore()
})

describe('POST /api/webhooks/resend/inbound — auth & config', () => {
  it('500s when RESEND_INBOUND_SECRET is unset (refuses inbound rather than accepting unsigned)', async () => {
    delete process.env.RESEND_INBOUND_SECRET
    const res = await POST(makeRequest(receivedEvent()))
    expect(res.status).toBe(500)
    expect(mockReplyAdd).not.toHaveBeenCalled()
  })

  it('401s on signature verification failure', async () => {
    mockVerify.mockImplementation(() => {
      throw new FakeWebhookVerificationError('bad sig')
    })
    const res = await POST(makeRequest(receivedEvent()))
    expect(res.status).toBe(401)
    expect(mockReplyAdd).not.toHaveBeenCalled()
    expect(mockFeedbackUpdate).not.toHaveBeenCalled()
  })

  it('401s on a bad signature for a project email and writes nothing', async () => {
    mockVerify.mockImplementation(() => {
      throw new FakeWebhookVerificationError('bad sig')
    })
    const fetchFn = mockFetchJson(fetchedEmail())
    const before = structuredClone(table('projects'))
    const res = await POST(makeRequest(projectEvent()))
    expect(res.status).toBe(401)
    expect(fetchFn).not.toHaveBeenCalled()
    expect(table('project_emails').size).toBe(0)
    expect(table('projects')).toEqual(before)
  })
})

describe('POST /api/webhooks/resend/inbound — routing', () => {
  it('ignores non-received event types with 200 (so Resend stops retrying)', async () => {
    const res = await POST(makeRequest({ type: 'email.delivered', data: {} }))
    expect(res.status).toBe(200)
    const j = await res.json()
    expect(j.ignored).toBe('email.delivered')
    expect(mockReplyAdd).not.toHaveBeenCalled()
  })

  it('ignores received events with no plus-addressed recipient', async () => {
    const res = await POST(makeRequest(receivedEvent({ to: ['support@elsewhere.com'] })))
    expect(res.status).toBe(200)
    const j = await res.json()
    expect(j.ignored).toBe('no-feedback-id')
    expect(mockReplyAdd).not.toHaveBeenCalled()
  })

  it('logs no recipient address when nothing matches', async () => {
    await POST(makeRequest(receivedEvent({ to: ['support@elsewhere.com'] })))
    expect(loggedText()).not.toMatch(/@/)
  })

  it('ignores received events when the feedback doc does not exist', async () => {
    mockFeedbackGet.mockResolvedValueOnce({ exists: false })
    const res = await POST(makeRequest(receivedEvent()))
    expect(res.status).toBe(200)
    const j = await res.json()
    expect(j.ignored).toBe('feedback-not-found')
    expect(mockReplyAdd).not.toHaveBeenCalled()
    expect(mockFeedbackUpdate).not.toHaveBeenCalled()
  })
})

describe('POST /api/webhooks/resend/inbound — happy path', () => {
  it('writes a reply with the fetched body and bumps the parent to new', async () => {
    const res = await POST(makeRequest(receivedEvent()))
    expect(res.status).toBe(200)
    const j = await res.json()
    expect(j.feedback_id).toBe('fb-1')

    expect(mockFeedbackDoc).toHaveBeenCalledWith('fb-1')

    expect(mockReplyAdd).toHaveBeenCalledOnce()
    const written = mockReplyAdd.mock.calls[0][0]
    expect(written.feedback_id).toBe('fb-1')
    expect(written.from).toBe('submitter')
    expect(written.from_email).toBe('sam@example.com')
    expect(written.body).toBe('Two more notes on the bug.')
    expect(written.via_email).toBe(true)

    expect(mockFeedbackUpdate).toHaveBeenCalledOnce()
    const patch = mockFeedbackUpdate.mock.calls[0][0]
    expect(patch.status).toBe('new')
    expect(patch.archived_at).toBeNull()
    expect(typeof patch.updated_at).toBe('string')
  })

  it('reads the body through the receiving endpoint', async () => {
    const fn = mockFetchJson({ text: 'Two more notes on the bug.' })
    await POST(makeRequest(receivedEvent()))
    expect(fn).toHaveBeenCalledOnce()
    expect(fn.mock.calls[0][0]).toBe('https://api.resend.com/emails/receiving/em_123')
  })

  it('falls back to a placeholder body when Resend body fetch fails (still writes the reply)', async () => {
    globalThis.fetch = vi.fn(
      async () => new Response('{"error":"not found"}', { status: 404 })
    ) as unknown as typeof fetch
    const res = await POST(makeRequest(receivedEvent()))
    expect(res.status).toBe(200)
    expect(mockReplyAdd).toHaveBeenCalledOnce()
    const written = mockReplyAdd.mock.calls[0][0] as { body: string }
    expect(written.body).toMatch(/Reply received/)
    expect(written.body).toMatch(/body retrieval failed/)
    expect(written.body).toContain('Subject: Re: Update on your feedback')
    // Status bump still happens — admin needs to see the row.
    expect(mockFeedbackUpdate).toHaveBeenCalledOnce()
  })

  it('uses the placeholder when the fetched email has no text or html', async () => {
    mockFetchJson({ text: null, html: null })
    const res = await POST(makeRequest(receivedEvent()))
    expect(res.status).toBe(200)
    const written = mockReplyAdd.mock.calls[0][0] as { body: string }
    expect(written.body).toMatch(/Reply received/)
    expect(written.body).toMatch(/no text or html/)
  })

  it('strips HTML when text is absent but html is present', async () => {
    globalThis.fetch = vi.fn(
      async () =>
        new Response(JSON.stringify({ html: '<p>Hi <b>there</b></p><p>Two notes.</p>' }), {
          status: 200,
        })
    ) as unknown as typeof fetch
    const res = await POST(makeRequest(receivedEvent()))
    expect(res.status).toBe(200)
    const written = mockReplyAdd.mock.calls[0][0] as { body: string }
    expect(written.body).toContain('Hi there')
    expect(written.body).toContain('Two notes.')
    expect(written.body).not.toContain('<p>')
  })
})

describe('POST /api/webhooks/resend/inbound — project email (email-in)', () => {
  // The app's clock while the webhook runs. received_at is this moment, not
  // Resend's created_at (2026-11-20T17:47:09.765Z in the fixture): an email
  // stored late, after a retry, must still sort after anything noted before it.
  const NOW = '2026-11-21T09:00:00.000Z'
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(NOW))
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('stores the recorded email for the project whose address is on CC', async () => {
    const fetchFn = mockFetchJson(fetchedEmail())
    const res = await POST(makeRequest(projectEvent()))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({
      ok: true,
      project_emails: [{ project_id: 'p1', outcome: 'stored' }],
    })

    // The address is in received_for, to and cc: still one fetch, one doc.
    expect(fetchFn).toHaveBeenCalledOnce()
    expect(fetchFn.mock.calls[0][0]).toBe(`https://api.resend.com/emails/receiving/${EMAIL_ID}`)
    expect([...table('project_emails').keys()]).toEqual([`${EMAIL_ID}_p1`])
    expect(table('project_emails').get(`${EMAIL_ID}_p1`)).toEqual({
      project_id: 'p1',
      from_email: BILL,
      from_name: 'Bill D',
      from_role: 'maker',
      received_at: NOW,
      sent_at: '2026-11-20T17:44:55.000Z',
      subject: 'Re: lesson planner',
      message_id: '<REPLY-0001@example.com>',
      text: receivedEmail.text,
      truncated: false,
      attachments: [],
    })
    expect(table('projects').get('p1')?.last_email_at).toBe(NOW)
    expect(mockReplyAdd).not.toHaveBeenCalled()
  })

  it('matches the project address on CC alone', async () => {
    mockFetchJson(fetchedEmail())
    const res = await POST(
      makeRequest(projectEvent({ to: ['nico@example.org'], received_for: [], cc: [P1_ADDRESS] }))
    )
    expect(res.status).toBe(200)
    expect(table('project_emails').has(`${EMAIL_ID}_p1`)).toBe(true)
  })

  it('stamps builder for an owner, with the local part as name when there is no users row', async () => {
    mockFetchJson(fetchedEmail({ from: 'nico@example.org', headers: { from: 'nico@example.org' } }))
    await POST(makeRequest(projectEvent({ from: 'nico@example.org' })))
    const doc = table('project_emails').get(`${EMAIL_ID}_p1`)
    expect(doc?.from_role).toBe('builder')
    expect(doc?.from_name).toBe('nico')
  })

  it('cuts text longer than EMAIL_TEXT_MAX and marks it truncated', async () => {
    const long = 'a'.repeat(EMAIL_TEXT_MAX) + 'QUOTED-HISTORY'
    mockFetchJson(fetchedEmail({ text: long }))
    await POST(makeRequest(projectEvent()))
    const doc = table('project_emails').get(`${EMAIL_ID}_p1`)
    expect(doc?.text).toBe('a'.repeat(EMAIL_TEXT_MAX))
    expect(doc?.truncated).toBe(true)
  })

  it('stores an email with no body as empty text', async () => {
    mockFetchJson(fetchedEmail({ text: null, html: null }))
    const res = await POST(makeRequest(projectEvent()))
    expect(res.status).toBe(200)
    expect(table('project_emails').get(`${EMAIL_ID}_p1`)?.text).toBe('')
  })

  it('logs one email_in_accepted line with ids only', async () => {
    mockFetchJson(fetchedEmail())
    await POST(makeRequest(projectEvent()))
    expect(loggedEvents()).toEqual([
      { event: 'email_in_accepted', project_id: 'p1', email_id: EMAIL_ID, reason: 'stored' },
    ])
    const text = loggedText()
    expect(text).not.toMatch(/@/)
    expect(text).not.toContain('lesson planner')
    expect(text).not.toContain('week view')
  })

  it('a retried webhook is a duplicate: 200, the stored email unchanged', async () => {
    mockFetchJson(fetchedEmail())
    await POST(makeRequest(projectEvent()))
    // The retry comes an hour later: nothing moves to the new time.
    vi.setSystemTime(new Date('2026-11-21T10:00:00.000Z'))
    mockFetchJson(fetchedEmail({ text: 'changed', created_at: '2026-11-21T00:00:00.000Z' }))
    const res = await POST(makeRequest(projectEvent()))
    expect(res.status).toBe(200)
    expect((await res.json()).project_emails).toEqual([{ project_id: 'p1', outcome: 'duplicate' }])
    expect(table('project_emails').get(`${EMAIL_ID}_p1`)?.text).toBe(receivedEmail.text)
    expect(table('project_emails').get(`${EMAIL_ID}_p1`)?.received_at).toBe(NOW)
    expect(table('projects').get('p1')?.last_email_at).toBe(NOW)
    expect(table('projects').get('p1')?.email_in_dropped).toBeUndefined()
  })

  it('a non-member is dropped: no doc, not_member counted, no address kept, 200', async () => {
    const stranger = 'stranger@x.com'
    mockFetchJson(fetchedEmail({ from: stranger, headers: { from: `"Stranger" <${stranger}>` } }))
    const res = await POST(makeRequest(projectEvent({ from: stranger })))
    expect(res.status).toBe(200)
    expect((await res.json()).project_emails).toEqual([{ project_id: 'p1', outcome: 'not_member' }])
    expect(table('project_emails').size).toBe(0)
    const project = table('projects').get('p1')!
    expect((project.email_in_dropped as Doc).not_member).toBe(1)
    expect(project.last_email_at).toBeUndefined()
    expect(JSON.stringify(project)).not.toContain('stranger')
    expect(loggedEvents()).toEqual([
      { event: 'email_in_dropped', project_id: 'p1', email_id: EMAIL_ID, reason: 'not_member' },
    ])
    expect(loggedText()).not.toMatch(/@/)
  })

  it('a member address failing DMARC is dropped: auth_failed counted with the address', async () => {
    mockFetchJson(fetchedEmail({ authentication: { spf: 'pass', dkim: 'pass', dmarc: 'fail' } }))
    const res = await POST(makeRequest(projectEvent()))
    expect(res.status).toBe(200)
    expect(table('project_emails').size).toBe(0)
    const dropped = table('projects').get('p1')!.email_in_dropped as Doc
    expect(dropped.auth_failed).toBe(1)
    expect(dropped.last_auth_failed_from).toBe(BILL)
    expect(loggedEvents()).toEqual([
      { event: 'email_in_dropped', project_id: 'p1', email_id: EMAIL_ID, reason: 'auth_failed' },
    ])
    expect(loggedText()).not.toMatch(/@/)
  })

  it('no authentication block at all is auth_failed', async () => {
    mockFetchJson(fetchedEmail({ authentication: null }))
    await POST(makeRequest(projectEvent()))
    expect(table('project_emails').size).toBe(0)
    expect((table('projects').get('p1')!.email_in_dropped as Doc).auth_failed).toBe(1)
  })

  it('a From header naming a member over a different top-level from is not_member', async () => {
    // The header claims Bill; Resend's parsed address (the one DMARC passed
    // for) is someone else's.
    mockFetchJson(fetchedEmail({ from: 'attacker@evil.com' }))
    await POST(makeRequest(projectEvent({ from: 'attacker@evil.com' })))
    expect(table('project_emails').size).toBe(0)
    const dropped = table('projects').get('p1')!.email_in_dropped as Doc
    expect(dropped.not_member).toBe(1)
    expect(dropped.auth_failed).toBeUndefined()
    expect(dropped.last_auth_failed_from).toBeUndefined()
  })

  it('a top-level from naming a member under a stranger From header is not_member', async () => {
    mockFetchJson(fetchedEmail({ headers: { from: '"Bill" <attacker@evil.com>' } }))
    await POST(makeRequest(projectEvent()))
    expect(table('project_emails').size).toBe(0)
    expect((table('projects').get('p1')!.email_in_dropped as Doc).not_member).toBe(1)
  })

  it('a disagreeing From on a DMARC fail is not_member and keeps no address', async () => {
    mockFetchJson(fetchedEmail({ from: 'attacker@evil.com', authentication: { dmarc: 'fail' } }))
    await POST(makeRequest(projectEvent({ from: 'attacker@evil.com' })))
    const dropped = table('projects').get('p1')!.email_in_dropped as Doc
    expect(dropped.not_member).toBe(1)
    expect(dropped.last_auth_failed_from).toBeUndefined()
  })

  it('an unparsable From header is not_member', async () => {
    mockFetchJson(fetchedEmail({ headers: { from: `"<${BILL}>" <attacker@evil.com>` } }))
    await POST(makeRequest(projectEvent()))
    expect(table('project_emails').size).toBe(0)
    expect((table('projects').get('p1')!.email_in_dropped as Doc).not_member).toBe(1)
  })

  it('no From header is not_member, even when the top-level from is a member', async () => {
    const email = fetchedEmail()
    delete (email.headers as Doc).from
    mockFetchJson(email)
    const res = await POST(makeRequest(projectEvent()))
    expect(res.status).toBe(200)
    expect(table('project_emails').size).toBe(0)
    expect((table('projects').get('p1')!.email_in_dropped as Doc).not_member).toBe(1)
    expect(loggedEvents()).toEqual([
      { event: 'email_in_dropped', project_id: 'p1', email_id: EMAIL_ID, reason: 'not_member' },
    ])
  })

  it('two From headers (an array, one a member) are not_member', async () => {
    mockFetchJson(
      fetchedEmail({ headers: { from: [`"Bill Duris" <${BILL}>`, 'attacker@evil.com'] } })
    )
    await POST(makeRequest(projectEvent({ cc: [P1_ADDRESS, P2_ADDRESS] })))
    expect(table('project_emails').size).toBe(0)
    expect((table('projects').get('p1')!.email_in_dropped as Doc).not_member).toBe(1)
    expect((table('projects').get('p2')!.email_in_dropped as Doc).not_member).toBe(1)
    expect(JSON.stringify([...table('projects').values()])).not.toContain('attacker')
  })

  it('a fetched email with no headers object is not_member', async () => {
    const email = fetchedEmail() as Record<string, unknown>
    delete email.headers
    mockFetchJson(email)
    await POST(makeRequest(projectEvent()))
    expect(table('project_emails').size).toBe(0)
    expect((table('projects').get('p1')!.email_in_dropped as Doc).not_member).toBe(1)
  })

  it('the 51st email in 24 hours is dropped as over_limit', async () => {
    const at = Date.parse(NOW)
    for (let i = 0; i < 50; i++) {
      table('project_emails').set(`seed${i}_p1`, {
        project_id: 'p1',
        received_at: new Date(at - (i + 1) * 60_000).toISOString(),
      })
    }
    mockFetchJson(fetchedEmail())
    const res = await POST(makeRequest(projectEvent()))
    expect(res.status).toBe(200)
    expect(table('project_emails').has(`${EMAIL_ID}_p1`)).toBe(false)
    expect((table('projects').get('p1')!.email_in_dropped as Doc).over_limit).toBe(1)
    expect(loggedEvents()).toEqual([
      { event: 'email_in_dropped', project_id: 'p1', email_id: EMAIL_ID, reason: 'over_limit' },
    ])
  })

  it('a failed body fetch answers 500 and writes nothing', async () => {
    mockFetchJson({ error: 'not found' }, 404)
    const before = structuredClone(table('projects'))
    const res = await POST(makeRequest(projectEvent()))
    expect(res.status).toBe(500)
    expect(table('project_emails').size).toBe(0)
    expect(table('projects')).toEqual(before)
    expect(loggedEvents()).toEqual([
      {
        event: 'email_in_fetch_failed',
        email_id: EMAIL_ID,
        reason: 'fetch_failed',
        projects: 1,
        loop: false,
      },
    ])
  })

  // F12: the same event covers a Loop reply alone, told apart by its fields.
  it('a failed body fetch for a Loop reply alone logs projects 0 and loop true', async () => {
    mockFetchJson({ error: 'not found' }, 404)
    const res = await POST(makeRequest(receivedEvent()))
    expect(res.status).toBe(200)
    expect(loggedEvents()).toEqual([
      { event: 'email_in_fetch_failed', email_id: 'em_123', reason: 'fetch_failed', projects: 0, loop: true },
    ])
  })

  it('a failed body fetch for a project and a Loop reply logs both', async () => {
    mockFetchJson({ error: 'not found' }, 404)
    await POST(
      makeRequest(projectEvent({ to: [`feedback+fb-1@${FEEDBACK_INBOX_HOST}`], cc: [P1_ADDRESS, P2_ADDRESS] }))
    )
    expect(loggedEvents()).toEqual([
      { event: 'email_in_fetch_failed', email_id: EMAIL_ID, reason: 'fetch_failed', projects: 2, loop: true },
    ])
  })

  it('a failed body fetch with a Loop reply too answers 500 and writes neither', async () => {
    mockFetchJson({ error: 'not found' }, 404)
    const res = await POST(
      makeRequest(projectEvent({ to: [`feedback+fb-1@${FEEDBACK_INBOX_HOST}`, P1_ADDRESS] }))
    )
    expect(res.status).toBe(500)
    expect(table('project_emails').size).toBe(0)
    expect(mockReplyAdd).not.toHaveBeenCalled()
    expect(mockFeedbackUpdate).not.toHaveBeenCalled()
  })

  // A bad id is permanent: answering 500 would only make Resend retry it.
  it('an email_id that is not an id shape: 200, no fetch, nothing written, the id not logged', async () => {
    const fetchFn = mockFetchJson(fetchedEmail())
    const before = structuredClone(table('projects'))
    const res = await POST(makeRequest(projectEvent({ email_id: 'a/b/c-SECRET' })))
    expect(res.status).toBe(200)
    expect((await res.json()).ignored).toBe('bad-email-id')
    expect(fetchFn).not.toHaveBeenCalled()
    expect(table('project_emails').size).toBe(0)
    expect(table('projects')).toEqual(before)
    expect(loggedEvents()).toEqual([
      { event: 'email_in_fetch_failed', reason: 'bad_email_id', projects: 1, loop: false },
    ])
    expect(loggedText()).not.toContain('SECRET')
  })

  it('a missing or non-string email_id: 200, no fetch, nothing written', async () => {
    for (const email_id of [undefined, '', 42, { id: EMAIL_ID }]) {
      const fetchFn = mockFetchJson(fetchedEmail())
      const res = await POST(makeRequest(projectEvent({ email_id })))
      expect(res.status).toBe(200)
      expect(fetchFn).not.toHaveBeenCalled()
    }
    expect(table('project_emails').size).toBe(0)
    expect(table('projects').get('p1')?.email_in_dropped).toBeUndefined()
  })

  it('a bad email_id with a Loop reply too: the reply gets the placeholder, the project nothing', async () => {
    const fetchFn = mockFetchJson(fetchedEmail())
    const res = await POST(
      makeRequest(
        projectEvent({
          email_id: 'a/b',
          to: [`feedback+fb-1@${FEEDBACK_INBOX_HOST}`],
          cc: [P1_ADDRESS],
        })
      )
    )
    expect(res.status).toBe(200)
    expect((await res.json()).feedback_id).toBe('fb-1')
    expect(fetchFn).not.toHaveBeenCalled()
    expect(table('project_emails').size).toBe(0)
    expect(mockReplyAdd).toHaveBeenCalledOnce()
    expect((mockReplyAdd.mock.calls[0][0] as { body: string }).body).toMatch(/Reply received/)
    expect(mockFeedbackUpdate).toHaveBeenCalledOnce()
  })

  it('no project holding the address: 200, no fetch, nothing written', async () => {
    const fetchFn = mockFetchJson(fetchedEmail())
    const unknown = 'nobody-zz99@inbox.ibuild4you.com'
    const before = structuredClone(table('projects'))
    const res = await POST(
      makeRequest(projectEvent({ to: [unknown], cc: [unknown], received_for: [unknown] }))
    )
    expect(res.status).toBe(200)
    expect((await res.json()).ignored).toBe('no-project')
    expect(fetchFn).not.toHaveBeenCalled()
    expect(table('project_emails').size).toBe(0)
    expect(table('projects')).toEqual(before)
    expect(loggedText()).not.toMatch(/@/)
  })

  it('two project addresses: one doc per project from one fetch', async () => {
    const fetchFn = mockFetchJson(fetchedEmail())
    const res = await POST(makeRequest(projectEvent({ cc: [P1_ADDRESS, P2_ADDRESS] })))
    expect(res.status).toBe(200)
    expect(fetchFn).toHaveBeenCalledOnce()
    expect([...table('project_emails').keys()].sort()).toEqual([`${EMAIL_ID}_p1`, `${EMAIL_ID}_p2`])
    expect(table('project_emails').get(`${EMAIL_ID}_p2`)?.project_id).toBe('p2')
    // One clock reading for the whole webhook: both copies carry the same time.
    expect(table('project_emails').get(`${EMAIL_ID}_p1`)?.received_at).toBe(NOW)
    expect(table('project_emails').get(`${EMAIL_ID}_p2`)?.received_at).toBe(NOW)
    expect(table('projects').get('p2')?.last_email_at).toBe(NOW)
  })

  it('each project checks its own members', async () => {
    // Nico is a member of p1 only.
    mockFetchJson(fetchedEmail({ from: 'nico@example.org', headers: { from: 'nico@example.org' } }))
    const res = await POST(
      makeRequest(projectEvent({ from: 'nico@example.org', cc: [P1_ADDRESS, P2_ADDRESS] }))
    )
    expect((await res.json()).project_emails).toEqual([
      { project_id: 'p1', outcome: 'stored' },
      { project_id: 'p2', outcome: 'not_member' },
    ])
    expect([...table('project_emails').keys()]).toEqual([`${EMAIL_ID}_p1`])
  })

  it('a project address and a Loop reply address: both are written', async () => {
    mockFetchJson(fetchedEmail())
    const res = await POST(
      makeRequest(projectEvent({ to: [`feedback+fb-1@${FEEDBACK_INBOX_HOST}`], cc: [P1_ADDRESS] }))
    )
    expect(res.status).toBe(200)
    const j = await res.json()
    expect(j.feedback_id).toBe('fb-1')
    expect(j.project_emails).toEqual([{ project_id: 'p1', outcome: 'stored' }])
    expect(table('project_emails').has(`${EMAIL_ID}_p1`)).toBe(true)
    expect(mockReplyAdd).toHaveBeenCalledOnce()
    const reply = mockReplyAdd.mock.calls[0][0]
    expect(reply.body).toBe(receivedEmail.text)
    expect(reply.from_email).toBe(BILL)
    expect(mockFeedbackUpdate).toHaveBeenCalledOnce()
  })

  it("received_at is the app's clock when it stores the email, never Resend's created_at", async () => {
    // Resend's times are a day earlier than the app's clock here: a retried
    // webhook that finally stores the email must not land behind a note.
    mockFetchJson(fetchedEmail({ created_at: '2026-11-20T00:00:00.000Z' }))
    await POST(makeRequest(projectEvent({ created_at: '2026-11-20T00:00:01.000Z' })))
    expect(table('project_emails').get(`${EMAIL_ID}_p1`)?.received_at).toBe(NOW)
    expect(table('projects').get('p1')?.last_email_at).toBe(NOW)
  })

  it('recipient fields of the wrong type are skipped, not a crash', async () => {
    mockFetchJson(fetchedEmail())
    const res = await POST(
      makeRequest(
        projectEvent({ to: 5, cc: { a: P1_ADDRESS }, bcc: null, received_for: [7, P1_ADDRESS] })
      )
    )
    expect(res.status).toBe(200)
    expect(table('project_emails').has(`${EMAIL_ID}_p1`)).toBe(true)
  })

  it('a payload whose data is not an object is ignored with 200', async () => {
    for (const data of ['text', 7, null, [P1_ADDRESS]]) {
      const res = await POST(makeRequest({ type: 'email.received', data }))
      expect(res.status).toBe(200)
    }
    expect(table('project_emails').size).toBe(0)
  })

  // F13: one Firestore query per address, so an email naming many inbox-host
  // addresses is capped.
  it('looks up at most 10 project addresses per email', async () => {
    mockFetchJson(fetchedEmail())
    const many = Array.from({ length: 12 }, (_, i) => `guess-${i}@inbox.ibuild4you.com`)
    const res = await POST(makeRequest(projectEvent({ to: many, cc: [], received_for: [] })))
    expect(res.status).toBe(200)
    const lookups = queries.filter((q) => q.collection === 'projects' && q.field === 'email_in_address')
    expect(lookups.map((q) => q.value)).toEqual(many.slice(0, 10))
  })

  // F14: a maker who never signed in has no users row; the project's requester
  // fields name them when the address is the requester's.
  it("names a member with no users row by the project's requester name when the address matches", async () => {
    table('projects').set('p1', {
      title: 'One',
      email_in_address: P1_ADDRESS,
      requester_email: 'BDuris@Example.com',
      requester_first_name: 'Bill',
      requester_last_name: 'Duris',
    })
    table('project_members').set('m1', { project_id: 'p1', email: BILL, role: 'maker' })
    mockFetchJson(fetchedEmail())
    await POST(makeRequest(projectEvent()))
    expect(table('project_emails').get(`${EMAIL_ID}_p1`)?.from_name).toBe('Bill D')
  })

  it('falls back to the local part when the requester is someone else or has no name', async () => {
    table('project_members').set('m1', { project_id: 'p1', email: BILL, role: 'maker' })
    table('projects').set('p1', {
      email_in_address: P1_ADDRESS,
      requester_email: 'someone@example.com',
      requester_first_name: 'Someone',
    })
    mockFetchJson(fetchedEmail())
    await POST(makeRequest(projectEvent()))
    expect(table('project_emails').get(`${EMAIL_ID}_p1`)?.from_name).toBe('bduris')

    seedTables()
    table('project_members').set('m1', { project_id: 'p1', email: BILL, role: 'maker' })
    table('projects').set('p1', { email_in_address: P1_ADDRESS, requester_email: BILL })
    mockFetchJson(fetchedEmail())
    await POST(makeRequest(projectEvent()))
    expect(table('project_emails').get(`${EMAIL_ID}_p1`)?.from_name).toBe('bduris')
  })

  it("prefers the member's own users row over the requester name", async () => {
    table('projects').set('p1', {
      email_in_address: P1_ADDRESS,
      requester_email: BILL,
      requester_first_name: 'William',
    })
    mockFetchJson(fetchedEmail())
    await POST(makeRequest(projectEvent()))
    expect(table('project_emails').get(`${EMAIL_ID}_p1`)?.from_name).toBe('Bill D')
  })

  it('a member row with a removed_at is not a member', async () => {
    table('project_members').set('m1', {
      project_id: 'p1',
      email: BILL,
      role: 'maker',
      user_id: 'u1',
      removed_at: '2026-11-01T00:00:00Z',
    })
    mockFetchJson(fetchedEmail())
    await POST(makeRequest(projectEvent()))
    expect(table('project_emails').size).toBe(0)
    expect((table('projects').get('p1')!.email_in_dropped as Doc).not_member).toBe(1)
  })
})
