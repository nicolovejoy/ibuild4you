import { describe, it, expect, vi, beforeEach } from 'vitest'
import { upsertBrief } from '../briefs'

// =============================================================================
// upsertBrief — version history. (The whole-brief regen that used to live here
// was replaced by the note writer, lib/api/note-writer.ts.)
// =============================================================================

// In-memory Firestore mock keyed by collection. Each query path explicitly
// supports the chained where().orderBy().get() and where().orderBy().limit().get()
// shapes that the implementation uses.
type DocLike = {
  id: string
  data: () => Record<string, unknown>
  ref?: { update: typeof mockBriefUpdate; collection?: (name: string) => unknown }
}

const sessionsByProject: Record<string, DocLike[]> = {}
const messagesBySession: Record<string, DocLike[]> = {}
const briefsByProject: Record<string, DocLike[]> = {}
const projectDocs: Record<string, { exists: boolean; data: () => Record<string, unknown> }> = {}
const briefAddCalls: Record<string, unknown>[] = []
const mockBriefUpdate = vi.fn(async () => {})
const mockVersionSet = vi.fn(async (..._args: unknown[]) => {})
// Brief doc ref used by the existing-brief tests: update + versions subcollection (#194)
const briefRef = {
  update: mockBriefUpdate,
  collection: () => ({ doc: (id: string) => ({ set: (d: unknown) => mockVersionSet(id, d) }) }),
}

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

beforeEach(() => {
  mockBriefUpdate.mockReset()
  mockVersionSet.mockReset()
  briefAddCalls.length = 0
  for (const k of Object.keys(sessionsByProject)) delete sessionsByProject[k]
  for (const k of Object.keys(messagesBySession)) delete messagesBySession[k]
  for (const k of Object.keys(briefsByProject)) delete briefsByProject[k]
  for (const k of Object.keys(projectDocs)) delete projectDocs[k]
})

describe('upsertBrief — version history (#194)', () => {
  const content = { problem: 'New', target_users: '', features: [], constraints: '', additional_context: '', decisions: [], open_risks: [] }

  it('archives the outgoing live brief to versions/{version} before overwriting, and stamps source', async () => {
    briefsByProject['p1'] = [{
      id: 'brief-1',
      data: () => ({ project_id: 'p1', version: 3, content: { problem: 'Old' }, updated_at: '2026-10-01T00:00:00.000Z', source: 'regen' }),
      ref: briefRef,
    }]
    const result = await upsertBrief(makeDb(), 'p1', content, 'paste')

    expect(mockVersionSet).toHaveBeenCalledTimes(1)
    const [docId, archived] = mockVersionSet.mock.calls[0] as [string, Record<string, unknown>]
    expect(docId).toBe('3')
    expect(archived.version).toBe(3)
    expect(archived.content).toEqual({ problem: 'Old' })
    expect(archived.updated_at).toBe('2026-10-01T00:00:00.000Z')
    expect(archived.source).toBe('regen')
    expect(typeof archived.archived_at).toBe('string')

    expect(mockBriefUpdate).toHaveBeenCalledWith(expect.objectContaining({ version: 4, source: 'paste', content }))
    expect(result.version).toBe(4)
    expect(result.source).toBe('paste')
  })

  it('archives a legacy doc (no source, no updated_at) with source null and created_at as updated_at', async () => {
    briefsByProject['p1'] = [{
      id: 'brief-1',
      data: () => ({ project_id: 'p1', version: 1, content: { problem: 'Old' }, created_at: '2026-09-01T00:00:00.000Z' }),
      ref: briefRef,
    }]
    await upsertBrief(makeDb(), 'p1', content, 'regen')
    const [, archived] = mockVersionSet.mock.calls[0] as [string, Record<string, unknown>]
    expect(archived.source).toBeNull()
    expect(archived.updated_at).toBe('2026-09-01T00:00:00.000Z')
  })

  it('archives nothing on the first-ever write and stamps source on the new doc', async () => {
    briefsByProject['p1'] = []
    const result = await upsertBrief(makeDb(), 'p1', content, 'paste')
    expect(mockVersionSet).not.toHaveBeenCalled()
    expect(briefAddCalls[0]).toEqual(expect.objectContaining({ version: 1, source: 'paste' }))
    expect(result.source).toBe('paste')
  })
})
