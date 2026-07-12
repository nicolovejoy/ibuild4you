import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextResponse } from 'next/server'
import { POST } from '../[id]/prep/generate/route'
import { prepConfigHash } from '@/lib/agent/prep-outbound'

// =============================================================================
// POST /api/projects/[id]/prep/generate — eager AI prep for the dispatch card.
// Covers: happy path (generate + store), cached path (fingerprint match → no LLM
// call), and silent fallback to the template on model error.
// =============================================================================

const projectUpdates: Record<string, unknown>[] = []
let projectDocData: Record<string, unknown> = {}
let briefEmpty = true
let sessionEmpty = true
let memberDocs: Array<{ data: () => Record<string, unknown> }> = []

const mockProjectDocUpdate = vi.fn(async (data: Record<string, unknown>) => {
  projectUpdates.push(data)
})

const mockCollection = vi.fn((name: string) => {
  if (name === 'projects') {
    return {
      doc: () => ({
        get: async () => ({ exists: true, data: () => projectDocData, ref: { update: mockProjectDocUpdate } }),
      }),
    }
  }
  if (name === 'briefs') {
    return {
      where: () => ({
        orderBy: () => ({ limit: () => ({ get: async () => ({ empty: briefEmpty, docs: [] }) }) }),
      }),
    }
  }
  if (name === 'sessions') {
    return {
      where: () => ({
        orderBy: () => ({
          limit: () => ({
            get: async () => ({
              empty: sessionEmpty,
              docs: sessionEmpty ? [] : [{ id: 'sess-1' }],
            }),
          }),
        }),
      }),
    }
  }
  if (name === 'messages') {
    return {
      where: () => ({ orderBy: () => ({ get: async () => ({ docs: [] }) }) }),
    }
  }
  if (name === 'project_members') {
    const chain = {
      where: () => chain,
      get: async () => ({ empty: memberDocs.length === 0, docs: memberDocs }),
    }
    return chain
  }
  return { where: () => ({}), doc: () => ({}) }
})

const mockGetProjectRole = vi.fn()
vi.mock('@/lib/api/firebase-server-helpers', () => ({
  getAuthenticatedUser: vi.fn(async () => ({
    uid: 'builder-uid',
    email: 'builder@example.com',
    error: null,
    systemRoles: [],
  })),
  getAdminDb: vi.fn(() => ({ collection: mockCollection })),
  getProjectRole: (...args: unknown[]) => mockGetProjectRole(...args),
  // Name resolution mirrors the real helper's fallback: email prefix.
  getUserDisplayName: vi.fn(async (_db: unknown, _uid: string, email: string) => email.split('@')[0]),
  requireRole: (role: string | null, minimum: string) => {
    const levels: Record<string, number> = { maker: 0, apprentice: 1, builder: 2, owner: 3 }
    if (!role || levels[role] < levels[minimum]) {
      return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
    }
    return null
  },
}))

const mockGenerate = vi.fn()
vi.mock('@/lib/agent/prep-outbound', async (importActual) => {
  const actual = await importActual<typeof import('@/lib/agent/prep-outbound')>()
  return { ...actual, generatePrepOutbound: (...args: unknown[]) => mockGenerate(...args) }
})

