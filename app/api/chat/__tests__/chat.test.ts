import { describe, it, expect, vi, beforeEach } from 'vitest'
import { POST } from '../route'
import { buildSystemPrompt } from '@/lib/agent/system-prompt'

// =============================================================================
// CHAT ROUTE TESTS
//
// POST /api/chat — the most complex API route:
//   1. Validates input (session_id + content or file_ids)
//   2. Looks up session → project, verifies membership
//   3. Stores the user message in Firestore
//   4. Loads conversation history + brief + session count
//   5. Builds system prompt and streams Claude's response via SSE
//   6. Stores the agent response after streaming completes
//   7. Updates token usage on the session
//
// The streaming part (steps 5-7) happens inside a ReadableStream callback,
// which makes it async. Tests that verify streaming behavior need to consume
// the response body.
//
// Firestore mock: uses collection-name closures so each db.collection('x')
// call returns the right mock data regardless of call order.
// =============================================================================

const mockGetProjectRole = vi.fn()
const mockGetUserDisplayName = vi.fn()
const mockHasSystemRole = vi.fn()

// Track add() calls by collection for assertions
const addCalls: { collection: string; data: Record<string, unknown> }[] = []
const mockUpdate = vi.fn(async () => {})

// Configurable doc data keyed by collection name
let docData: Record<string, { exists: boolean; data: () => Record<string, unknown> }>

// Configurable query results keyed by collection name
let queryResults: Record<string, { id: string; data: () => Record<string, unknown> }[]>

