import { describe, it, expect, vi, beforeEach } from 'vitest'
import { writeNoteForProject } from '../note-writer'

// =============================================================================
// writeNoteForProject (#229) — writes a short per-conversation note under
// briefs/{briefId}/notes instead of rewriting the whole brief. Anthropic is
// mocked; Firestore is a small in-memory fake that supports the shapes the
// writer, upsertBrief and addNote use.
// =============================================================================

const mockMessagesCreate = vi.fn()
vi.mock('@anthropic-ai/sdk', () => ({
  default: class {
    messages = { create: mockMessagesCreate }
  },
}))
vi.mock('@/lib/observability/anthropic', () => ({ logAnthropicCall: vi.fn(async () => {}) }))

type Data = Record<string, unknown>

// path ("briefs" or "briefs/b1/notes") → id → data
let store: Map<string, Map<string, Data>>
let autoId: number
// When set, any update to a top-level brief doc throws (simulates a failed contest write).
let failBriefUpdate: boolean

function coll(path: string): Map<string, Data> {
  if (!store.has(path)) store.set(path, new Map())
  return store.get(path)!
}

function docRef(path: string, id: string) {
  return {
    id,
    get: async () => ({ id, exists: coll(path).has(id), data: () => coll(path).get(id) }),
    set: async (d: Data) => void coll(path).set(id, { ...d }),
    update: async (patch: Data) => {
      if (failBriefUpdate && path === 'briefs') throw new Error('brief write failed')
      if (!coll(path).has(id)) throw new Error(`NOT_FOUND ${path}/${id}`)
      coll(path).set(id, { ...coll(path).get(id), ...patch })
    },
    collection: (name: string) => collRef(`${path}/${id}/${name}`),
  }
}

type Filter = { field: string; value: unknown }
function query(
  path: string,
  filters: Filter[],
  order?: { field: string; dir: string },
  n?: number
) {
  return {
    where: (field: string, _op: string, value: unknown) =>
      query(path, [...filters, { field, value }], order, n),
    orderBy: (field: string, dir = 'asc') => query(path, filters, { field, dir }, n),
    limit: (k: number) => query(path, filters, order, k),
    get: async () => {
      let entries = [...coll(path).entries()].filter(([, d]) =>
        filters.every((f) => d[f.field] === f.value)
      )
      if (order) {
        entries.sort((a, b) => {
          const x = a[1][order.field] as string | number
          const y = b[1][order.field] as string | number
          const c = x < y ? -1 : x > y ? 1 : 0
          return order.dir === 'desc' ? -c : c
        })
      }
      if (n !== undefined) entries = entries.slice(0, n)
      const docs = entries.map(([id, data]) => ({ id, data: () => data, ref: docRef(path, id) }))
      return { docs, empty: docs.length === 0, size: docs.length }
    },
  }
}

function collRef(path: string) {
  return {
    ...query(path, []),
    doc: (id: string) => docRef(path, id),
    add: async (d: Data) => {
      const id = `auto${++autoId}`
      coll(path).set(id, { ...d })
      return { id }
    },
  }
}

const db = { collection: (name: string) => collRef(name) } as unknown as FirebaseFirestore.Firestore

const emptyBrief = {
  problem: '',
  target_users: '',
  features: [],
  constraints: '',
  additional_context: '',
  decisions: [],
  open_risks: [],
}

function seedProject(extra: Data = {}) {
  coll('projects').set('p1', { title: 'Cafe', ...extra })
}
function seedSession(id: string, created_at: string, extra: Data = {}) {
  coll('sessions').set(id, { project_id: 'p1', created_at, ...extra })
}
function seedMessage(
  id: string,
  session_id: string,
  created_at: string,
  content: string,
  role = 'user'
) {
  coll('messages').set(id, { session_id, created_at, content, role })
}
function seedBrief(content: Data, updated_at: string) {
  coll('briefs').set('b1', { project_id: 'p1', version: 3, content, updated_at, source: 'paste' })
}

function noteResponse(input: Data, stop_reason = 'tool_use') {
  return {
    stop_reason,
    usage: { input_tokens: 10, output_tokens: 5 },
    content: [{ type: 'tool_use', name: 'write_note', id: 't1', input }],
  }
}

const someNote = {
  text: 'Maker wants pickup only.',
  decisions: [{ topic: 'Delivery', decision: 'Pickup only' }],
  risks_added: [{ text: 'Opening hours unknown', owner: 'maker' }],
  risks_resolved: [],
  lock_reversals: [],
}

type Call = {
  model: string
  max_tokens: number
  system: Array<{ text: string; cache_control?: { type: string } }>
  messages: Array<{ content: Array<{ text: string }> }>
  tools: Array<{ name: string }>
  tool_choice: { type: string; name: string }
}
const lastCall = () => mockMessagesCreate.mock.calls.at(-1)![0] as Call
const userText = (c: Call) => c.messages[0].content[0].text
// Notes of the project's only brief (seeded b1, or the one the writer created).
const notes = () => {
  const ids = [...coll('briefs').keys()]
  return ids.length === 1 ? [...coll(`briefs/${ids[0]}/notes`).values()] : []
}

beforeEach(() => {
  store = new Map()
  autoId = 0
  failBriefUpdate = false
  mockMessagesCreate.mockReset()
  process.env.ANTHROPIC_API_KEY = 'test-key'
})