function makeReq(body: Record<string, unknown> = {}) {
  return new Request('http://localhost/api/projects/p1/prep/generate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}
const ctx = { params: Promise.resolve({ id: 'p1' }) }

describe('POST /api/projects/[id]/prep/generate', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    projectUpdates.length = 0
    projectDocData = { title: 'Cafe App', session_mode: 'discover', seed_questions: ['Q1'] }
    briefEmpty = true
    sessionEmpty = true
    memberDocs = []
    mockGetProjectRole.mockResolvedValue('builder')
  })

  it('rejects non-builders', async () => {
    mockGetProjectRole.mockResolvedValue('maker')
    const res = await POST(makeReq(), ctx)
    expect(res.status).toBe(403)
    expect(mockGenerate).not.toHaveBeenCalled()
  })

  it('generates and stores prep_nudge/prep_focus + a config hash', async () => {
    mockGenerate.mockResolvedValue({ focus: 'Discover the daily flow', nudge_message: 'Hi — round 2 time.' })
    const res = await POST(makeReq(), ctx)
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data).toMatchObject({ focus: 'Discover the daily flow', nudge_message: 'Hi — round 2 time.', cached: false })
    expect(projectUpdates).toHaveLength(1)
    expect(projectUpdates[0].prep_nudge).toBe('Hi — round 2 time.')
    expect(projectUpdates[0].prep_focus).toBe('Discover the daily flow')
    expect(projectUpdates[0].prep_config_hash).toBeTruthy()
  })

  it('passes every active maker first name to the generator, joined naturally', async () => {
    memberDocs = [
      { data: () => ({ email: 'matt@example.com', role: 'maker', user_id: '' }) },
      { data: () => ({ email: 'scott@example.com', role: 'maker', user_id: '' }) },
      { data: () => ({ email: 'gone@example.com', role: 'maker', user_id: '', removed_at: '2026-01-01' }) },
    ]
    mockGenerate.mockResolvedValue({ focus: 'f', nudge_message: 'n' })
    const res = await POST(makeReq(), ctx)
    expect(res.status).toBe(200)
    expect(mockGenerate.mock.calls[0][0].makerNames).toBe('matt and scott')
  })

  it('falls back to requester_first_name when the brief has no maker member rows', async () => {
    projectDocData.requester_first_name = 'Mara'
    mockGenerate.mockResolvedValue({ focus: 'f', nudge_message: 'n' })
    const res = await POST(makeReq(), ctx)
    expect(res.status).toBe(200)
    expect(mockGenerate.mock.calls[0][0].makerNames).toBe('Mara')
  })

  it('serves the stored prep without calling the model when the fingerprint matches', async () => {
    const hash = prepConfigHash({
      sessionMode: 'discover',
      seedQuestions: ['Q1'],
      builderDirectives: [],
      welcomeMessage: null,
      voiceSample: null,
      makerNames: null,
      briefSignal: '',
    })
    projectDocData = {
      title: 'Cafe App',
      session_mode: 'discover',
      seed_questions: ['Q1'],
      prep_config_hash: hash,
      prep_nudge: 'stored nudge',
      prep_focus: 'stored focus',
    }
    const res = await POST(makeReq(), ctx)
    const data = await res.json()
    expect(data).toMatchObject({ focus: 'stored focus', nudge_message: 'stored nudge', cached: true })
    expect(mockGenerate).not.toHaveBeenCalled()
    expect(projectUpdates).toHaveLength(0)
  })

  it('regenerates when force is set even if the fingerprint matches', async () => {
    const hash = prepConfigHash({
      sessionMode: 'discover',
      seedQuestions: ['Q1'],
      builderDirectives: [],
      welcomeMessage: null,
      voiceSample: null,
      makerNames: null,
      briefSignal: '',
    })
    projectDocData = { title: 'Cafe App', session_mode: 'discover', seed_questions: ['Q1'], prep_config_hash: hash, prep_nudge: 'old', prep_focus: 'old' }
    mockGenerate.mockResolvedValue({ focus: 'new focus', nudge_message: 'new nudge' })
    const res = await POST(makeReq({ force: true }), ctx)
    const data = await res.json()
    expect(data.cached).toBe(false)
    expect(mockGenerate).toHaveBeenCalledOnce()
  })

  it('falls back to the template (no hash stored) on model error', async () => {
    mockGenerate.mockRejectedValue(new Error('boom'))
    const res = await POST(makeReq(), ctx)
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.fallback).toBe(true)
    expect(data.focus).toContain('Discover')
    expect(data.nudge_message).toContain('Cafe App')
    // No store → a later call retries.
    expect(projectUpdates).toHaveLength(0)
  })
})