const mockCollection = vi.fn((name: string) => ({
  add: vi.fn(async (data: Record<string, unknown>) => {
    addCalls.push({ collection: name, data })
    return { id: `new-${name}-id` }
  }),
  doc: vi.fn(() => ({
    get: vi.fn(async () => docData[name] || { exists: false, data: () => ({}) }),
    update: mockUpdate,
  })),
  where: vi.fn(() => ({
    // Direct .where(...).get() (no orderBy/limit) — e.g. the project_members roster.
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
  getUserDisplayName: (...args: unknown[]) => mockGetUserDisplayName(...args),
  hasSystemRole: (...args: unknown[]) => mockHasSystemRole(...args),
  ADMIN_EMAILS: ['admin@ibuild4you.com'],
}))

// Mock Anthropic SDK — configurable stream events
let mockStreamEvents: { type: string; delta: { type: string; text: string } }[] = []
// Capture the args passed to messages.stream so tests can assert on the
// conversation history actually sent to Claude (e.g. name-prefixed turns).
let capturedStreamArgs: { messages?: { role: string; content: unknown }[] } | null = null

vi.mock('@anthropic-ai/sdk', () => ({
  default: vi.fn(() => ({
    messages: {
      stream: vi.fn((args: { messages?: { role: string; content: unknown }[] }) => {
        capturedStreamArgs = args
        let index = 0
        return {
          [Symbol.asyncIterator]: () => ({
            next: async () => {
              if (index < mockStreamEvents.length) {
                return { value: mockStreamEvents[index++], done: false }
              }
              return { done: true, value: undefined }
            },
          }),
          finalMessage: vi.fn(async () => ({
            usage: { input_tokens: 100, output_tokens: 50 },
          })),
        }
      }),
    },
  })),
}))

vi.mock('resend', () => ({
  Resend: vi.fn(() => ({
    emails: { send: vi.fn(async () => ({ id: 'email-id' })) },
  })),
}))

vi.mock('@/lib/agent/system-prompt', () => ({
  buildSystemPrompt: vi.fn(() => 'You are a helpful assistant'),
}))

function makeRequest(body: Record<string, unknown>) {
  return new Request('http://localhost/api/chat', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  })
}

// Helper: read an SSE response body into an array of parsed data chunks
async function readSSE(response: Response): Promise<string[]> {
  const reader = response.body?.getReader()
  if (!reader) return []

  const decoder = new TextDecoder()
  const chunks: string[] = []
  let buffer = ''

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() || ''
    for (const line of lines) {
      if (line.startsWith('data: ')) {
        chunks.push(line.slice(6))
      }
    }
  }
  return chunks
}

describe('POST /api/chat', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    addCalls.length = 0
    capturedStreamArgs = null
    mockGetProjectRole.mockResolvedValue('maker')
    mockGetUserDisplayName.mockResolvedValue('Test User')
    mockHasSystemRole.mockReturnValue(false)
    mockStreamEvents = [
      { type: 'content_block_delta', delta: { type: 'text_delta', text: 'Hello' } },
      { type: 'content_block_delta', delta: { type: 'text_delta', text: ' world' } },
    ]

    docData = {
      sessions: {
        exists: true,
        data: () => ({ project_id: 'proj-1', session_mode: 'discover' }),
      },
      projects: {
        exists: true,
        data: () => ({ title: 'Test Project', slug: 'test-project', context: null }),
      },
    }

    queryResults = {
      messages: [
        { id: 'm1', data: () => ({ role: 'agent', content: 'Welcome!', created_at: '2026-01-01T00:00:00Z' }) },
      ],
      sessions: [
        { id: 'session-1', data: () => ({ project_id: 'proj-1', created_at: '2026-01-01T00:00:00Z' }) },
      ],
      briefs: [],
    }
  })

  // --- Validation ---

  it('returns 400 when session_id is missing', async () => {
    const res = await POST(makeRequest({ content: 'Hello' }))
    expect(res.status).toBe(400)
    const data = await res.json()
    expect(data.error).toContain('session_id')
  })

  it('returns 400 when both content and file_ids are missing', async () => {
    const res = await POST(makeRequest({ session_id: 's1' }))
    expect(res.status).toBe(400)
  })

  it('returns 400 when content is empty whitespace and no file_ids', async () => {
    const res = await POST(makeRequest({ session_id: 's1', content: '   ' }))
    expect(res.status).toBe(400)
  })

  it('returns a JSON 400 (not a raw 500) on a malformed JSON body', async () => {
    const req = new Request('http://localhost/api/chat', {
      method: 'POST',
      body: '{not valid json',
      headers: { 'Content-Type': 'application/json' },
    })
    const res = await POST(req)
    expect(res.status).toBe(400)
    expect(res.headers.get('Content-Type')).toContain('application/json')
    const data = await res.json()
    expect(data.error).toBeTruthy()
  })

  // --- Defensive: unexpected failures return a parseable JSON 500 ---

  it('returns a JSON 500 envelope (not a framework HTML 500) when a read throws', async () => {
    mockGetProjectRole.mockRejectedValue(new Error('firestore unavailable'))
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    const res = await POST(makeRequest({ session_id: 's1', content: 'Hello' }))

    expect(res.status).toBe(500)
    expect(res.headers.get('Content-Type')).toContain('application/json')
    // Body must be valid JSON the client can parse off res.json().
    const data = await res.json()
    expect(data.error).toBeTruthy()
    // And the failure is logged with a diagnosable tag.
    expect(errSpy).toHaveBeenCalledWith('chat_request_error', expect.objectContaining({
      message: 'firestore unavailable',
    }))
    errSpy.mockRestore()
  })

  // --- Auth / not found ---

  it('returns 404 when session does not exist', async () => {
    docData.sessions = { exists: false, data: () => ({}) }
    const res = await POST(makeRequest({ session_id: 's1', content: 'Hello' }))
    expect(res.status).toBe(404)
  })

  it('returns 404 when user has no role on the project', async () => {
    mockGetProjectRole.mockResolvedValue(null)
    const res = await POST(makeRequest({ session_id: 's1', content: 'Hello' }))
    expect(res.status).toBe(404)
  })

  // --- User message storage ---

  it('stores the user message in Firestore', async () => {
    const res = await POST(makeRequest({ session_id: 's1', content: 'Hello there' }))
    // Consume the stream so the handler completes
    await readSSE(res)

    const userMsgAdd = addCalls.find(
      (c) => c.collection === 'messages' && c.data.role === 'user'
    )
    expect(userMsgAdd).toBeDefined()
    expect(userMsgAdd!.data.content).toBe('Hello there')
    expect(userMsgAdd!.data.session_id).toBe('s1')
    expect(userMsgAdd!.data.sender_email).toBe('user@ibuild4you.com')
    expect(userMsgAdd!.data.sender_display_name).toBe('Test User')
  })

  it('includes file_ids on the user message when provided', async () => {
    const res = await POST(makeRequest({
      session_id: 's1',
      content: 'See attached',
      file_ids: ['file-1', 'file-2'],
    }))
    await readSSE(res)

    const userMsgAdd = addCalls.find(
      (c) => c.collection === 'messages' && c.data.role === 'user'
    )
    expect(userMsgAdd!.data.file_ids).toEqual(['file-1', 'file-2'])
  })

  // --- SSE streaming ---

  it('returns an SSE stream with correct headers', async () => {
    const res = await POST(makeRequest({ session_id: 's1', content: 'Hello' }))
    expect(res.headers.get('Content-Type')).toBe('text/event-stream')
    expect(res.headers.get('Cache-Control')).toBe('no-cache')
    await readSSE(res)
  })

  it('streams text chunks from Claude and ends with [DONE]', async () => {
    const res = await POST(makeRequest({ session_id: 's1', content: 'Hello' }))
    const chunks = await readSSE(res)

    expect(chunks.length).toBeGreaterThanOrEqual(3) // 2 text chunks + [DONE]
    expect(JSON.parse(chunks[0])).toEqual({ text: 'Hello' })
    expect(JSON.parse(chunks[1])).toEqual({ text: ' world' })
    expect(chunks[chunks.length - 1]).toBe('[DONE]')
  })

  it('stores the complete agent response after streaming', async () => {
    const res = await POST(makeRequest({ session_id: 's1', content: 'Hello' }))
    await readSSE(res)

    const agentMsgAdd = addCalls.find(
      (c) => c.collection === 'messages' && c.data.role === 'agent'
    )
    expect(agentMsgAdd).toBeDefined()
    expect(agentMsgAdd!.data.content).toBe('Hello world')
    expect(agentMsgAdd!.data.session_id).toBe('s1')
  })

  it('updates token usage on the session after streaming', async () => {
    const res = await POST(makeRequest({ session_id: 's1', content: 'Hello' }))
    await readSSE(res)

    expect(mockUpdate).toHaveBeenCalled()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const calls = mockUpdate.mock.calls as any[][]
    const tokenCall = calls.find(
      (c) => c[0] && typeof c[0] === 'object' && 'token_usage_input' in c[0]
    )
    expect(tokenCall).toBeDefined()
    const updateArgs = tokenCall![0] as Record<string, unknown>
    expect(updateArgs.token_usage_input).toBeDefined()
    expect(updateArgs.token_usage_output).toBeDefined()
  })

  it('queues a debounced notification on the project after maker message', async () => {
    await POST(makeRequest({ session_id: 's1', content: 'Hello' }))

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const calls = mockUpdate.mock.calls as any[][]
    const notifyCall = calls.find(
      (c) => c[0] && typeof c[0] === 'object' && 'notify_after' in c[0]
    )
    expect(notifyCall).toBeDefined()
    const args = notifyCall![0] as Record<string, unknown>
    expect(typeof args.notify_after).toBe('string')
    expect(args.notify_pending_since).toBeDefined()
  })

  it('records last_maker_message_at on the project for idle-brief-regen', async () => {
    await POST(makeRequest({ session_id: 's1', content: 'Hello' }))

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const calls = mockUpdate.mock.calls as any[][]
    const projectUpdate = calls.find(
      (c) => c[0] && typeof c[0] === 'object' && 'last_maker_message_at' in c[0]
    )
    expect(projectUpdate).toBeDefined()
    const args = projectUpdate![0] as Record<string, unknown>
    expect(typeof args.last_maker_message_at).toBe('string')
  })

  // --- Multi-human brief (5b) ---

  it('does NOT name-prefix turns when only one human has posted', async () => {
    queryResults.messages = [
      { id: 'm1', data: () => ({ role: 'agent', content: 'Welcome!', created_at: '2026-01-01T00:00:00Z' }) },
      {
        id: 'm2',
        data: () => ({
          role: 'user',
          content: 'My idea is a cafe app',
          sender_email: 'maria@example.com',
          sender_display_name: 'Maria',
          created_at: '2026-01-01T00:01:00Z',
        }),
      },
    ]

    const res = await POST(makeRequest({ session_id: 's1', content: 'more' }))
    await readSSE(res)

    const userTurn = capturedStreamArgs!.messages!.find((m) => m.content === 'My idea is a cafe app')
    expect(userTurn).toBeDefined() // unprefixed, byte-identical to single-maker behavior
    expect(buildSystemPrompt).toHaveBeenCalledWith(
      expect.objectContaining({ participants: undefined })
    )
  })

  it('name-prefixes each user turn when 2+ humans have posted', async () => {
    queryResults.messages = [
      { id: 'm1', data: () => ({ role: 'agent', content: 'Welcome!', created_at: '2026-01-01T00:00:00Z' }) },
      {
        id: 'm2',
        data: () => ({
          role: 'user',
          content: 'I want a cafe app',
          sender_email: 'maria@example.com',
          sender_display_name: 'Maria',
          created_at: '2026-01-01T00:01:00Z',
        }),
      },
      {
        id: 'm3',
        data: () => ({
          role: 'user',
          content: 'and online ordering',
          sender_email: 'tom@example.com',
          sender_display_name: 'Tom',
          created_at: '2026-01-01T00:02:00Z',
        }),
      },
    ]
    queryResults.project_members = [
      { id: 'pm1', data: () => ({ email: 'maria@example.com', brief_role: 'originator' }) },
      { id: 'pm2', data: () => ({ email: 'tom@example.com', brief_role: 'contributor' }) },
    ]

    const res = await POST(makeRequest({ session_id: 's1', content: 'more' }))
    await readSSE(res)

    const contents = capturedStreamArgs!.messages!.map((m) => m.content)
    expect(contents).toContain('Maria: I want a cafe app')
    expect(contents).toContain('Tom: and online ordering')
  })

  it('passes a participant roster (name + brief_role) to the system prompt when multi-human', async () => {
    queryResults.messages = [
      {
        id: 'm1',
        data: () => ({
          role: 'user',
          content: 'a',
          sender_email: 'maria@example.com',
          sender_display_name: 'Maria',
          created_at: '2026-01-01T00:01:00Z',
        }),
      },
      {
        id: 'm2',
        data: () => ({
          role: 'user',
          content: 'b',
          sender_email: 'tom@example.com',
          sender_display_name: 'Tom',
          created_at: '2026-01-01T00:02:00Z',
        }),
      },
    ]
    queryResults.project_members = [
      { id: 'pm1', data: () => ({ email: 'maria@example.com', brief_role: 'originator' }) },
      { id: 'pm2', data: () => ({ email: 'tom@example.com', brief_role: 'contributor' }) },
    ]

    await POST(makeRequest({ session_id: 's1', content: 'more' }))

    expect(buildSystemPrompt).toHaveBeenCalledWith(
      expect.objectContaining({
        participants: [
          { name: 'Maria', brief_role: 'originator' },
          { name: 'Tom', brief_role: 'contributor' },
        ],
      })
    )
  })
})
