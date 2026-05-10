import { describe, it, expect, vi, beforeEach } from 'vitest'
import { POST } from '../route'

// =============================================================================
// CHAT ROUTE — ATTACHMENT INTEGRATION
//
// Phase 3: when a user message in the history has file_ids, the chat route
// fetches each referenced file from S3 and inlines it into the Claude
// messages array as a document/image content block.
//
// Captures the messages payload sent to Anthropic via streamCalls.
// =============================================================================

const mockGetProjectRole = vi.fn()
const mockGetUserDisplayName = vi.fn()
const mockHasSystemRole = vi.fn()
const mockS3Send = vi.fn()

const streamCalls: Array<{ messages: unknown[] }> = []

let docData: Record<string, { exists: boolean; data: () => Record<string, unknown> }>
let queryResults: Record<string, { id: string; data: () => Record<string, unknown> }[]>

const mockCollection = vi.fn((name: string) => ({
  add: vi.fn(async () => ({ id: `new-${name}-id` })),
  doc: vi.fn(() => ({
    get: vi.fn(async () => docData[name] || { exists: false, data: () => ({}) }),
    update: vi.fn(async () => {}),
  })),
  where: vi.fn(() => ({
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
    uid: 'user-123', email: 'user@ibuild4you.com', error: null, systemRoles: [],
  })),
  getAdminDb: vi.fn(() => ({ collection: mockCollection })),
  getProjectRole: (...args: unknown[]) => mockGetProjectRole(...args),
  getUserDisplayName: (...args: unknown[]) => mockGetUserDisplayName(...args),
  hasSystemRole: (...args: unknown[]) => mockHasSystemRole(...args),
  ADMIN_EMAILS: ['admin@ibuild4you.com'],
}))

vi.mock('@/lib/s3/client', () => ({
  s3: { send: (...args: unknown[]) => mockS3Send(...args) },
  S3_BUCKET: 'test-bucket',
}))

vi.mock('@aws-sdk/client-s3', () => ({
  GetObjectCommand: vi.fn((input) => ({ input })),
}))

vi.mock('@anthropic-ai/sdk', () => ({
  default: vi.fn(() => ({
    messages: {
      stream: vi.fn((args: { messages: unknown[] }) => {
        streamCalls.push({ messages: args.messages })
        return {
          [Symbol.asyncIterator]: () => ({
            next: async () => ({ done: true, value: undefined }),
          }),
          finalMessage: vi.fn(async () => ({
            usage: { input_tokens: 1, output_tokens: 1 },
          })),
        }
      }),
    },
  })),
}))

vi.mock('@/lib/agent/system-prompt', () => ({
  buildSystemPrompt: vi.fn(() => 'system'),
}))

function makeRequest(body: Record<string, unknown>) {
  return new Request('http://localhost/api/chat', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  })
}

async function drain(res: Response) {
  const reader = res.body?.getReader()
  if (!reader) return
  while (true) {
    const { done } = await reader.read()
    if (done) break
  }
}

beforeEach(() => {
  streamCalls.length = 0
  mockGetProjectRole.mockReset().mockResolvedValue('maker')
  mockGetUserDisplayName.mockReset().mockResolvedValue('Test User')
  mockHasSystemRole.mockReset().mockReturnValue(false)
  mockS3Send.mockReset().mockResolvedValue({
    Body: { transformToByteArray: async () => new Uint8Array([7, 8, 9]) },
  })

  docData = {
    sessions: { exists: true, data: () => ({ project_id: 'p1', session_mode: 'discover' }) },
    projects: { exists: true, data: () => ({ title: 'Test', slug: 'test' }) },
    files: {
      exists: true,
      data: () => ({
        project_id: 'p1',
        content_type: 'application/pdf',
        storage_path: 'projects/p1/file-1/a.pdf',
        size_bytes: 1024,
        status: 'ready',
      }),
    },
  }

  queryResults = {
    sessions: [{ id: 's1', data: () => ({ project_id: 'p1', created_at: '2026-01-01T00:00:00Z' }) }],
    briefs: [],
    messages: [],
  }
})

