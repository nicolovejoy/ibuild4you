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
})
