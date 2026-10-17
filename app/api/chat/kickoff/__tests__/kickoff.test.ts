import { describe, it, expect, vi, beforeEach } from 'vitest'
import { POST } from '../route'

// =============================================================================
// KICKOFF ROUTE TESTS (#31)
//
// POST /api/chat/kickoff — agent greets the maker on session open without a
// maker turn. Verifies it:
//   - fires on returning-after-a-break (streams + stores an agent message,
//     stores NO maker message, stamps last_kickoff_at, sends a synthetic final
//     user turn to Claude)
//   - declines (200 no-op, no stream) when the maker is mid-turn or we already
//     greeted this return (the reload/multi-tab guard)
// =============================================================================

const mockGetProjectRole = vi.fn()

const addCalls: { collection: string; data: Record<string, unknown> }[] = []
const updateCalls: Record<string, unknown>[] = []

let docData: Record<string, { exists: boolean; data: () => Record<string, unknown> }>
let queryResults: Record<string, { id: string; data: () => Record<string, unknown> }[]>

const mockCollection = vi.fn((name: string) => ({
  add: vi.fn(async (data: Record<string, unknown>) => {
    addCalls.push({ collection: name, data })
    return { id: `new-${name}-id` }
  }),
  doc: vi.fn(() => ({
    get: vi.fn(async () => docData[name] || { exists: false, data: () => ({}) }),
    update: vi.fn(async (data: Record<string, unknown>) => {
      updateCalls.push(data)
    }),
  })),
  where: vi.fn(() => ({
    get: vi.fn(async () => {
      const docs = queryResults[name] || []
      return { docs, empty: docs.length === 0, size: docs.length }
    }),
    orderBy: vi.fn(() => ({
      get: vi.fn(async () => {
        const docs = queryResults[name] || []
        return { docs, empty: docs.length === 0, size: docs.length }
      }),
      limit: vi.fn(() => ({
        get: vi.fn(async () => {
          const docs = queryResults[name] || []
          return { docs, empty: docs.length === 0, size: docs.length }
        }),
      })),
    })),
  })),
}))

vi.mock('@/lib/api/firebase-server-helpers', () => ({
  getAuthenticatedUser: vi.fn(async () => ({
    uid: 'user-123',
    email: 'user@ibuild4you.com',
    error: null,
    systemRoles: [],
  })),
  getAdminDb: vi.fn(() => ({ collection: mockCollection })),
  getProjectRole: (...args: unknown[]) => mockGetProjectRole(...args),
  // The opener (authenticated caller) — used to name them in a multi-human greeting.
  getUserDisplayName: vi.fn(async () => 'Tomas'),
}))

let capturedStreamArgs: {
  model?: string
  temperature?: number
  max_tokens?: number
  output_config?: { effort?: string }
  system?: { type: string; text: string; cache_control?: unknown }[]
  messages?: { role: string; content: unknown }[]
} | null = null
const defaultStreamEvents = [
  { type: 'content_block_delta', delta: { type: 'text_delta', text: 'Welcome back!' } },
]
let mockStreamEvents = defaultStreamEvents
let mockFinalMessage: Record<string, unknown> = { usage: { input_tokens: 100, output_tokens: 50 } }

vi.mock('@anthropic-ai/sdk', () => ({
  default: vi.fn(() => ({
    messages: {
      stream: vi.fn(
        (args: {
          model?: string
          temperature?: number
          max_tokens?: number
          output_config?: { effort?: string }
          system?: { type: string; text: string; cache_control?: unknown }[]
          messages?: { role: string; content: unknown }[]
        }) => {
          capturedStreamArgs = args
          let index = 0
          return {
            [Symbol.asyncIterator]: () => ({
              next: async () => {
                if (index < mockStreamEvents.length) return { value: mockStreamEvents[index++], done: false }
                return { done: true, value: undefined }
              },
            }),
            finalMessage: vi.fn(async () => mockFinalMessage),
          }
        }
      ),
    },
  })),
}))

vi.mock('@/lib/agent/system-prompt', () => ({
  buildSystemPromptParts: vi.fn(() => ({ stable: 'You are a helpful assistant', volatile: null })),
}))

const resendSend = vi.fn(async () => ({ id: 'e1' }))
vi.mock('resend', () => ({ Resend: vi.fn(() => ({ emails: { send: resendSend } })) }))

