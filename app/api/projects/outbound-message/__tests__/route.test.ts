import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextResponse } from 'next/server'
import { POST } from '../route'

// =============================================================================
// Tests for POST /api/projects/outbound-message
//
// The route generates contextual invite/nudge/reminder copy by calling the
// generators in lib/agent/outbound-messages.ts. For nudges, it also honors
// `projectData.nudge_message` as a verbatim override and skips the LLM call.
//
// We mock:
//   - generators (so we can assert what they were called with, no LLM calls)
//   - firebase-server-helpers (auth + db + role check)
// =============================================================================

const mockGenerateNudge = vi.fn<(params: Record<string, unknown>) => Promise<string>>(async () => 'AI-generated nudge')
const mockGenerateInvite = vi.fn<(params: Record<string, unknown>) => Promise<string>>(async () => 'AI-generated invite')
const mockGenerateReminder = vi.fn<(params: Record<string, unknown>) => Promise<string>>(async () => 'AI-generated reminder')

vi.mock('@/lib/agent/outbound-messages', () => ({
  generateNudgeMessage: (params: Record<string, unknown>) => mockGenerateNudge(params),
  generateInviteMessage: (params: Record<string, unknown>) => mockGenerateInvite(params),
  generateReminderMessage: (params: Record<string, unknown>) => mockGenerateReminder(params),
}))

let mockProjectData: Record<string, unknown> = {}
const mockDocGet = vi.fn(async () => ({ exists: true, data: () => mockProjectData }))
const mockDoc = vi.fn(() => ({ get: mockDocGet }))
const mockCollection = vi.fn(() => ({ doc: mockDoc }))

const mockGetProjectRole = vi.fn()

vi.mock('@/lib/api/firebase-server-helpers', () => ({
  getAuthenticatedUser: vi.fn(async () => ({
    uid: 'user-123',
    email: 'nico@ibuild4you.com',
    error: null,
    systemRoles: [],
  })),
  getAdminDb: vi.fn(() => ({ collection: mockCollection })),
  getProjectRole: (...args: unknown[]) => mockGetProjectRole(...args),
  requireRole: (role: string | null, minimum: string) => {
    const levels: Record<string, number> = { maker: 0, apprentice: 1, builder: 2, owner: 3 }
    if (!role || levels[role] < levels[minimum]) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    return null
  },
}))

function makeRequest(body: Record<string, unknown>) {
  return new Request('http://localhost/api/projects/outbound-message', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

describe('POST /api/projects/outbound-message — nudge', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetProjectRole.mockResolvedValue('builder')
    mockProjectData = {
      title: 'Project X',
      requester_first_name: 'Matt',
    }
  })

  it('returns nudge_message verbatim when set on the project', async () => {
    mockProjectData.nudge_message = '  Hand-crafted nudge text.  '

    const res = await POST(makeRequest({ project_id: 'proj-1', type: 'nudge' }))
    expect(res.status).toBe(200)
    const data = await res.json()

    // Override is trimmed and returned without calling the LLM.
    expect(data.message).toBe('Hand-crafted nudge text.')
    expect(mockGenerateNudge).not.toHaveBeenCalled()
  })

  it('falls back to AI generation when nudge_message is empty/whitespace', async () => {
    mockProjectData.nudge_message = '   '

    const res = await POST(makeRequest({ project_id: 'proj-1', type: 'nudge' }))
    expect(res.status).toBe(200)
    const data = await res.json()

    expect(data.message).toBe('AI-generated nudge')
    expect(mockGenerateNudge).toHaveBeenCalledOnce()
  })

  it('passes voice_sample to the nudge generator and omits trimmed inputs', async () => {
    mockProjectData.voice_sample = 'Short. No emoji.'
    mockProjectData.session_mode = 'discover'
    mockProjectData.builder_directives = ['ignored in prompt now']
    mockProjectData.seed_questions = ['also ignored']

    await POST(
      makeRequest({
        project_id: 'proj-1',
        type: 'nudge',
        nudge_note: 'Check on the form upload',
        session_number: 3,
      })
    )

    expect(mockGenerateNudge).toHaveBeenCalledOnce()
    const callArgs = mockGenerateNudge.mock.calls[0][0] as Record<string, unknown>
    expect(callArgs.voiceSample).toBe('Short. No emoji.')
    expect(callArgs.builderNote).toBe('Check on the form upload')
    expect(callArgs.sessionNumber).toBe(3)
    expect(callArgs.makerFirstName).toBe('Matt')
    // These were dropped from NudgeParams — they should not be passed.
    expect(callArgs.directives).toBeUndefined()
    expect(callArgs.seedQuestions).toBeUndefined()
    expect(callArgs.briefSummary).toBeUndefined()
    expect(callArgs.openRisks).toBeUndefined()
  })

  it('returns 400 for unknown type', async () => {
    const res = await POST(makeRequest({ project_id: 'proj-1', type: 'bogus' }))
    expect(res.status).toBe(400)
  })

  it('returns 403 for maker role', async () => {
    mockGetProjectRole.mockResolvedValue('maker')
    const res = await POST(makeRequest({ project_id: 'proj-1', type: 'nudge' }))
    expect(res.status).toBe(403)
  })
})
