import { describe, it, expect, vi, beforeEach } from 'vitest'
import { regenerateBriefForProject } from '../briefs'

// =============================================================================
// regenerateBriefForProject — extracted from /api/briefs/generate so the cron
// can call the same code path without going through HTTP. Loads sessions →
// messages, fetches the existing brief for context, calls Claude, parses +
// validates the JSON response, upserts the new brief.
//
// Tests mock Anthropic + Firestore. Exercising the real Claude call belongs
// in manual prod verification, not unit tests.
// =============================================================================

const mockMessagesCreate = vi.fn()
vi.mock('@anthropic-ai/sdk', () => ({
  default: class {
    messages = { create: mockMessagesCreate }
  },
}))

// In-memory Firestore mock keyed by collection. Each query path explicitly
// supports the chained where().orderBy().get() and where().orderBy().limit().get()
// shapes that the implementation uses.
type DocLike = { id: string; data: () => Record<string, unknown>; ref?: { update: typeof mockBriefUpdate } }

const sessionsByProject: Record<string, DocLike[]> = {}
const messagesBySession: Record<string, DocLike[]> = {}
const briefsByProject: Record<string, DocLike[]> = {}
const projectDocs: Record<string, { exists: boolean; data: () => Record<string, unknown> }> = {}
const briefAddCalls: Record<string, unknown>[] = []
const mockBriefUpdate = vi.fn(async () => {})

function makeDb() {
  return {
    collection: vi.fn((name: string) => ({
      add: vi.fn(async (data: Record<string, unknown>) => {
        if (name === 'briefs') briefAddCalls.push(data)
        return { id: `new-${name}-id` }
      }),
      doc: vi.fn((id: string) => ({
        get: async () =>
          projectDocs[id] || { exists: false, data: () => ({}) },
      })),
      where: vi.fn((field: string, _op: string, value: unknown) => {
        if (name === 'sessions' && field === 'project_id') {
          const docs = sessionsByProject[String(value)] || []
          return {
            orderBy: () => ({
              get: async () => ({ docs, empty: docs.length === 0, size: docs.length }),
            }),
          }
        }
        if (name === 'messages' && field === 'session_id') {
          const docs = messagesBySession[String(value)] || []
          return {
            orderBy: () => ({
              get: async () => ({ docs, empty: docs.length === 0, size: docs.length }),
            }),
          }
        }
        if (name === 'briefs' && field === 'project_id') {
          const docs = briefsByProject[String(value)] || []
          return {
            orderBy: () => ({
              limit: () => ({
                get: async () => ({ docs, empty: docs.length === 0, size: docs.length }),
              }),
              get: async () => ({ docs, empty: docs.length === 0, size: docs.length }),
            }),
          }
        }
        return { orderBy: () => ({ get: async () => ({ docs: [], empty: true, size: 0 }) }) }
      }),
    })),
  } as unknown as FirebaseFirestore.Firestore
}

function jsonResponse(json: unknown) {
  return { content: [{ type: 'text', text: JSON.stringify(json) }] }
}

beforeEach(() => {
  mockMessagesCreate.mockReset()
  mockBriefUpdate.mockReset()
  briefAddCalls.length = 0
  for (const k of Object.keys(sessionsByProject)) delete sessionsByProject[k]
  for (const k of Object.keys(messagesBySession)) delete messagesBySession[k]
  for (const k of Object.keys(briefsByProject)) delete briefsByProject[k]
  for (const k of Object.keys(projectDocs)) delete projectDocs[k]
  process.env.ANTHROPIC_API_KEY = 'test-key'
})

const validBrief = {
  problem: 'Customers cannot order online',
  target_users: 'Bakery customers',
  features: ['Online ordering', 'Pickup scheduling'],
  constraints: 'Must work on mobile',
  additional_context: '',
  decisions: [{ topic: 'Payment', decision: 'Stripe' }],
  open_risks: ['Pricing model undecided'],
}