// Owner lookup uses a query chain this file's db mock does not model.
let mockOwnerFirst: string | null = 'Nico'
vi.mock('@/lib/sessions/unqueued-greeting', async (orig) => ({
  ...(await orig<typeof import('@/lib/sessions/unqueued-greeting')>()),
  ownerFirstName: vi.fn(async () => mockOwnerFirst),
}))

vi.mock('@/lib/observability/anthropic', () => ({
  logAnthropicCall: vi.fn(async () => {}),
}))

function makeRequest(body: Record<string, unknown>) {
  return new Request('http://localhost/api/chat/kickoff', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  })
}

async function drain(response: Response) {
  const reader = response.body?.getReader()
  if (!reader) return ''
  const decoder = new TextDecoder()
  let out = ''
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    out += decoder.decode(value)
  }
  return out
}

const HOUR = 60 * 60 * 1000
const iso = (msAgo: number) => new Date(Date.now() - msAgo).toISOString()

function msg(role: 'user' | 'agent', msAgo: number, extra: Record<string, unknown> = {}) {
  return {
    id: `m-${role}-${msAgo}`,
    data: () => ({ role, content: `${role} text`, created_at: iso(msAgo), ...extra }),
  }
}

function setup(opts: {
  messages: { id: string; data: () => Record<string, unknown> }[]
  lastKickoffAt?: string | null
  lastMakerMessageAt?: string | null
  session?: Record<string, unknown>
  project?: Record<string, unknown>
}) {
  docData = {
    sessions: {
      exists: true,
      data: () => ({ project_id: 'proj-1', last_kickoff_at: opts.lastKickoffAt ?? null, ...opts.session }),
    },
    projects: {
      exists: true,
      data: () => ({
        requester_first_name: 'Sam',
        title: 'Cafe app',
        slug: 'cafe-app',
        last_maker_message_at: opts.lastMakerMessageAt ?? null,
        // Queued by default (pasted after the maker last spoke) so the model
        // path is exercised; #214 tests override this.
        payload_pasted_at: new Date().toISOString(),
        ...opts.project,
      }),
    },
  }
  queryResults = {
    messages: opts.messages,
    sessions: [{ id: 'sess-1', data: () => ({}) }],
    briefs: [],
    project_members: [],
  }
}