describe('POST /api/chat with attachments', () => {
  it('inlines a PDF document block into the historical user message', async () => {
    queryResults.messages = [
      {
        id: 'old-1',
        data: () => ({
          role: 'user',
          content: 'Look at this PDF',
          file_ids: ['file-1'],
          created_at: '2026-01-01T00:00:00Z',
        }),
      },
    ]
    const res = await POST(makeRequest({ session_id: 's1', content: 'and now what?' }))
    await drain(res)

    expect(streamCalls).toHaveLength(1)
    const userMsg = streamCalls[0].messages[0] as {
      role: string
      content: Array<{ type: string; source?: { media_type: string }; cache_control?: unknown }>
    }
    expect(userMsg.role).toBe('user')
    expect(Array.isArray(userMsg.content)).toBe(true)
    // Document block carries no cache_control marker — the chat route places
    // exactly one marker on the last block of the most recent attachment-
    // bearing message (Anthropic caps cache_control at 4 per request).
    expect(userMsg.content[0]).toMatchObject({
      type: 'document',
      source: { media_type: 'application/pdf' },
    })
    expect(userMsg.content[0]).not.toHaveProperty('cache_control')
    expect(userMsg.content[1]).toMatchObject({
      type: 'text',
      text: 'Look at this PDF',
      cache_control: { type: 'ephemeral' },
    })
  })

  it('places at most one cache_control marker even with many attachments', async () => {
    // Anthropic 400s with "A maximum of 4 blocks with cache_control may be
    // provided" when we tag every block. Repro: 5 PDFs in one user message.
    docData.files = {
      exists: true,
      data: () => ({
        project_id: 'p1',
        content_type: 'application/pdf',
        storage_path: 'projects/p1/file-x/a.pdf',
        size_bytes: 1024,
        status: 'ready',
      }),
    }
    queryResults.messages = [
      {
        id: 'old-1',
        data: () => ({
          role: 'user',
          content: 'all of these',
          file_ids: ['f1', 'f2', 'f3', 'f4', 'f5'],
          created_at: '2026-01-01T00:00:00Z',
        }),
      },
    ]
    const res = await POST(makeRequest({ session_id: 's1', content: 'go' }))
    await drain(res)

    const userMsg = streamCalls[0].messages[0] as {
      content: Array<{ type: string; cache_control?: unknown }>
    }
    const tagged = userMsg.content.filter((b) => b.cache_control !== undefined)
    expect(tagged).toHaveLength(1)
    // Marker lives on the last block (the text trailer).
    expect(userMsg.content[userMsg.content.length - 1].cache_control).toEqual({ type: 'ephemeral' })
  })

  it('puts the cache_control marker on the most recent attachment-bearing message', async () => {
    queryResults.messages = [
      {
        id: 'old-1',
        data: () => ({
          role: 'user',
          content: 'first batch',
          file_ids: ['file-1'],
          created_at: '2026-01-01T00:00:00Z',
        }),
      },
      {
        id: 'old-2',
        data: () => ({
          role: 'agent',
          content: 'got it',
          created_at: '2026-01-01T00:01:00Z',
        }),
      },
      {
        id: 'old-3',
        data: () => ({
          role: 'user',
          content: 'second batch',
          file_ids: ['file-1'],
          created_at: '2026-01-01T00:02:00Z',
        }),
      },
    ]
    const res = await POST(makeRequest({ session_id: 's1', content: 'now?' }))
    await drain(res)

    const msgs = streamCalls[0].messages as Array<{
      role: string
      content: string | Array<{ type: string; cache_control?: unknown }>
    }>
    // First user message: no cache_control anywhere
    const first = msgs[0].content as Array<{ cache_control?: unknown }>
    expect(first.every((b) => b.cache_control === undefined)).toBe(true)
    // Third user message (most recent w/ attachments): one marker on last block
    const third = msgs[2].content as Array<{ cache_control?: unknown }>
    expect(third[third.length - 1].cache_control).toEqual({ type: 'ephemeral' })
  })

  it('keeps text-only messages as plain string content', async () => {
    queryResults.messages = [
      {
        id: 'old-1',
        data: () => ({
          role: 'user',
          content: 'Plain text only',
          created_at: '2026-01-01T00:00:00Z',
        }),
      },
    ]
    const res = await POST(makeRequest({ session_id: 's1', content: 'follow up' }))
    await drain(res)

    expect(streamCalls[0].messages[0]).toMatchObject({
      role: 'user',
      content: 'Plain text only',
    })
  })

  it('falls back to plain text content when no eligible files resolve', async () => {
    docData.files = { exists: false, data: () => ({}) } // file doc missing
    queryResults.messages = [
      {
        id: 'old-1',
        data: () => ({
          role: 'user',
          content: 'See attached',
          file_ids: ['ghost'],
          created_at: '2026-01-01T00:00:00Z',
        }),
      },
    ]
    const res = await POST(makeRequest({ session_id: 's1', content: 'next' }))
    await drain(res)

    expect(streamCalls[0].messages[0]).toMatchObject({
      role: 'user',
      content: 'See attached',
    })
  })

  it('returns 413 when attachments exceed the per-message cap', async () => {
    docData.files = {
      exists: true,
      data: () => ({
        project_id: 'p1',
        content_type: 'application/pdf',
        storage_path: 'projects/p1/file-1/big.pdf',
        size_bytes: 30 * 1024 * 1024, // > 25MB cap
        status: 'ready',
      }),
    }
    queryResults.messages = [
      {
        id: 'old-1',
        data: () => ({
          role: 'user',
          content: 'huge',
          file_ids: ['file-1'],
          created_at: '2026-01-01T00:00:00Z',
        }),
      },
    ]
    const res = await POST(makeRequest({ session_id: 's1', content: 'next' }))
    expect(res.status).toBe(413)
    const data = await res.json()
    expect(data.error).toMatch(/25MB/i)
    expect(streamCalls).toHaveLength(0)
  })

  it('uses an empty-string-replacement when a message has only files (no text)', async () => {
    queryResults.messages = [
      {
        id: 'old-1',
        data: () => ({
          role: 'user',
          content: '',
          file_ids: ['file-1'],
          created_at: '2026-01-01T00:00:00Z',
        }),
      },
    ]
    const res = await POST(makeRequest({ session_id: 's1', content: 'what is in it?' }))
    await drain(res)

    const userMsg = streamCalls[0].messages[0] as {
      content: Array<{ type: string; text?: string }>
    }
    // Anthropic requires non-empty text in a text block; we substitute a marker
    const textBlock = userMsg.content.find((b) => b.type === 'text')
    expect(textBlock?.text).toBeTruthy()
  })
})
