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
}))

let capturedStreamArgs: { messages?: { role: string; content: unknown }[] } | null = null
const mockStreamEvents = [
  { type: 'content_block_delta', delta: { type: 'text_delta', text: 'Welcome back!' } },
]

vi.mock('@anthropic-ai/sdk', () => ({
  default: vi.fn(() => ({
    messages: {
      stream: vi.fn((args: { messages?: { role: string; content: unknown }[] }) => {
        capturedStreamArgs = args
        let index = 0
        return {
          [Symbol.asyncIterator]: () => ({
            next: async () => {
              if (index < mockStreamEvents.length) return { value: mockStreamEvents[index++], done: false }
              return { done: true, value: undefined }
            },
          }),
          finalMessage: vi.fn(async () => ({ usage: { input_tokens: 100, output_tokens: 50 } })),
        }
      }),
    },
  })),
}))

vi.mock('@/lib/agent/system-prompt', () => ({
  buildSystemPrompt: vi.fn(() => 'You are a helpful assistant'),
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
  if (!reader) return
  while (true) {
    const { done } = await reader.read()
    if (done) break
  }
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
}) {
  docData = {
    sessions: {
      exists: true,
      data: () => ({ project_id: 'proj-1', last_kickoff_at: opts.lastKickoffAt ?? null }),
    },
    projects: {
      exists: true,
      data: () => ({
        requester_first_name: 'Sam',
        last_maker_message_at: opts.lastMakerMessageAt ?? null,
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
    updateCalls.length = 0
    capturedStreamArgs = null
    mockGetProjectRole.mockResolvedValue('maker')
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

  it('declines a fresh session with only a welcome message', async () => {
    setup({ messages: [msg('agent', 2 * HOUR)] })
    const res = await POST(makeRequest({ session_id: 'sess-1' }))
    const body = await res.json()
    expect(body.kicked_off).toBe(false)
    expect(body.reason).toBe('no_maker_history')
  })
})