describe('writeNoteForProject', () => {
  it("writes a note from messages after notes_through_at and advances it to the last message's created_at", async () => {
    seedProject({ notes_through_at: '2026-10-01T00:00:02Z' })
    seedBrief(emptyBrief, '2026-09-01T00:00:00Z')
    seedSession('s1', '2026-10-01T00:00:00Z')
    seedMessage('m1', 's1', '2026-10-01T00:00:01Z', 'old one')
    seedMessage('m2', 's1', '2026-10-01T00:00:02Z', 'old two')
    seedMessage('m3', 's1', '2026-10-01T00:00:03Z', 'new three')
    seedMessage('m4', 's1', '2026-10-01T00:00:04Z', 'new four', 'agent')
    mockMessagesCreate.mockResolvedValue(noteResponse(someNote))

    const res = await writeNoteForProject(db, 'p1')

    expect(res.covered).toBe(2)
    expect(res.through).toBe('2026-10-01T00:00:04Z')
    expect(res.note_id).toBeTruthy()
    const saved = notes()
    expect(saved).toHaveLength(1)
    expect(saved[0]).toMatchObject({
      session_id: 's1',
      folded_at: null,
      text: 'Maker wants pickup only.',
      decisions: [{ topic: 'Delivery', decision: 'Pickup only' }],
      risks_added: [{ text: 'Opening hours unknown', owner: 'maker' }],
    })
    expect(typeof saved[0].created_at).toBe('string')
    expect(coll('projects').get('p1')!.notes_through_at).toBe('2026-10-01T00:00:04Z')
    const nm = userText(lastCall()).split('<new_messages>')[1]
    expect(nm).toContain('User: new three')
    expect(nm).toContain('Assistant: new four')
    expect(nm).not.toContain('old two')
  })

  it('stores a settled risk with its answer, and still accepts a bare text', async () => {
    seedProject({ notes_through_at: '2026-10-28T10:00:00.000Z' })
    seedBrief({ problem: 'p', decisions: [], open_risks: ['Start over button?', 'Hosting'] }, '2026-10-27T00:00:00.000Z')
    seedSession('s1', '2026-10-28T09:00:00.000Z')
    seedMessage('m1', 's1', '2026-10-28T11:00:00.000Z', 'Yes to start over, on the results page')
    mockMessagesCreate.mockResolvedValue(
      noteResponse({
        ...someNote,
        risks_resolved: [
          { text: ' Start over button? ', resolution: ' Yes, on the results page ' },
          'Hosting',
          { text: 'No answer' },
        ],
      })
    )
    await writeNoteForProject(db, 'p1')
    expect(notes()[0].risks_resolved).toEqual([
      { text: 'Start over button?', resolution: 'Yes, on the results page' },
      'Hosting',
      'No answer',
    ])
  })

  it('asks the model for a resolution on each settled risk', async () => {
    seedProject({ notes_through_at: '2026-10-28T10:00:00.000Z' })
    seedSession('s1', '2026-10-28T09:00:00.000Z')
    seedMessage('m1', 's1', '2026-10-28T11:00:00.000Z', 'hello')
    mockMessagesCreate.mockResolvedValue(noteResponse(someNote))
    await writeNoteForProject(db, 'p1')
    const tool = (lastCall().tools[0] as unknown as {
      input_schema: { properties: { risks_resolved: { items: { properties: Record<string, unknown>; required: string[] } } } }
    }).input_schema.properties.risks_resolved.items
    expect(Object.keys(tool.properties)).toEqual(['text', 'resolution'])
    expect(tool.required).toEqual(['text', 'resolution'])
  })

  it('labels messages from an owner/builder member Builder: (#245)', async () => {
    seedProject()
    seedSession('s1', '2026-10-01T00:00:00Z')
    coll('project_members').set('mem1', { project_id: 'p1', email: 'sam@example.com', role: 'maker' })
    coll('project_members').set('mem2', { project_id: 'p1', email: 'nico@example.com', role: 'owner' })
    coll('messages').set('m1', {
      session_id: 's1',
      created_at: '2026-10-01T00:00:01Z',
      content: 'maker words',
      role: 'user',
      sender_email: 'sam@example.com',
    })
    coll('messages').set('m2', {
      session_id: 's1',
      created_at: '2026-10-01T00:00:02Z',
      content: 'builder guidance',
      role: 'user',
      sender_email: 'nico@example.com',
    })
    mockMessagesCreate.mockResolvedValue(noteResponse(someNote))

    await writeNoteForProject(db, 'p1')

    const nm = userText(lastCall()).split('<new_messages>')[1]
    expect(nm).toContain('User: maker words')
    expect(nm).toContain('Builder: builder guidance')
  })

  it('starts after brief.updated_at when notes_through_at is absent', async () => {
    seedProject()
    seedBrief(emptyBrief, '2026-10-01T00:00:02Z')
    seedSession('s1', '2026-10-01T00:00:00Z')
    seedMessage('m1', 's1', '2026-10-01T00:00:01Z', 'before brief')
    seedMessage('m2', 's1', '2026-10-01T00:00:03Z', 'after brief')
    mockMessagesCreate.mockResolvedValue(noteResponse(someNote))

    const res = await writeNoteForProject(db, 'p1')

    expect(res.covered).toBe(1)
    const nm = userText(lastCall()).split('<new_messages>')[1]
    expect(nm).toContain('after brief')
    expect(nm).not.toContain('before brief')
  })

  it('second run covers only newer messages', async () => {
    seedProject()
    seedSession('s1', '2026-10-01T00:00:00Z')
    seedMessage('m1', 's1', '2026-10-01T00:00:01Z', 'first chat')
    mockMessagesCreate.mockResolvedValue(noteResponse(someNote))

    const first = await writeNoteForProject(db, 'p1')
    expect(first.covered).toBe(1)

    seedMessage('m2', 's1', '2026-10-01T00:10:00Z', 'second chat')
    const second = await writeNoteForProject(db, 'p1')

    expect(second.covered).toBe(1)
    expect(second.through).toBe('2026-10-01T00:10:00Z')
    const nm = userText(lastCall()).split('<new_messages>')[1]
    expect(nm).toContain('second chat')
    expect(nm).not.toContain('first chat')
    expect(notes()).toHaveLength(2)
  })

  it('sends the 6 messages before the first new one as earlier context', async () => {
    seedProject({ notes_through_at: '2026-10-02T00:00:08Z' })
    seedBrief(emptyBrief, '2026-09-01T00:00:00Z')
    // Two sessions: earlier context spans them.
    seedSession('s1', '2026-10-01T00:00:00Z')
    seedSession('s2', '2026-10-02T00:00:00Z')
    for (let i = 1; i <= 4; i++)
      seedMessage(`a${i}`, 's1', `2026-10-01T00:00:0${i}Z`, `ctx-s1-${i}`)
    for (let i = 5; i <= 8; i++)
      seedMessage(`b${i}`, 's2', `2026-10-02T00:00:0${i}Z`, `ctx-s2-${i}`)
    seedMessage('n1', 's2', '2026-10-02T00:00:09Z', 'brand new')
    mockMessagesCreate.mockResolvedValue(noteResponse(someNote))

    await writeNoteForProject(db, 'p1')

    const text = userText(lastCall())
    const earlier = text.split('<earlier_context>')[1].split('</earlier_context>')[0]
    expect(earlier).not.toContain('ctx-s1-1')
    expect(earlier).not.toContain('ctx-s1-2')
    for (const k of ['ctx-s1-3', 'ctx-s1-4', 'ctx-s2-5', 'ctx-s2-6', 'ctx-s2-7', 'ctx-s2-8']) {
      expect(earlier).toContain(k)
    }
    expect(earlier).not.toContain('brand new')
    expect(text).toContain('<current_brief>')
  })

  it("passes the brief's unfolded notes (not folded ones) as <notes_since_curation>", async () => {
    seedProject({ notes_through_at: '2026-10-01T00:00:01Z' })
    seedBrief(emptyBrief, '2026-09-01T00:00:00Z')
    coll('briefs/b1/notes').set('old', {
      session_id: 's0',
      created_at: '2026-09-20T00:00:00Z',
      folded_at: '2026-09-25T00:00:00Z',
      text: 'ALREADY CURATED',
      decisions: [],
      risks_added: [],
      risks_resolved: [],
      lock_reversals: [],
    })
    coll('briefs/b1/notes').set('recent', {
      session_id: 's1',
      created_at: '2026-10-01T00:00:01Z',
      folded_at: null,
      text: 'EARLIER UNFOLDED NOTE',
      decisions: [{ topic: 'Delivery', decision: 'Pickup only' }],
      risks_added: ['Opening hours unknown'],
      risks_resolved: [],
      lock_reversals: [],
    })
    seedSession('s1', '2026-10-01T00:00:00Z')
    seedMessage('m1', 's1', '2026-10-01T00:00:01Z', 'old')
    seedMessage('m2', 's1', '2026-10-01T00:00:02Z', 'new')
    mockMessagesCreate.mockResolvedValue(noteResponse(someNote))

    await writeNoteForProject(db, 'p1')

    const call = lastCall()
    const block = userText(call).split('<notes_since_curation>')[1].split('</notes_since_curation>')[0]
    expect(block).toContain('EARLIER UNFOLDED NOTE')
    expect(block).toContain('Delivery')
    expect(block).toContain('Opening hours unknown')
    expect(block).not.toContain('ALREADY CURATED')
    expect(call.system[0].text).toContain('<notes_since_curation>')
  })

  it('says None in <notes_since_curation> when there are no unfolded notes', async () => {
    seedProject()
    seedSession('s1', '2026-10-01T00:00:00Z')
    seedMessage('m1', 's1', '2026-10-01T00:00:01Z', 'hello')
    mockMessagesCreate.mockResolvedValue(noteResponse(someNote))

    await writeNoteForProject(db, 'p1')

    expect(userText(lastCall())).toContain('<notes_since_curation>\nNone\n</notes_since_curation>')
  })

  it('creates an empty brief when none exists', async () => {
    seedProject()
    seedSession('s1', '2026-10-01T00:00:00Z')
    seedMessage('m1', 's1', '2026-10-01T00:00:01Z', 'hello')
    mockMessagesCreate.mockResolvedValue(noteResponse(someNote))

    await writeNoteForProject(db, 'p1')

    const briefs = [...coll('briefs').entries()]
    expect(briefs).toHaveLength(1)
    const [briefId, brief] = briefs[0]
    expect(brief).toMatchObject({
      project_id: 'p1',
      version: 1,
      source: 'create',
      content: emptyBrief,
    })
    expect(coll(`briefs/${briefId}/notes`).size).toBe(1)
  })

  it('empty model output writes no note but advances notes_through_at', async () => {
    seedProject()
    seedBrief(emptyBrief, '2026-09-01T00:00:00Z')
    seedSession('s1', '2026-10-01T00:00:00Z')
    seedMessage('m1', 's1', '2026-10-01T00:00:01Z', 'ok thanks')
    mockMessagesCreate.mockResolvedValue(
      noteResponse({
        text: '  ',
        decisions: [],
        risks_added: [],
        risks_resolved: [],
        lock_reversals: [],
      })
    )

    const res = await writeNoteForProject(db, 'p1')

    expect(res.note_id).toBeNull()
    expect(notes()).toHaveLength(0)
    expect(coll('projects').get('p1')!.notes_through_at).toBe('2026-10-01T00:00:01Z')
  })

  it('max_tokens throws write_note_max_tokens and does not advance notes_through_at', async () => {
    seedProject({ notes_through_at: '2026-10-01T00:00:00Z' })
    seedBrief(emptyBrief, '2026-09-01T00:00:00Z')
    seedSession('s1', '2026-10-01T00:00:00Z')
    seedMessage('m1', 's1', '2026-10-01T00:00:01Z', 'long')
    mockMessagesCreate.mockResolvedValue(noteResponse(someNote, 'max_tokens'))

    await expect(writeNoteForProject(db, 'p1')).rejects.toThrow('write_note_max_tokens')
    expect(coll('projects').get('p1')!.notes_through_at).toBe('2026-10-01T00:00:00Z')
    expect(notes()).toHaveLength(0)
  })

  it('a lock reversal on a locked topic sets contested and writes a brief version with source note', async () => {
    seedProject()
    seedBrief(
      { ...emptyBrief, decisions: [{ topic: 'Payment', decision: 'Stripe only', locked: true }] },
      '2026-09-01T00:00:00Z'
    )
    seedSession('s1', '2026-10-01T00:00:00Z')
    seedMessage('m1', 's1', '2026-10-01T00:00:01Z', 'Yes, I confirm: use Square instead')
    mockMessagesCreate.mockResolvedValue(
      noteResponse({
        ...someNote,
        lock_reversals: [
          { topic: ' payment ', proposed: 'Square', reason: 'Maker confirmed Oct 1' },
          { topic: 'Nonexistent', proposed: 'x', reason: 'y' },
        ],
      })
    )

    await writeNoteForProject(db, 'p1')

    const brief = coll('briefs').get('b1')!
    expect(brief.source).toBe('note')
    expect(brief.version).toBe(4)
    const content = brief.content as { decisions: Data[] }
    expect(content.decisions[0]).toMatchObject({
      topic: 'Payment',
      decision: 'Stripe only',
      locked: true,
      contested: { proposed: 'Square', reason: 'Maker confirmed Oct 1' },
    })
    expect(coll('briefs/b1/versions').get('3')).toBeTruthy()
    // Both reversals stay on the note.
    expect(notes()[0].lock_reversals).toHaveLength(2)
  })

  it('a lock reversal matching contest_dismissed is ignored', async () => {
    seedProject()
    seedBrief(
      {
        ...emptyBrief,
        decisions: [
          {
            topic: 'Payment',
            decision: 'Stripe only',
            locked: true,
            contest_dismissed: { proposed: 'Square.', at: '2026-09-15T00:00:00Z' },
          },
        ],
      },
      '2026-09-01T00:00:00Z'
    )
    seedSession('s1', '2026-10-01T00:00:00Z')
    seedMessage('m1', 's1', '2026-10-01T00:00:01Z', 'Square please')
    mockMessagesCreate.mockResolvedValue(
      noteResponse({
        ...someNote,
        lock_reversals: [{ topic: 'Payment', proposed: 'square', reason: 'again' }],
      })
    )

    await writeNoteForProject(db, 'p1')

    const brief = coll('briefs').get('b1')!
    expect(brief.version).toBe(3)
    expect(brief.source).toBe('paste')
    expect((brief.content as { decisions: Data[] }).decisions[0].contested).toBeUndefined()
  })

  it('throws write_note_no_messages when nothing is new', async () => {
    seedProject({ notes_through_at: '2026-10-01T00:00:01Z' })
    seedBrief(emptyBrief, '2026-09-01T00:00:00Z')
    seedSession('s1', '2026-10-01T00:00:00Z')
    seedMessage('m1', 's1', '2026-10-01T00:00:01Z', 'already covered')

    await expect(writeNoteForProject(db, 'p1')).rejects.toThrow('write_note_no_messages')
    expect(mockMessagesCreate).not.toHaveBeenCalled()
  })

  it('uses max_tokens 1500 and tool_choice write_note', async () => {
    seedProject()
    seedSession('s1', '2026-10-01T00:00:00Z')
    seedMessage('m1', 's1', '2026-10-01T00:00:01Z', 'hello')
    mockMessagesCreate.mockResolvedValue(noteResponse(someNote))

    await writeNoteForProject(db, 'p1')

    const c = lastCall()
    expect(c.max_tokens).toBe(1500)
    expect(c.model).toBe('claude-sonnet-4-6')
    expect(c.tools[0].name).toBe('write_note')
    expect(c.tool_choice).toEqual({ type: 'tool', name: 'write_note' })
    expect(c.system[0].cache_control).toEqual({ type: 'ephemeral' })
  })

  it('session_id is the latest non-archived session among covered messages', async () => {
    seedProject()
    seedSession('s1', '2026-10-01T00:00:00Z')
    seedSession('s2', '2026-10-02T00:00:00Z', { status: 'archived' })
    seedMessage('m1', 's1', '2026-10-01T00:00:01Z', 'one')
    seedMessage('m2', 's2', '2026-10-02T00:00:01Z', 'two')
    mockMessagesCreate.mockResolvedValue(noteResponse(someNote))

    await writeNoteForProject(db, 'p1')

    expect(notes()[0].session_id).toBe('s1')
  })

  it('throws write_note_no_tool_use when the model returns no tool call', async () => {
    seedProject()
    seedSession('s1', '2026-10-01T00:00:00Z')
    seedMessage('m1', 's1', '2026-10-01T00:00:01Z', 'hello')
    mockMessagesCreate.mockResolvedValue({
      stop_reason: 'end_turn',
      content: [{ type: 'text', text: 'hi' }],
    })

    await expect(writeNoteForProject(db, 'p1')).rejects.toThrow('write_note_no_tool_use')
    expect(coll('projects').get('p1')!.notes_through_at).toBeUndefined()
  })

  it('a failed contest write still resolves, keeps one note and advances notes_through_at', async () => {
    seedProject()
    seedBrief(
      { ...emptyBrief, decisions: [{ topic: 'Payment', decision: 'Stripe only', locked: true }] },
      '2026-09-01T00:00:00Z'
    )
    seedSession('s1', '2026-10-01T00:00:00Z')
    seedMessage('m1', 's1', '2026-10-01T00:00:01Z', 'Yes, switch to Square')
    mockMessagesCreate.mockResolvedValue(
      noteResponse({
        ...someNote,
        lock_reversals: [{ topic: 'Payment', proposed: 'Square', reason: 'confirmed' }],
      })
    )
    failBriefUpdate = true
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    const res = await writeNoteForProject(db, 'p1')

    expect(res.note_id).toBeTruthy()
    expect(notes()).toHaveLength(1)
    expect(coll('projects').get('p1')!.notes_through_at).toBe('2026-10-01T00:00:01Z')
    expect(coll('briefs').get('b1')!.version).toBe(3)
    expect(errSpy).toHaveBeenCalledWith('write_note_contest_failed', expect.anything())
    errSpy.mockRestore()
  })

  it('applies the contest to the brief as it is after the model call, not before', async () => {
    seedProject()
    seedBrief(
      { ...emptyBrief, decisions: [{ topic: 'Payment', decision: 'Stripe only', locked: true }] },
      '2026-09-01T00:00:00Z'
    )
    seedSession('s1', '2026-10-01T00:00:00Z')
    seedMessage('m1', 's1', '2026-10-01T00:00:01Z', 'Yes, switch to Square')
    mockMessagesCreate.mockImplementation(async () => {
      // The builder saves a new version while the model is writing.
      coll('briefs').set('b1', {
        project_id: 'p1',
        version: 4,
        updated_at: '2026-10-01T00:00:02Z',
        source: 'paste',
        content: {
          ...emptyBrief,
          problem: 'Fresh problem',
          decisions: [{ topic: 'Payment', decision: 'Stripe only', locked: true }],
        },
      })
      return noteResponse({
        ...someNote,
        lock_reversals: [{ topic: 'Payment', proposed: 'Square', reason: 'confirmed' }],
      })
    })

    await writeNoteForProject(db, 'p1')

    const brief = coll('briefs').get('b1')!
    expect(brief.version).toBe(5)
    expect(brief.source).toBe('note')
    const content = brief.content as { problem: string; decisions: Data[] }
    expect(content.problem).toBe('Fresh problem')
    expect(content.decisions[0].contested).toEqual({ proposed: 'Square', reason: 'confirmed' })
  })

  it('writes a note whose only content is a lock reversal', async () => {
    seedProject()
    seedBrief(emptyBrief, '2026-09-01T00:00:00Z')
    seedSession('s1', '2026-10-01T00:00:00Z')
    seedMessage('m1', 's1', '2026-10-01T00:00:01Z', 'change it')
    mockMessagesCreate.mockResolvedValue(
      noteResponse({
        text: '',
        decisions: [],
        risks_added: [],
        risks_resolved: [],
        lock_reversals: [{ topic: 'Payment', proposed: 'Square', reason: 'confirmed' }],
      })
    )

    const res = await writeNoteForProject(db, 'p1')

    expect(res.note_id).toBeTruthy()
    expect(notes()).toHaveLength(1)
    expect(notes()[0].lock_reversals).toHaveLength(1)
  })

  it('creates no brief when there is none and the note is empty', async () => {
    seedProject()
    seedSession('s1', '2026-10-01T00:00:00Z')
    seedMessage('m1', 's1', '2026-10-01T00:00:01Z', 'hi')
    mockMessagesCreate.mockResolvedValue(
      noteResponse({
        text: '',
        decisions: [],
        risks_added: [],
        risks_resolved: [],
        lock_reversals: [],
      })
    )

    await writeNoteForProject(db, 'p1')

    expect(coll('briefs').size).toBe(0)
    expect(coll('projects').get('p1')!.notes_through_at).toBe('2026-10-01T00:00:01Z')
  })
  // 👎 on Sam's replies: copied into the note by code, never by the model, and
  // never shown to the model (Sam reads notes; the signal is for the builder).
  describe('thumbs down', () => {
    const emptyOutput = { text: '', decisions: [], risks_added: [], risks_resolved: [], lock_reversals: [] }

    it('records each 👎 reply in the window with an excerpt and the reason', async () => {
      seedProject({ notes_through_at: '2026-10-01T00:00:01Z' })
      seedBrief(emptyBrief, '2026-09-01T00:00:00Z')
      seedSession('s1', '2026-10-01T00:00:00Z')
      coll('messages').set('old', {
        session_id: 's1', created_at: '2026-10-01T00:00:01Z', role: 'agent', content: 'Before the window', rating: 'down',
      })
      seedMessage('m2', 's1', '2026-10-01T00:00:02Z', 'I sell bread')
      coll('messages').set('m3', {
        session_id: 's1', created_at: '2026-10-01T00:00:03Z', role: 'agent',
        content: 'What   is your\npricing model?', rating: 'down', rating_reason: 'asked twice',
      })
      coll('messages').set('m4', {
        session_id: 's1', created_at: '2026-10-01T00:00:04Z', role: 'agent', content: 'Great!', rating: 'up',
      })
      coll('messages').set('m5', {
        session_id: 's1', created_at: '2026-10-01T00:00:05Z', role: 'agent', content: 'x'.repeat(300), rating: 'down',
      })
      mockMessagesCreate.mockResolvedValue(noteResponse(someNote))

      await writeNoteForProject(db, 'p1')

      expect(notes()[0].thumbs_down).toEqual([
        { excerpt: 'What is your pricing model?', reason: 'asked twice' },
        { excerpt: `${'x'.repeat(160)}…` },
      ])
      expect(userText(lastCall())).not.toMatch(/asked twice|rating/)
    })

    it('saves a note whose only content is a 👎', async () => {
      seedProject()
      seedSession('s1', '2026-10-01T00:00:00Z')
      coll('messages').set('m1', {
        session_id: 's1', created_at: '2026-10-01T00:00:01Z', role: 'agent', content: 'Hmm', rating: 'down',
      })
      mockMessagesCreate.mockResolvedValue(noteResponse(emptyOutput))

      const res = await writeNoteForProject(db, 'p1')

      expect(res.note_id).toBeTruthy()
      expect(notes()[0].thumbs_down).toEqual([{ excerpt: 'Hmm' }])
    })

    it('leaves thumbs_down off a note with no 👎', async () => {
      seedProject()
      seedSession('s1', '2026-10-01T00:00:00Z')
      seedMessage('m1', 's1', '2026-10-01T00:00:01Z', 'hello')
      mockMessagesCreate.mockResolvedValue(noteResponse(someNote))

      await writeNoteForProject(db, 'p1')

      expect(notes()[0]).not.toHaveProperty('thumbs_down')
    })
  })

  // Email-in: stored emails from members join the chat messages as one stream
  // ordered by time, after the line filter removes what the app already holds.
  describe('emails', () => {
    function seedEmail(
      id: string,
      received_at: string,
      text: string,
      extra: Partial<{ from_email: string; from_name: string; from_role: 'maker' | 'builder' }> = {}
    ) {
      coll('project_emails').set(id, {
        project_id: 'p1',
        from_email: 'bill@example.com',
        from_name: 'Bill Duris',
        from_role: 'maker',
        received_at,
        sent_at: null,
        subject: 'Re: the shop',
        message_id: `<${id}@mail>`,
        text,
        truncated: false,
        attachments: [],
        ...extra,
      })
    }
    // Exactly n characters of lines no other email shares (each tagged), so the
    // line filter keeps all of it.
    function bigText(tag: string, n: number): string {
      const lines: string[] = []
      let length = -1
      for (let i = 0; length < n; i++) {
        const line = `${tag} line ${i} `.padEnd(99, 'x')
        lines.push(line)
        length += line.length + 1
      }
      // Never end on a newline: the filter trims it, and the count would be off by one.
      return lines.join('\n').slice(0, n).replace(/\n$/, 'x')
    }
    const newMessagesBlock = () =>
      userText(lastCall()).split('<new_messages>')[1].split('</new_messages>')[0]
    const block = (text: string, tag: string) => text.split(`<${tag}>\n`)[1].split(`\n</${tag}>`)[0]

    it('writes one note from two emails and no chat, with email_ids and email_sources stamped', async () => {
      seedProject()
      seedEmail('e1_p1', '2026-11-19T17:00:00.000Z', 'I want the gallery page to load fast')
      seedEmail('e2_p1', '2026-11-19T18:00:00.000Z', 'Noted, I will check the hosting plan', {
        from_name: 'Nico',
        from_role: 'builder',
      })
      mockMessagesCreate.mockResolvedValue(noteResponse(someNote))

      const res = await writeNoteForProject(db, 'p1')

      expect(res.covered).toBe(2)
      expect(res.through).toBe('2026-11-19T18:00:00.000Z')
      expect(mockMessagesCreate).toHaveBeenCalledTimes(1)
      const saved = notes()
      expect(saved).toHaveLength(1)
      expect(saved[0]).toMatchObject({
        session_id: null,
        email_ids: ['e1_p1', 'e2_p1'],
        email_sources: [
          { from_name: 'Bill Duris', from_role: 'maker', received_at: '2026-11-19T17:00:00.000Z' },
          { from_name: 'Nico', from_role: 'builder', received_at: '2026-11-19T18:00:00.000Z' },
        ],
      })
      expect(saved[0]).not.toHaveProperty('email_truncated')
      expect(coll('projects').get('p1')!.notes_through_at).toBe('2026-11-19T18:00:00.000Z')
      const nm = newMessagesBlock()
      expect(nm).toContain('Email from Maker (Bill Duris), received 2026-11-19:\n<typed>\nI want the gallery page to load fast\n</typed>')
      expect(nm).toContain('Email from Builder (Nico), received 2026-11-19:')
    })

    it("labels an email with the Pacific calendar day, not the UTC one", async () => {
      seedProject()
      // 05:00 UTC on the 20th is the evening of the 19th in Pacific time.
      seedEmail('e1_p1', '2026-11-20T05:00:00.000Z', 'Prices in euros please')
      mockMessagesCreate.mockResolvedValue(noteResponse(someNote))

      await writeNoteForProject(db, 'p1')

      expect(newMessagesBlock()).toContain('Email from Maker (Bill Duris), received 2026-11-19:')
    })

    it('interleaves chat messages and emails by time and ends notes_through_at at the later', async () => {
      seedProject()
      seedSession('s1', '2026-11-19T00:00:00.000Z')
      seedMessage('m1', 's1', '2026-11-19T10:00:00.000Z', 'chat one')
      seedEmail('e1_p1', '2026-11-19T11:00:00.000Z', 'email between the chats')
      seedMessage('m2', 's1', '2026-11-19T12:00:00.000Z', 'chat two', 'agent')
      seedEmail('e2_p1', '2026-11-19T13:00:00.000Z', 'email after both chats')
      mockMessagesCreate.mockResolvedValue(noteResponse(someNote))

      const res = await writeNoteForProject(db, 'p1')

      const nm = newMessagesBlock()
      const order = ['User: chat one', 'email between the chats', 'Assistant: chat two', 'email after both chats'].map(
        (s) => nm.indexOf(s)
      )
      expect(order.every((i) => i > -1)).toBe(true)
      expect([...order].sort((a, b) => a - b)).toEqual(order)
      expect(res.covered).toBe(4)
      expect(res.through).toBe('2026-11-19T13:00:00.000Z')
      expect(coll('projects').get('p1')!.notes_through_at).toBe('2026-11-19T13:00:00.000Z')
      expect(notes()[0]).toMatchObject({ session_id: 's1', email_ids: ['e1_p1', 'e2_p1'] })
    })

    it('ends notes_through_at at a chat message that comes after the last email', async () => {
      seedProject()
      seedSession('s1', '2026-11-19T00:00:00.000Z')
      seedEmail('e1_p1', '2026-11-19T11:00:00.000Z', 'email before the chat')
      seedMessage('m1', 's1', '2026-11-19T12:00:00.000Z', 'chat after the email')
      mockMessagesCreate.mockResolvedValue(noteResponse(someNote))

      const res = await writeNoteForProject(db, 'p1')

      expect(res.through).toBe('2026-11-19T12:00:00.000Z')
      expect(coll('projects').get('p1')!.notes_through_at).toBe('2026-11-19T12:00:00.000Z')
    })

    it('puts a chat message before an email with the same timestamp', async () => {
      seedProject()
      seedSession('s1', '2026-11-19T00:00:00.000Z')
      seedEmail('e1_p1', '2026-11-19T11:00:00.000Z', 'email at the same moment')
      seedMessage('m1', 's1', '2026-11-19T11:00:00.000Z', 'chat at the same moment')
      mockMessagesCreate.mockResolvedValue(noteResponse(someNote))

      await writeNoteForProject(db, 'p1')

      const nm = newMessagesBlock()
      expect(nm.indexOf('chat at the same moment')).toBeLessThan(nm.indexOf('email at the same moment'))
    })

    it('does not read again an email whose received_at equals notes_through_at', async () => {
      seedProject({ notes_through_at: '2026-11-19T11:00:00.000Z' })
      seedEmail('e1_p1', '2026-11-19T11:00:00.000Z', 'already covered email')
      seedEmail('e2_p1', '2026-11-19T12:00:00.000Z', 'a brand new email here')
      mockMessagesCreate.mockResolvedValue(noteResponse(someNote))

      const res = await writeNoteForProject(db, 'p1')

      expect(res.covered).toBe(1)
      expect(newMessagesBlock()).not.toContain('already covered email')
      expect(notes()[0].email_ids).toEqual(['e2_p1'])
    })

    // F1: received_at is the app's clock when it stored the email, so an email
    // Resend delivered late (after a retried 500) still lands after the last
    // note, whatever its Date header says.
    it('covers an email stored after a note even when it was sent before that note', async () => {
      seedProject({ notes_through_at: '2026-11-19T12:00:00.000Z' })
      seedEmail('e1_p1', '2026-11-19T15:00:00.000Z', 'Sent this morning, stored this afternoon')
      coll('project_emails').get('e1_p1')!.sent_at = '2026-11-19T09:00:00.000Z'
      mockMessagesCreate.mockResolvedValue(noteResponse(someNote))

      const res = await writeNoteForProject(db, 'p1')

      expect(res).toMatchObject({ covered: 1, through: '2026-11-19T15:00:00.000Z' })
      expect(newMessagesBlock()).toContain('Sent this morning, stored this afternoon')
      expect(notes()[0].email_ids).toEqual(['e1_p1'])
    })

    it('shows an email from before the window as earlier context', async () => {
      seedProject({ notes_through_at: '2026-11-19T11:00:00.000Z' })
      seedEmail('e1_p1', '2026-11-19T11:00:00.000Z', 'an email noted last time')
      seedEmail('e2_p1', '2026-11-19T12:00:00.000Z', 'a brand new email here')
      mockMessagesCreate.mockResolvedValue(noteResponse(someNote))

      await writeNoteForProject(db, 'p1')

      const earlier = userText(lastCall()).split('<earlier_context>')[1].split('</earlier_context>')[0]
      expect(earlier).toContain('an email noted last time')
    })

    const earlierBlock = () =>
      userText(lastCall()).split('<earlier_context>')[1].split('</earlier_context>')[0]

    it('cuts an earlier-context email to 2,000 characters without marking the note truncated', async () => {
      seedProject({ notes_through_at: '2026-11-19T11:00:00.000Z' })
      const text = bigText('alpha', 10_000)
      seedEmail('e1_p1', '2026-11-19T11:00:00.000Z', text)
      seedEmail('e2_p1', '2026-11-19T12:00:00.000Z', 'a brand new email here')
      mockMessagesCreate.mockResolvedValue(noteResponse(someNote))

      const res = await writeNoteForProject(db, 'p1')

      expect(block(earlierBlock(), 'typed')).toBe(`${text.slice(0, 2_000)}\n[cut here]`)
      expect(res).toMatchObject({ covered: 1, through: '2026-11-19T12:00:00.000Z' })
      expect(notes()[0]).toMatchObject({ email_ids: ['e2_p1'] })
      expect(notes()[0]).not.toHaveProperty('email_truncated')
    })

    it('shows an earlier-context email under the cap unchanged', async () => {
      seedProject({ notes_through_at: '2026-11-19T11:00:00.000Z' })
      const text = bigText('alpha', 1_500)
      seedEmail('e1_p1', '2026-11-19T11:00:00.000Z', text)
      seedEmail('e2_p1', '2026-11-19T12:00:00.000Z', 'a brand new email here')
      mockMessagesCreate.mockResolvedValue(noteResponse(someNote))

      await writeNoteForProject(db, 'p1')

      expect(block(earlierBlock(), 'typed')).toBe(text)
      expect(earlierBlock()).not.toContain('[cut here]')
    })

    it("recovers a maker email the app never received from a builder's quote, and shows it again when it arrives later", async () => {
      seedProject()
      seedSession('s1', '2026-11-19T00:00:00.000Z')
      seedEmail(
        'e1_p1',
        '2026-11-19T18:00:00.000Z',
        [
          'Thanks Bill, I will look into it.',
          '',
          'On Wed, Nov 19, 2026 at 9:00 AM Bill Duris <bill@example.com> wrote:',
          '> I want the gallery page to load fast on phones',
          '> and show prices in euros please',
        ].join('\n'),
        { from_email: 'nico@example.com', from_name: 'Nico', from_role: 'builder' }
      )
      mockMessagesCreate.mockResolvedValue(noteResponse(someNote))

      await writeNoteForProject(db, 'p1')

      const first = newMessagesBlock()
      expect(block(first, 'typed')).toBe('Thanks Bill, I will look into it.')
      const quoted = block(first, 'quoted_not_seen_before')
      expect(quoted).toContain('I want the gallery page to load fast on phones')
      expect(quoted).toContain('and show prices in euros please')

      // The maker's own copy arrives later (a Reply All they sent afterwards).
      // What a sender typed is never filtered line by line, and the earlier
      // email only quoted these lines, so it is shown again: a few repeated
      // tokens, never a lost answer (F2).
      seedEmail('e2_p1', '2026-11-19T19:00:00.000Z', 'I want the gallery page to load fast on phones\nand show prices in euros please')
      seedMessage('m1', 's1', '2026-11-19T20:00:00.000Z', 'hello again')
      const res = await writeNoteForProject(db, 'p1')

      expect(res.covered).toBe(2)
      const second = newMessagesBlock()
      expect(block(second, 'typed')).toBe('I want the gallery page to load fast on phones\nand show prices in euros please')
      expect(second).not.toContain('quoted_not_seen_before')
      expect(second).toContain('User: hello again')
      expect(notes()[1]).toMatchObject({ email_ids: ['e2_p1'] })
    })

    it('keeps a typed answer the maker gave before, above a builder question the app holds', async () => {
      const question = 'Should the week view start on Monday or on Sunday?'
      seedProject({ notes_through_at: '2026-11-19T11:30:00.000Z' })
      seedEmail('e1_p1', '2026-11-19T10:00:00.000Z', 'Yes, go ahead with that.')
      seedEmail('e2_p1', '2026-11-19T11:00:00.000Z', question, {
        from_email: 'nico@example.com',
        from_name: 'Nico',
        from_role: 'builder',
      })
      seedEmail(
        'e3_p1',
        '2026-11-19T12:00:00.000Z',
        `Yes, go ahead with that.\n\nOn Wed, Nov 19, 2026 at 11:00 AM Nico <nico@example.com> wrote:\n> ${question}`
      )
      mockMessagesCreate.mockResolvedValue(noteResponse(someNote))

      const res = await writeNoteForProject(db, 'p1')

      expect(res.covered).toBe(1)
      const nm = newMessagesBlock()
      expect(block(nm, 'typed')).toBe('Yes, go ahead with that.')
      expect(nm).not.toContain('quoted_not_seen_before')
      expect(notes()[0]).toMatchObject({ email_ids: ['e3_p1'] })
    })

    it('the same email sent twice by the same sender: the second is covered with no model call', async () => {
      const text = 'Please add a metronome to the practice page.\n\nThanks,\nBill'
      seedProject({ notes_through_at: '2026-11-19T10:00:00.000Z' })
      seedEmail('e1_p1', '2026-11-19T10:00:00.000Z', text)
      seedEmail('e2_p1', '2026-11-19T11:00:00.000Z', text)

      const res = await writeNoteForProject(db, 'p1')

      expect(mockMessagesCreate).not.toHaveBeenCalled()
      expect(res).toEqual({ note_id: null, covered: 1, through: '2026-11-19T11:00:00.000Z' })
      expect(coll('projects').get('p1')!.notes_through_at).toBe('2026-11-19T11:00:00.000Z')
    })

    it('the same text from a different sender is not a repeat', async () => {
      const text = 'Please add a metronome to the practice page.'
      seedProject({ notes_through_at: '2026-11-19T10:00:00.000Z' })
      seedEmail('e1_p1', '2026-11-19T10:00:00.000Z', text)
      seedEmail('e2_p1', '2026-11-19T11:00:00.000Z', text, {
        from_email: 'nico@example.com',
        from_name: 'Nico',
        from_role: 'builder',
      })
      mockMessagesCreate.mockResolvedValue(noteResponse(someNote))

      await writeNoteForProject(db, 'p1')

      expect(mockMessagesCreate).toHaveBeenCalledTimes(1)
      expect(block(newMessagesBlock(), 'typed')).toBe(text)
    })

    it('a window holding only a fully seen email makes no model call and advances notes_through_at', async () => {
      seedProject({ notes_through_at: '2026-11-19T17:00:00.000Z' })
      seedEmail('e1_p1', '2026-11-19T17:00:00.000Z', 'I want the gallery page to load fast on phones')
      seedEmail('e2_p1', '2026-11-19T18:00:00.000Z', '> I want the gallery page to load fast on phones')

      const res = await writeNoteForProject(db, 'p1')

      expect(mockMessagesCreate).not.toHaveBeenCalled()
      expect(res).toEqual({ note_id: null, covered: 1, through: '2026-11-19T18:00:00.000Z' })
      expect(coll('projects').get('p1')!.notes_through_at).toBe('2026-11-19T18:00:00.000Z')
      expect(notes()).toHaveLength(0)
      // The next run finds nothing new instead of calling again.
      await expect(writeNoteForProject(db, 'p1')).rejects.toThrow('write_note_no_messages')
      expect(mockMessagesCreate).not.toHaveBeenCalled()
    })

    it('three emails of 20,000 new characters: the first run covers two, the second the third', async () => {
      seedProject()
      const texts = ['alpha', 'bravo', 'charlie'].map((tag) => bigText(tag, 20_000))
      seedEmail('e1_p1', '2026-11-19T10:00:00.000Z', texts[0])
      seedEmail('e2_p1', '2026-11-19T11:00:00.000Z', texts[1])
      seedEmail('e3_p1', '2026-11-19T12:00:00.000Z', texts[2])
      mockMessagesCreate.mockResolvedValue(noteResponse(someNote))

      const first = await writeNoteForProject(db, 'p1')

      expect(first.covered).toBe(2)
      expect(first.through).toBe('2026-11-19T11:00:00.000Z')
      expect(coll('projects').get('p1')!.notes_through_at).toBe('2026-11-19T11:00:00.000Z')
      let nm = newMessagesBlock()
      expect(nm).toContain(texts[0])
      expect(nm).toContain(texts[1])
      expect(nm).not.toContain('charlie line')

      const second = await writeNoteForProject(db, 'p1')

      expect(second.covered).toBe(1)
      expect(second.through).toBe('2026-11-19T12:00:00.000Z')
      nm = newMessagesBlock()
      expect(nm).toContain(texts[2])
      expect(nm).not.toContain('alpha line')
      expect(nm).not.toContain('bravo line')
      expect(notes().map((n) => n.email_ids)).toEqual([['e1_p1', 'e2_p1'], ['e3_p1']])
      expect(mockMessagesCreate).toHaveBeenCalledTimes(2)
    })

    it('leaves a chat message after the stopping email for the next run', async () => {
      seedProject()
      seedSession('s1', '2026-11-19T00:00:00.000Z')
      seedEmail('e1_p1', '2026-11-19T10:00:00.000Z', bigText('alpha', 30_000))
      seedEmail('e2_p1', '2026-11-19T11:00:00.000Z', bigText('bravo', 30_000))
      seedMessage('m1', 's1', '2026-11-19T12:00:00.000Z', 'chat after the big emails')
      mockMessagesCreate.mockResolvedValue(noteResponse(someNote))

      const first = await writeNoteForProject(db, 'p1')

      expect(first.covered).toBe(1)
      expect(newMessagesBlock()).not.toContain('chat after the big emails')
      expect(notes()[0].session_id).toBeNull()
      const second = await writeNoteForProject(db, 'p1')
      expect(second.covered).toBe(2)
      expect(second.through).toBe('2026-11-19T12:00:00.000Z')
      expect(newMessagesBlock()).toContain('User: chat after the big emails')
    })

    it('one email of 60,000 new characters: the prompt holds 40,000 of it and [cut here]', async () => {
      seedProject()
      const text = bigText('alpha', 60_000)
      seedEmail('e1_p1', '2026-11-19T10:00:00.000Z', text)
      mockMessagesCreate.mockResolvedValue(noteResponse(someNote))

      const res = await writeNoteForProject(db, 'p1')

      expect(block(newMessagesBlock(), 'typed')).toBe(`${text.slice(0, 40_000)}\n[cut here]`)
      expect(res).toMatchObject({ covered: 1, through: '2026-11-19T10:00:00.000Z' })
      expect(notes()[0]).toMatchObject({ email_ids: ['e1_p1'], email_truncated: true })
    })

    it('an oversized email keeps its typed text whole and cuts the quoted part to the room left', async () => {
      seedProject()
      const typed = bigText('alpha', 30_000)
      const quoted = bigText('bravo', 30_000)
      const text = `${typed}\n\nOn Wed, Nov 19, 2026 at 9:00 AM Bill Duris <bill@example.com> wrote:\n${quoted
        .split('\n')
        .map((l) => `> ${l}`)
        .join('\n')}`
      seedEmail('e1_p1', '2026-11-19T10:00:00.000Z', text, { from_name: 'Nico', from_role: 'builder' })
      mockMessagesCreate.mockResolvedValue(noteResponse(someNote))

      await writeNoteForProject(db, 'p1')

      const nm = newMessagesBlock()
      expect(block(nm, 'typed')).toBe(typed)
      const keptQuote = block(nm, 'quoted_not_seen_before')
      expect(keptQuote.endsWith('\n[cut here]')).toBe(true)
      expect(keptQuote.length - '\n[cut here]'.length).toBe(10_000)
      expect(notes()[0].email_truncated).toBe(true)
    })

    it('an email-only window drops the lock_reversals the model returned', async () => {
      seedProject()
      seedBrief(
        { ...emptyBrief, decisions: [{ topic: 'Payment', decision: 'Stripe only', locked: true }] },
        '2026-09-01T00:00:00Z'
      )
      seedEmail('e1_p1', '2026-11-19T10:00:00.000Z', 'Yes, I confirm: use Square instead of Stripe')
      mockMessagesCreate.mockResolvedValue(
        noteResponse({
          ...someNote,
          lock_reversals: [{ topic: 'Payment', proposed: 'Square', reason: 'Maker confirmed by email' }],
        })
      )

      await writeNoteForProject(db, 'p1')

      expect(notes()).toHaveLength(1)
      expect(notes()[0].lock_reversals).toEqual([])
      const brief = coll('briefs').get('b1')!
      expect(brief.version).toBe(3)
      expect(brief.source).toBe('paste')
      expect((brief.content as { decisions: Data[] }).decisions[0].contested).toBeUndefined()
      expect(coll('briefs/b1/versions').size).toBe(0)
    })

    it('a window with only a builder chat turn and an email drops lock_reversals too', async () => {
      seedProject()
      seedSession('s1', '2026-11-19T00:00:00.000Z')
      coll('project_members').set('mem1', { project_id: 'p1', email: 'nico@example.com', role: 'owner' })
      coll('messages').set('m1', {
        session_id: 's1',
        created_at: '2026-11-19T09:00:00.000Z',
        content: 'builder guidance',
        role: 'user',
        sender_email: 'nico@example.com',
      })
      seedEmail('e1_p1', '2026-11-19T10:00:00.000Z', 'Yes, I confirm: use Square instead of Stripe')
      mockMessagesCreate.mockResolvedValue(
        noteResponse({
          ...someNote,
          lock_reversals: [{ topic: 'Payment', proposed: 'Square', reason: 'confirmed' }],
        })
      )

      await writeNoteForProject(db, 'p1')

      expect(notes()[0].lock_reversals).toEqual([])
    })

    it('a window with a maker chat turn still saves lock_reversals and contests the decision', async () => {
      seedProject()
      seedBrief(
        { ...emptyBrief, decisions: [{ topic: 'Payment', decision: 'Stripe only', locked: true }] },
        '2026-09-01T00:00:00Z'
      )
      seedSession('s1', '2026-10-01T00:00:00Z')
      seedEmail('e1_p1', '2026-10-01T00:00:00.500Z', 'Thinking about payments again today')
      seedMessage('m1', 's1', '2026-10-01T00:00:01Z', 'Yes, I confirm: use Square instead')
      mockMessagesCreate.mockResolvedValue(
        noteResponse({
          ...someNote,
          lock_reversals: [{ topic: 'Payment', proposed: 'Square', reason: 'Maker confirmed Oct 1' }],
        })
      )

      await writeNoteForProject(db, 'p1')

      expect(notes()[0].lock_reversals).toEqual([
        { topic: 'Payment', proposed: 'Square', reason: 'Maker confirmed Oct 1' },
      ])
      const brief = coll('briefs').get('b1')!
      expect(brief.source).toBe('note')
      expect((brief.content as { decisions: Data[] }).decisions[0].contested).toEqual({
        proposed: 'Square',
        reason: 'Maker confirmed Oct 1',
      })
    })

    it('throws write_note_no_messages when every email is already covered', async () => {
      seedProject({ notes_through_at: '2026-11-19T12:00:00.000Z' })
      seedEmail('e1_p1', '2026-11-19T11:00:00.000Z', 'an email noted last time')

      await expect(writeNoteForProject(db, 'p1')).rejects.toThrow('write_note_no_messages')
      expect(mockMessagesCreate).not.toHaveBeenCalled()
    })

    it('throws write_note_no_messages for a project with no messages and no emails', async () => {
      seedProject()

      await expect(writeNoteForProject(db, 'p1')).rejects.toThrow('write_note_no_messages')
      expect(mockMessagesCreate).not.toHaveBeenCalled()
    })

    it('leaves the email fields off a note that covered no email', async () => {
      seedProject()
      seedSession('s1', '2026-10-01T00:00:00Z')
      seedMessage('m1', 's1', '2026-10-01T00:00:01Z', 'hello')
      mockMessagesCreate.mockResolvedValue(noteResponse(someNote))

      await writeNoteForProject(db, 'p1')

      expect(notes()[0]).not.toHaveProperty('email_ids')
      expect(notes()[0]).not.toHaveProperty('email_sources')
      expect(notes()[0]).not.toHaveProperty('email_truncated')
    })
  })
})
