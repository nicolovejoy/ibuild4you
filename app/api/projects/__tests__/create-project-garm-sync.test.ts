import { describe, it, expect, vi, beforeEach } from 'vitest'
import { POST } from '../route'

// =============================================================================
// Garm dual-write wiring check (follow-up to PR #158).
//
// POST /api/projects calls scheduleGarmGrantSync for the creator and for each
// participant. Verified so far only by inspection — this pins the wiring so a
// dropped call site fails a test instead of silently drifting Garm stale.
// =============================================================================

const scheduleGarmGrantSyncMock = vi.fn()
vi.mock('@/lib/garm-grants', () => ({
  scheduleGarmGrantSync: (...args: unknown[]) => scheduleGarmGrantSyncMock(...args),
}))

const addedDocs: Record<string, Record<string, unknown>[]> = {}
const setDocs: Record<string, { docId: string; data: Record<string, unknown> }[]> = {}
let lastCollectionName = ''
let lastDocId = ''

const mockAdd = vi.fn(async (data: Record<string, unknown>) => {
  if (!addedDocs[lastCollectionName]) addedDocs[lastCollectionName] = []
  addedDocs[lastCollectionName].push(data)
  return { id: `mock-${lastCollectionName}-id`, update: vi.fn(async () => {}) }
})
const mockSet = vi.fn(async (data: Record<string, unknown>) => {
  if (!setDocs[lastCollectionName]) setDocs[lastCollectionName] = []
  setDocs[lastCollectionName].push({ docId: lastDocId, data })
})
const mockWhere = vi.fn(() => ({
  limit: vi.fn(() => ({ get: vi.fn(async () => ({ empty: true })) })),
}))
const mockCollection = vi.fn((name: string) => {
  lastCollectionName = name
  return {
    add: mockAdd,
    where: mockWhere,
    doc: vi.fn((id: string) => {
      lastDocId = id
      return { set: mockSet, update: vi.fn(async () => {}) }
    }),
  }
})

vi.mock('@/lib/api/firebase-server-helpers', () => ({
  getAuthenticatedUser: vi.fn(async () => ({
    uid: 'user-123',
    email: 'owner@ibuild4you.com',
    error: null,
  })),
  getAdminDb: vi.fn(() => ({ collection: mockCollection })),
}))

function makeRequest(body: Record<string, unknown>) {
  return new Request('http://localhost/api/projects', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

describe('POST /api/projects → scheduleGarmGrantSync', () => {
  beforeEach(() => {
    scheduleGarmGrantSyncMock.mockClear()
    for (const key of Object.keys(addedDocs)) delete addedDocs[key]
    for (const key of Object.keys(setDocs)) delete setDocs[key]
  })

  it('syncs the creator email on a bare project create', async () => {
    const res = await POST(makeRequest({ title: 'Test' }))
    expect(res.status).toBe(201)
    expect(scheduleGarmGrantSyncMock).toHaveBeenCalledWith('owner@ibuild4you.com')
    expect(scheduleGarmGrantSyncMock).toHaveBeenCalledTimes(1)
  })

  it('syncs the creator email and each participant email', async () => {
    const res = await POST(makeRequest({
      title: 'Team Brief',
      participants: [
        { email: 'a@example.com', role: 'maker' },
        { email: 'b@example.com', role: 'apprentice' },
      ],
    }))
    expect(res.status).toBe(201)
    const calledWith = scheduleGarmGrantSyncMock.mock.calls.map((c) => c[0])
    expect(calledWith).toEqual(
      expect.arrayContaining(['owner@ibuild4you.com', 'a@example.com', 'b@example.com'])
    )
    expect(scheduleGarmGrantSyncMock).toHaveBeenCalledTimes(3)
  })
})