describe('regenerateBriefForProject', () => {
  it('throws regenerate_brief_no_messages when the project has no messages', async () => {
    sessionsByProject.p1 = [
      { id: 's1', data: () => ({ project_id: 'p1', created_at: '2026-01-01T00:00:00Z' }) },
    ]
    // messagesBySession.s1 unset → no messages

    await expect(regenerateBriefForProject(makeDb(), 'p1')).rejects.toThrow(
      'regenerate_brief_no_messages',
    )
    expect(mockMessagesCreate).not.toHaveBeenCalled()
  })

  it('calls Claude with the conversation history and upserts the brief', async () => {
    sessionsByProject.p1 = [
      { id: 's1', data: () => ({ created_at: '2026-01-01T00:00:00Z' }) },
    ]
    messagesBySession.s1 = [
      { id: 'm1', data: () => ({ role: 'user', content: 'I want a bakery app' }) },
      { id: 'm2', data: () => ({ role: 'agent', content: 'Tell me more' }) },
    ]
    projectDocs.p1 = { exists: true, data: () => ({ title: 'Bakery App' }) }
    mockMessagesCreate.mockResolvedValue(jsonResponse({ brief: validBrief }))

    const result = await regenerateBriefForProject(makeDb(), 'p1')

    expect(mockMessagesCreate).toHaveBeenCalledOnce()
    const args = mockMessagesCreate.mock.calls[0][0] as { messages: Array<{ content: string }> }
    expect(args.messages[0].content).toContain('Bakery App')
    expect(args.messages[0].content).toContain('I want a bakery app')
    expect(briefAddCalls).toHaveLength(1)
    expect(briefAddCalls[0].content).toMatchObject({
      problem: validBrief.problem,
      features: validBrief.features,
    })
    expect(result).toMatchObject({ project_id: 'p1', version: 1 })
  })

  it('unwraps a brief-only payload (no top-level "brief" key)', async () => {
    sessionsByProject.p1 = [{ id: 's1', data: () => ({}) }]
    messagesBySession.s1 = [{ id: 'm1', data: () => ({ role: 'user', content: 'hi' }) }]
    projectDocs.p1 = { exists: true, data: () => ({ title: 'X' }) }
    mockMessagesCreate.mockResolvedValue(jsonResponse(validBrief))

    await regenerateBriefForProject(makeDb(), 'p1')

    expect(briefAddCalls[0].content).toMatchObject({ problem: validBrief.problem })
  })

  it('coerces malformed Claude JSON to a safe default shape', async () => {
    sessionsByProject.p1 = [{ id: 's1', data: () => ({}) }]
    messagesBySession.s1 = [{ id: 'm1', data: () => ({ role: 'user', content: 'hi' }) }]
    projectDocs.p1 = { exists: true, data: () => ({ title: 'X' }) }
    mockMessagesCreate.mockResolvedValue(
      jsonResponse({
        brief: {
          problem: 42, // wrong type
          features: 'not-an-array', // wrong type
          decisions: [
            { topic: 'OK', decision: 'fine' },
            { topic: 123, decision: 'bad' }, // gets filtered
            null, // gets filtered
          ],
          open_risks: ['risk one', '', 99], // empty + non-string filtered
        },
      }),
    )

    await regenerateBriefForProject(makeDb(), 'p1')

    const stored = briefAddCalls[0].content as Record<string, unknown>
    expect(stored.problem).toBe('')
    expect(stored.features).toEqual([])
    expect(stored.decisions).toEqual([{ topic: 'OK', decision: 'fine' }])
    expect(stored.open_risks).toEqual(['risk one'])
  })

  it('passes the existing brief into the prompt as context', async () => {
    sessionsByProject.p1 = [{ id: 's1', data: () => ({}) }]
    messagesBySession.s1 = [{ id: 'm1', data: () => ({ role: 'user', content: 'hi' }) }]
    projectDocs.p1 = { exists: true, data: () => ({ title: 'X' }) }
    briefsByProject.p1 = [
      {
        id: 'brief-1',
        data: () => ({
          version: 1,
          updated_at: '2026-04-01T00:00:00Z',
          content: { ...validBrief, problem: 'PRIOR_BRIEF_PROBLEM' },
        }),
        ref: { update: mockBriefUpdate },
      },
    ]
    mockMessagesCreate.mockResolvedValue(jsonResponse({ brief: validBrief }))

    await regenerateBriefForProject(makeDb(), 'p1')

    const args = mockMessagesCreate.mock.calls[0][0] as { messages: Array<{ content: string }> }
    expect(args.messages[0].content).toContain('PRIOR_BRIEF_PROBLEM')
  })

  it('falls back to "Untitled" when the project doc is missing', async () => {
    sessionsByProject.p1 = [{ id: 's1', data: () => ({}) }]
    messagesBySession.s1 = [{ id: 'm1', data: () => ({ role: 'user', content: 'hi' }) }]
    // projectDocs.p1 unset
    mockMessagesCreate.mockResolvedValue(jsonResponse(validBrief))

    await regenerateBriefForProject(makeDb(), 'p1')

    const args = mockMessagesCreate.mock.calls[0][0] as { messages: Array<{ content: string }> }
    expect(args.messages[0].content).toContain('Untitled')
  })

  it('throws when Claude returns non-JSON', async () => {
    sessionsByProject.p1 = [{ id: 's1', data: () => ({}) }]
    messagesBySession.s1 = [{ id: 'm1', data: () => ({ role: 'user', content: 'hi' }) }]
    projectDocs.p1 = { exists: true, data: () => ({ title: 'X' }) }
    mockMessagesCreate.mockResolvedValue({
      content: [{ type: 'text', text: 'not json at all' }],
    })

    await expect(regenerateBriefForProject(makeDb(), 'p1')).rejects.toThrow(/JSON/)
    expect(briefAddCalls).toHaveLength(0)
  })

  it('walks multiple sessions and concatenates messages in order', async () => {
    sessionsByProject.p1 = [
      { id: 's1', data: () => ({ created_at: '2026-01-01T00:00:00Z' }) },
      { id: 's2', data: () => ({ created_at: '2026-01-02T00:00:00Z' }) },
    ]
    messagesBySession.s1 = [
      { id: 'm1', data: () => ({ role: 'user', content: 'SESSION_ONE_FIRST' }) },
    ]
    messagesBySession.s2 = [
      { id: 'm2', data: () => ({ role: 'user', content: 'SESSION_TWO_SECOND' }) },
    ]
    projectDocs.p1 = { exists: true, data: () => ({ title: 'X' }) }
    mockMessagesCreate.mockResolvedValue(jsonResponse(validBrief))

    await regenerateBriefForProject(makeDb(), 'p1')

    const args = mockMessagesCreate.mock.calls[0][0] as { messages: Array<{ content: string }> }
    const idx1 = args.messages[0].content.indexOf('SESSION_ONE_FIRST')
    const idx2 = args.messages[0].content.indexOf('SESSION_TWO_SECOND')
    expect(idx1).toBeGreaterThan(0)
    expect(idx2).toBeGreaterThan(idx1)
  })
})