describe('POST /api/chat/kickoff', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    addCalls.length = 0
    mockStreamEvents = defaultStreamEvents
    mockFinalMessage = { usage: { input_tokens: 100, output_tokens: 50 } }
    vi.unstubAllEnvs()
    updateCalls.length = 0
    capturedStreamArgs = null
    mockGetProjectRole.mockResolvedValue('maker')
    mockOwnerFirst = 'Nico'
    vi.stubEnv('RESEND_API_KEY', 'k')
  })

  it('uses CHAT_MODEL with the 5.x request shape, like /api/chat (#184)', async () => {
    vi.stubEnv('CHAT_MODEL', 'claude-sonnet-5-5')
    setup({
      messages: [msg('agent', 5 * HOUR), msg('user', 3 * HOUR), msg('agent', 3 * HOUR)],
      lastMakerMessageAt: iso(3 * HOUR),
    })
    const res = await POST(makeRequest({ session_id: 'sess-1' }))
    await drain(res)
    expect(capturedStreamArgs?.model).toBe('claude-sonnet-5-5')
    expect(capturedStreamArgs?.temperature).toBeUndefined()
    expect(capturedStreamArgs?.output_config).toEqual({ effort: 'low' })
    expect(capturedStreamArgs?.max_tokens).toBe(8192)
  })

  it('does not store a greeting that came back empty (an empty agent turn 400s every later chat turn)', async () => {
    mockStreamEvents = []
    mockFinalMessage = { usage: { input_tokens: 100, output_tokens: 0 }, stop_reason: 'refusal' }
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    setup({
      messages: [msg('agent', 5 * HOUR), msg('user', 3 * HOUR), msg('agent', 3 * HOUR)],
      lastMakerMessageAt: iso(3 * HOUR),
    })
    const res = await POST(makeRequest({ session_id: 'sess-1' }))
    await drain(res)
    expect(addCalls.filter((c) => c.collection === 'messages')).toHaveLength(0)
    expect(warn).toHaveBeenCalledWith('kickoff_empty_response', expect.objectContaining({ stop_reason: 'refusal' }))
    warn.mockRestore()
  })

  it('fires on returning-after-a-break: streams + stores an agent message, no maker message', async () => {
    setup({
      messages: [msg('agent', 5 * HOUR), msg('user', 3 * HOUR), msg('agent', 3 * HOUR)],
      lastMakerMessageAt: iso(3 * HOUR),
    })
    const res = await POST(makeRequest({ session_id: 'sess-1' }))
    expect(res.headers.get('Content-Type')).toBe('text/event-stream')
    await drain(res)

    const stored = addCalls.filter((c) => c.collection === 'messages')
    expect(stored).toHaveLength(1)
    expect(stored[0].data.role).toBe('agent')
    expect(stored[0].data.content).toBe('Welcome back!')
    // No user/maker message was written.
    expect(stored.some((c) => c.data.role === 'user')).toBe(false)
  })

  it('caches the system prompt but not the synthetic messages (kickoff never advances last_maker_message_at, so its system prompt is very likely byte-identical to the next /api/chat turn)', async () => {
    setup({
      messages: [msg('agent', 5 * HOUR), msg('user', 3 * HOUR), msg('agent', 3 * HOUR)],
      lastMakerMessageAt: iso(3 * HOUR),
    })
    await drain(await POST(makeRequest({ session_id: 'sess-1' })))

    expect(capturedStreamArgs?.system).toEqual([
      { type: 'text', text: 'You are a helpful assistant', cache_control: { type: 'ephemeral' } },
    ])
    // The synthetic final turn never recurs — no message marker.
    const sent = capturedStreamArgs?.messages || []
    expect(sent.every((m) => typeof m.content === 'string')).toBe(true)
  })

  it('sends the gap recap as a second, unmarked system block so the cached prefix matches the next /api/chat turn', async () => {
    const { buildSystemPromptParts } = await import('@/lib/agent/system-prompt')
    vi.mocked(buildSystemPromptParts).mockReturnValueOnce({
      stable: 'You are a helpful assistant',
      volatile: '## Returning after a break\n\nrecap',
    })
    setup({
      messages: [msg('agent', 5 * HOUR), msg('user', 3 * HOUR), msg('agent', 3 * HOUR)],
      lastMakerMessageAt: iso(3 * HOUR),
    })
    await drain(await POST(makeRequest({ session_id: 'sess-1' })))

    expect(capturedStreamArgs?.system).toEqual([
      { type: 'text', text: 'You are a helpful assistant', cache_control: { type: 'ephemeral' } },
      { type: 'text', text: '## Returning after a break\n\nrecap' },
    ])
  })

  it('declines when a builder opens the session (#110 — kickoff is maker re-engagement)', async () => {
    mockGetProjectRole.mockResolvedValue('builder')
    setup({
      messages: [msg('user', 3 * HOUR), msg('agent', 3 * HOUR)],
      lastMakerMessageAt: iso(3 * HOUR),
    })
    const res = await POST(makeRequest({ session_id: 'sess-1' }))
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.kicked_off).toBe(false)
    expect(data.reason).toBe('builder_side_opener')
    // No greeting written, no last_kickoff_at consumed.
    expect(addCalls.filter((c) => c.collection === 'messages')).toHaveLength(0)
    expect(updateCalls.some((u) => typeof u.last_kickoff_at === 'string')).toBe(false)
  })

  it('declines when an owner opens the session (system admins resolve to owner)', async () => {
    mockGetProjectRole.mockResolvedValue('owner')
    setup({
      messages: [msg('user', 3 * HOUR), msg('agent', 3 * HOUR)],
      lastMakerMessageAt: iso(3 * HOUR),
    })
    const res = await POST(makeRequest({ session_id: 'sess-1' }))
    const data = await res.json()
    expect(data.kicked_off).toBe(false)
    expect(data.reason).toBe('builder_side_opener')
  })

  it('still fires for an apprentice opener', async () => {
    mockGetProjectRole.mockResolvedValue('apprentice')
    setup({
      messages: [msg('user', 3 * HOUR), msg('agent', 3 * HOUR)],
      lastMakerMessageAt: iso(3 * HOUR),
    })
    const res = await POST(makeRequest({ session_id: 'sess-1' }))
    expect(res.headers.get('Content-Type')).toBe('text/event-stream')
    await drain(res)
    expect(addCalls.filter((c) => c.collection === 'messages')).toHaveLength(1)
  })

  it('stamps last_kickoff_at before streaming', async () => {
    setup({
      messages: [msg('user', 3 * HOUR), msg('agent', 3 * HOUR)],
      lastMakerMessageAt: iso(3 * HOUR),
    })
    await drain(await POST(makeRequest({ session_id: 'sess-1' })))
    expect(updateCalls.some((u) => typeof u.last_kickoff_at === 'string')).toBe(true)
  })

  it('ends the Claude conversation with a synthetic user turn', async () => {
    setup({
      messages: [msg('user', 3 * HOUR), msg('agent', 3 * HOUR)],
      lastMakerMessageAt: iso(3 * HOUR),
    })
    await drain(await POST(makeRequest({ session_id: 'sess-1' })))
    const sent = capturedStreamArgs?.messages || []
    const last = sent[sent.length - 1]
    expect(last.role).toBe('user')
    expect(String(last.content)).toContain('just opened the session')
  })

  it('names the opener in the synthetic turn for a multi-human brief', async () => {
    setup({
      messages: [
        msg('user', 3 * HOUR, { sender_email: 'mara@x.com', sender_display_name: 'Mara O' }),
        msg('user', 2 * HOUR, { sender_email: 'tomas@x.com', sender_display_name: 'Tomas' }),
        msg('agent', 2 * HOUR),
      ],
      lastMakerMessageAt: iso(2 * HOUR),
    })
    await drain(await POST(makeRequest({ session_id: 'sess-1' })))
    const sent = capturedStreamArgs?.messages || []
    const last = sent[sent.length - 1]
    expect(String(last.content)).toContain('Tomas') // the opener, via getUserDisplayName
    expect(String(last.content)).toContain('just opened')
  })

  it('declines (no-op, no stream) when the maker is mid-turn', async () => {
    setup({
      messages: [msg('agent', 3 * HOUR), msg('user', 1000)],
      lastMakerMessageAt: iso(1000),
    })
    const res = await POST(makeRequest({ session_id: 'sess-1' }))
    expect(res.headers.get('Content-Type')).toBe('application/json')
    const body = await res.json()
    expect(body.kicked_off).toBe(false)
    expect(addCalls.filter((c) => c.collection === 'messages')).toHaveLength(0)
  })

  it('declines when we already kicked off this return (reload/multi-tab guard)', async () => {
    setup({
      messages: [msg('user', 3 * HOUR), msg('agent', 60 * 1000)],
      lastMakerMessageAt: iso(3 * HOUR),
      lastKickoffAt: iso(60 * 1000), // newer than the last maker message
    })
    const res = await POST(makeRequest({ session_id: 'sess-1' }))
    const body = await res.json()
    expect(body.kicked_off).toBe(false)
    expect(body.reason).toBe('already_kicked_off')
    expect(addCalls.filter((c) => c.collection === 'messages')).toHaveLength(0)
  })

  it('declines a fresh session with no maker history anywhere (true first-ever)', async () => {
    setup({ messages: [msg('agent', 2 * HOUR)] }) // no lastMakerMessageAt
    const res = await POST(makeRequest({ session_id: 'sess-1' }))
    const body = await res.json()
    expect(body.kicked_off).toBe(false)
    expect(body.reason).toBe('no_maker_history')
  })

  // #70: a return session now starts empty (no canned welcome). The agent should
  // still greet when the project has prior maker history.
  it('fires on an empty return session when the project has prior maker history', async () => {
    setup({ messages: [], lastMakerMessageAt: iso(3 * HOUR) })
    const res = await POST(makeRequest({ session_id: 'sess-1' }))
    expect(res.headers.get('Content-Type')).toBe('text/event-stream')
    await drain(res)
    const stored = addCalls.filter((c) => c.collection === 'messages')
    expect(stored).toHaveLength(1)
    expect(stored[0].data.role).toBe('agent')
  })

  // A return session that opens with the builder's welcome, posted verbatim at
  // creation, already has its greeting — kicking off would greet twice.
  it('declines a return session whose welcome is already posted', async () => {
    setup({ messages: [msg('agent', 2 * HOUR)], lastMakerMessageAt: iso(3 * HOUR) })
    const res = await POST(makeRequest({ session_id: 'sess-1' }))
    const body = await res.json()
    expect(body.kicked_off).toBe(false)
    expect(body.reason).toBe('opener_already_posted')
    expect(addCalls.filter((c) => c.collection === 'messages')).toHaveLength(0)
  })

  it('declines an empty session with no project history', async () => {
    setup({ messages: [], lastMakerMessageAt: null })
    const res = await POST(makeRequest({ session_id: 'sess-1' }))
    const body = await res.json()
    expect(body.kicked_off).toBe(false)
    expect(body.reason).toBe('no_maker_history')
  })

  describe('nothing queued (#214)', () => {
    const unqueued = (extra: Record<string, unknown> = {}) => ({
      messages: [] as { id: string; data: () => Record<string, unknown> }[],
      lastMakerMessageAt: iso(2 * HOUR),
      project: { requester_first_name: 'Mara', payload_pasted_at: undefined },
      ...extra,
    })

    it('posts the canned greeting, tags it, skips the model, stamps maker_waiting_since, emails once', async () => {
      setup(unqueued())
      const res = await POST(makeRequest({ session_id: 'sess-1' }))
      expect(res.headers.get('Content-Type')).toBe('text/event-stream')
      const out = await drain(res)
      expect(out).toContain("hasn't queued our next conversation yet")
      expect(out).toContain('Nico')
      expect(out).toContain('data: [DONE]')
      expect(capturedStreamArgs).toBeNull()
      const stored = addCalls.find((c) => c.collection === 'messages')!
      expect(stored.data.kind).toBe('unqueued_greeting')
      expect(stored.data.role).toBe('agent')
      expect(updateCalls.some((u) => typeof u.maker_waiting_since === 'string')).toBe(true)
      expect(updateCalls.some((u) => 'last_maker_message_at' in u || 'notify_after' in u || 'notify_pending_since' in u)).toBe(false)
      expect(resendSend).toHaveBeenCalledTimes(1)
      expect((resendSend.mock.calls[0] as unknown[])[0]).toMatchObject({
        subject: 'Mara opened "Cafe app" — nothing queued',
      })
    })

    it('does not email again on a session already notified', async () => {
      setup(unqueued({ session: { unqueued_notified_at: iso(HOUR) } }))
      const out = await drain(await POST(makeRequest({ session_id: 'sess-1' })))
      expect(out).toContain("hasn't queued")
      expect(resendSend).not.toHaveBeenCalled()
    })

    it('keeps the earlier maker_waiting_since', async () => {
      const earlier = iso(HOUR)
      setup(unqueued({ project: { requester_first_name: 'Mara', payload_pasted_at: undefined, maker_waiting_since: earlier } }))
      await drain(await POST(makeRequest({ session_id: 'sess-1' })))
      expect(updateCalls.find((u) => 'maker_waiting_since' in u)!.maker_waiting_since).toBe(earlier)
    })

    it('suppressed under FEEDBACK_NOTIFY_SUPPRESS=on', async () => {
      vi.stubEnv('FEEDBACK_NOTIFY_SUPPRESS', 'on')
      setup(unqueued())
      const out = await drain(await POST(makeRequest({ session_id: 'sess-1' })))
      expect(out).toContain("hasn't queued")
      expect(resendSend).not.toHaveBeenCalled()
    })

    it('still greets when the email send fails', async () => {
      resendSend.mockRejectedValueOnce(new Error('boom'))
      const err = vi.spyOn(console, 'error').mockImplementation(() => {})
      setup(unqueued())
      const out = await drain(await POST(makeRequest({ session_id: 'sess-1' })))
      expect(out).toContain("hasn't queued")
      err.mockRestore()
    })

    it('uses "your builder" when there is no owner first name', async () => {
      mockOwnerFirst = null
      setup(unqueued())
      const out = await drain(await POST(makeRequest({ session_id: 'sess-1' })))
      expect(out).toContain('your builder')
    })

    it('queued -> model path unchanged', async () => {
      setup({
        messages: [msg('user', 3 * HOUR), msg('agent', 3 * HOUR)],
        lastMakerMessageAt: iso(3 * HOUR),
        project: { payload_pasted_at: iso(HOUR) },
      })
      await drain(await POST(makeRequest({ session_id: 'sess-1' })))
      expect(capturedStreamArgs).not.toBeNull()
      expect(addCalls.find((c) => c.collection === 'messages')!.data.kind).toBeUndefined()
      expect(resendSend).not.toHaveBeenCalled()
    })

    it('a paste equal to the last maker message counts as not queued', async () => {
      const t = iso(2 * HOUR)
      setup(unqueued({ lastMakerMessageAt: t, project: { requester_first_name: 'Mara', payload_pasted_at: t } }))
      await drain(await POST(makeRequest({ session_id: 'sess-1' })))
      expect(capturedStreamArgs).toBeNull()
      expect(addCalls.find((c) => c.collection === 'messages')!.data.kind).toBe('unqueued_greeting')
    })

    it('still declines no_maker_history before the guard', async () => {
      setup({ messages: [], lastMakerMessageAt: null, project: { payload_pasted_at: undefined } })
      const res = await POST(makeRequest({ session_id: 'sess-1' }))
      expect((await res.json()).reason).toBe('no_maker_history')
      expect(addCalls).toHaveLength(0)
    })
  })
})
