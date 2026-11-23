import { describe, it, expect, vi, beforeEach } from 'vitest'
import { EMAIL_CONTEXT_CHAR_LIMIT, EMAIL_WINDOW_CHAR_LIMIT } from '@/lib/agent/constants'
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

  // #276: the model says "nothing relevant" with nothing_new. Code may drop a
  // text-only note on that flag, never a note that carries a decision or a risk.
  describe('nothing_new (#276)', () => {
    const nothingNew = {
      text: 'Nothing relevant to the brief was said.',
      nothing_new: true,
      decisions: [],
      risks_added: [],
      risks_resolved: [],
      lock_reversals: [],
    }

    it('nothing_new with only text writes no note and advances notes_through_at', async () => {
      seedProject()
      seedBrief(emptyBrief, '2026-09-01T00:00:00Z')
      seedSession('s1', '2026-10-01T00:00:00Z')
      seedMessage('m1', 's1', '2026-10-01T00:00:01Z', 'ok thanks')
      mockMessagesCreate.mockResolvedValue(noteResponse(nothingNew))

      const res = await writeNoteForProject(db, 'p1')

      expect(res.note_id).toBeNull()
      expect(notes()).toHaveLength(0)
      expect(coll('projects').get('p1')!.notes_through_at).toBe('2026-10-01T00:00:01Z')
    })

    it('nothing_new is ignored when the model also returned a decision', async () => {
      seedProject()
      seedBrief(emptyBrief, '2026-09-01T00:00:00Z')
      seedSession('s1', '2026-10-01T00:00:00Z')
      seedMessage('m1', 's1', '2026-10-01T00:00:01Z', 'pickup only')
      mockMessagesCreate.mockResolvedValue(noteResponse({ ...someNote, nothing_new: true }))

      await writeNoteForProject(db, 'p1')

      expect(notes()).toHaveLength(1)
      expect(notes()[0].text).toBe(someNote.text)
      expect(notes()[0].decisions).toEqual(someNote.decisions)
    })

    it.each([
      ['a risk added', { risks_added: [{ text: 'Opening hours unknown', owner: 'maker' }] }],
      ['a risk settled', { risks_resolved: [{ text: 'Hosting', resolution: 'Vercel' }] }],
      ['a decision', { decisions: [{ topic: 'Delivery', decision: 'Pickup only' }] }],
    ])('nothing_new is ignored when the model returned %s: the text is kept', async (_n, extra) => {
      seedProject()
      seedBrief(emptyBrief, '2026-09-01T00:00:00Z')
      seedSession('s1', '2026-10-01T00:00:00Z')
      seedMessage('m1', 's1', '2026-10-01T00:00:01Z', 'something')
      mockMessagesCreate.mockResolvedValue(noteResponse({ ...nothingNew, ...extra }))

      await writeNoteForProject(db, 'p1')

      expect(notes()).toHaveLength(1)
      expect(notes()[0].text).toBe(nothingNew.text)
    })

    it('nothing_new is ignored when the model returned a lock reversal the maker confirmed', async () => {
      seedProject()
      seedBrief(
        { ...emptyBrief, decisions: [{ topic: 'Payment', decision: 'Stripe only', locked: true }] },
        '2026-09-01T00:00:00Z'
      )
      seedSession('s1', '2026-10-01T00:00:00Z')
      seedMessage('m1', 's1', '2026-10-01T00:00:01Z', 'switch to PayPal, I am sure')
      mockMessagesCreate.mockResolvedValue(
        noteResponse({
          ...nothingNew,
          lock_reversals: [{ topic: 'Payment', proposed: 'PayPal', reason: 'maker confirmed' }],
        })
      )

      await writeNoteForProject(db, 'p1')

      expect(notes()).toHaveLength(1)
      expect(notes()[0].text).toBe(nothingNew.text)
      expect(notes()[0].lock_reversals).toHaveLength(1)
    })

    // Only the boolean true may drop text. A string or null is not the flag.
    it.each([
      ['the string "true"', 'true'],
      ['null', null],
    ])('nothing_new as %s is not the flag: a text-only note is kept whole', async (_n, flag) => {
      seedProject()
      seedBrief(emptyBrief, '2026-09-01T00:00:00Z')
      seedSession('s1', '2026-10-01T00:00:00Z')
      seedMessage('m1', 's1', '2026-10-01T00:00:01Z', 'ok thanks')
      mockMessagesCreate.mockResolvedValue(noteResponse({ ...nothingNew, nothing_new: flag }))

      await writeNoteForProject(db, 'p1')

      expect(notes()).toHaveLength(1)
      expect(notes()[0].text).toBe(nothingNew.text)
    })

    // A lock reversal from a window with no maker chat turn is cleared, so it
    // must not count as structured content that protects the text.
    it('nothing_new drops the text when the only lock reversal is cleared (email-only window)', async () => {
      const log = vi.spyOn(console, 'log').mockImplementation(() => {})
      seedProject()
      seedBrief(
        { ...emptyBrief, decisions: [{ topic: 'Payment', decision: 'Stripe only', locked: true }] },
        '2026-09-01T00:00:00Z'
      )
      // seedEmail lives in the emails block below, so the email is set inline.
      coll('project_emails').set('e1_p1', {
        project_id: 'p1',
        from_email: 'bill@example.com',
        from_name: 'Bill Duris',
        from_role: 'maker',
        received_at: '2026-11-19T17:00:00.000Z',
        sent_at: null,
        subject: 'Re: the shop',
        message_id: '<e1_p1@mail>',
        text: 'just saying hello',
        truncated: false,
        attachments: [],
      })
      mockMessagesCreate.mockResolvedValue(
        noteResponse({
          ...nothingNew,
          lock_reversals: [{ topic: 'Payment', proposed: 'PayPal', reason: 'an email said so' }],
        })
      )

      const res = await writeNoteForProject(db, 'p1')

      expect(res.note_id).toBeNull()
      expect(notes()).toHaveLength(0)
      expect(coll('projects').get('p1')!.notes_through_at).toBe('2026-11-19T17:00:00.000Z')
      const events = log.mock.calls
        .map((c) => {
          try {
            return JSON.parse(String(c[0]))
          } catch {
            return null
          }
        })
        .filter((e) => e && e.event === 'brief.note_empty')
      expect(events).toHaveLength(1)
      log.mockRestore()
    })

    it('nothing_new keeps a note that carries a 👎, with empty text', async () => {
      seedProject()
      seedSession('s1', '2026-10-01T00:00:00Z')
      coll('messages').set('m1', {
        session_id: 's1', created_at: '2026-10-01T00:00:01Z', role: 'agent', content: 'Hmm', rating: 'down',
      })
      mockMessagesCreate.mockResolvedValue(noteResponse(nothingNew))

      const res = await writeNoteForProject(db, 'p1')

      expect(res.note_id).toBeTruthy()
      expect(notes()).toHaveLength(1)
      expect(notes()[0].text).toBe('')
      expect(notes()[0].thumbs_down).toEqual([{ excerpt: 'Hmm' }])
    })

    it('asks the model for nothing_new, as a required boolean', async () => {
      seedProject({ notes_through_at: '2026-10-28T10:00:00.000Z' })
      seedSession('s1', '2026-10-28T09:00:00.000Z')
      seedMessage('m1', 's1', '2026-10-28T11:00:00.000Z', 'hello')
      mockMessagesCreate.mockResolvedValue(noteResponse(someNote))
      await writeNoteForProject(db, 'p1')
      const schema = (lastCall().tools[0] as unknown as {
        input_schema: { properties: Record<string, unknown>; required: string[] }
      }).input_schema
      expect(schema.properties.nothing_new).toEqual({ type: 'boolean' })
      expect(schema.required).toContain('nothing_new')
    })

    it('never stores nothing_new on a note', async () => {
      seedProject()
      seedBrief(emptyBrief, '2026-09-01T00:00:00Z')
      seedSession('s1', '2026-10-01T00:00:00Z')
      seedMessage('m1', 's1', '2026-10-01T00:00:01Z', 'pickup only')
      mockMessagesCreate.mockResolvedValue(noteResponse({ ...someNote, nothing_new: false }))
      await writeNoteForProject(db, 'p1')
      expect(notes()[0]).not.toHaveProperty('nothing_new')
    })

    it('an empty run logs brief.note_empty and the next run reads nothing', async () => {
      const log = vi.spyOn(console, 'log').mockImplementation(() => {})
      seedProject()
      seedBrief(emptyBrief, '2026-09-01T00:00:00Z')
      seedSession('s1', '2026-10-01T00:00:00Z')
      seedMessage('m1', 's1', '2026-10-01T00:00:01Z', 'ok thanks')
      mockMessagesCreate.mockResolvedValue(noteResponse(nothingNew))

      await writeNoteForProject(db, 'p1')

      const events = log.mock.calls
        .map((c) => {
          try {
            return JSON.parse(String(c[0]))
          } catch {
            return null
          }
        })
        .filter((e) => e && e.event === 'brief.note_empty')
      expect(events).toEqual([{ event: 'brief.note_empty', project_id: 'p1', covered: 1 }])

      // The cursor moved, so the same stretch is not read again.
      await expect(writeNoteForProject(db, 'p1')).rejects.toThrow('write_note_no_messages')
      expect(mockMessagesCreate).toHaveBeenCalledTimes(1)
      log.mockRestore()
    })
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
    // The first quote in `text`: its written_by and what is between its tags.
    const quoted = (text: string) => {
      const m = text.match(/<quoted written_by="([^"]*)">\n([\s\S]*?)\n<\/quoted>/)
      return m ? { by: m[1], body: m[2] } : null
    }
    // The line text a turn carries: typed plus every quote line, without the
    // header lines, the run tags or the cut mark (what the cut limits).
    const carriedText = (turn: string, headers: string[]) => {
      let size = turn.includes('<typed>\n') ? block(turn, 'typed').length : 0
      for (const m of turn.matchAll(/<quoted written_by="[^"]*">\n([\s\S]*?)\n<\/quoted>/g)) {
        for (const line of m[1].split('\n')) {
          if (headers.includes(line) || line === '[cut here]') continue
          if (/^<\/?(already_recorded|written_inside)/.test(line)) continue
          size += line.length
        }
      }
      return size
    }

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

    // F3: minting an address on a project with no brief and no note sets
    // notes_through_at to the epoch. Chat from before the mint is still read,
    // and a brief created after an email does not move the start past it.
    it('an epoch notes_through_at (minted with no brief) still covers chat sent before the mint', async () => {
      seedProject({ notes_through_at: '1970-01-01T00:00:00.000Z' })
      seedSession('s1', '2026-11-19T00:00:00.000Z')
      seedMessage('m1', 's1', '2026-11-19T10:00:00.000Z', 'chat before the address existed')
      seedEmail('e1_p1', '2026-11-19T11:00:00.000Z', 'an email after the mint')
      // A paste made after both creates the brief.
      seedBrief(emptyBrief, '2026-11-19T12:00:00.000Z')
      mockMessagesCreate.mockResolvedValue(noteResponse(someNote))

      const res = await writeNoteForProject(db, 'p1')

      expect(res).toMatchObject({ covered: 2, through: '2026-11-19T11:00:00.000Z' })
      const nm = newMessagesBlock()
      expect(nm).toContain('User: chat before the address existed')
      expect(nm).toContain('an email after the mint')
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
      const quote = quoted(first)!
      expect(quote.body).toContain('I want the gallery page to load fast on phones')
      expect(quote.body).toContain('and show prices in euros please')

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
      expect(second).not.toContain('<quoted')
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
      expect(nm).not.toContain('<quoted')
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

    // N1: a short new line ("Actually no") is new words, so the second reply
    // to the same quoted email is not a repeat of the first.
    it('shows a second reply whose only new words are short, above the same quote', async () => {
      const question = 'Should the week view start on Monday or on Sunday?'
      const quote = `On Wed, Nov 19, 2026 at 11:00 AM Nico <nico@example.com> wrote:\n> ${question}`
      seedProject({ notes_through_at: '2026-11-19T12:00:00.000Z' })
      seedEmail('e1_p1', '2026-11-19T11:00:00.000Z', question, {
        from_email: 'nico@example.com',
        from_name: 'Nico',
        from_role: 'builder',
      })
      seedEmail('e2_p1', '2026-11-19T12:00:00.000Z', `Yes\n\n${quote}`)
      seedEmail('e3_p1', '2026-11-19T13:00:00.000Z', `Actually no\n\n${quote}`)
      mockMessagesCreate.mockResolvedValue(noteResponse(someNote))

      const res = await writeNoteForProject(db, 'p1')

      expect(mockMessagesCreate).toHaveBeenCalledTimes(1)
      expect(res).toMatchObject({ covered: 1, through: '2026-11-19T13:00:00.000Z' })
      const nm = newMessagesBlock()
      expect(block(nm, 'typed')).toBe('Actually no')
      expect(nm).not.toContain('<quoted')
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

    // F6: notes_through_at is the last covered item's timestamp, and the next
    // run reads only items after it, so a window that ended between two items
    // stamped alike would skip the second for good.
    it('never ends a window between two emails with the same timestamp', async () => {
      seedProject()
      seedEmail('e1_p1', '2026-11-19T10:00:00.000Z', bigText('alpha', 20_000))
      seedEmail('e2_p1', '2026-11-19T11:00:00.000Z', bigText('bravo', 15_000))
      seedEmail('e3_p1', '2026-11-19T11:00:00.000Z', bigText('charlie', 15_000))
      mockMessagesCreate.mockResolvedValue(noteResponse(someNote))

      const first = await writeNoteForProject(db, 'p1')
      // The limit falls between e2 and e3: both wait for the next run.
      expect(first).toMatchObject({ covered: 1, through: '2026-11-19T10:00:00.000Z' })

      const second = await writeNoteForProject(db, 'p1')
      expect(second).toMatchObject({ covered: 2, through: '2026-11-19T11:00:00.000Z' })
      expect(notes().map((n) => n.email_ids)).toEqual([['e1_p1'], ['e2_p1', 'e3_p1']])
    })

    it('takes a whole run of same-timestamp emails when cutting it would leave the window empty', async () => {
      seedProject()
      const texts = [bigText('alpha', 30_000), bigText('bravo', 30_000)]
      seedEmail('e1_p1', '2026-11-19T10:00:00.000Z', texts[0])
      seedEmail('e2_p1', '2026-11-19T10:00:00.000Z', texts[1])
      mockMessagesCreate.mockResolvedValue(noteResponse(someNote))

      const res = await writeNoteForProject(db, 'p1')

      expect(res).toMatchObject({ covered: 2, through: '2026-11-19T10:00:00.000Z' })
      const nm = newMessagesBlock()
      expect(nm).toContain(texts[0])
      expect(nm).toContain(texts[1])
      expect(notes()[0].email_ids).toEqual(['e1_p1', 'e2_p1'])
      await expect(writeNoteForProject(db, 'p1')).rejects.toThrow('write_note_no_messages')
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
      const quotedText = bigText('bravo', 30_000)
      const header = 'On Wed, Nov 19, 2026 at 9:00 AM Bill Duris <bill@example.com> wrote:'
      const text = `${typed}\n\n${header}\n${quotedText
        .split('\n')
        .map((l) => `> ${l}`)
        .join('\n')}`
      seedEmail('e1_p1', '2026-11-19T10:00:00.000Z', text, { from_name: 'Nico', from_role: 'builder' })
      mockMessagesCreate.mockResolvedValue(noteResponse(someNote))

      await writeNoteForProject(db, 'p1')

      const nm = newMessagesBlock()
      expect(block(nm, 'typed')).toBe(typed)
      const keptQuote = quoted(nm)!.body
      expect(keptQuote.endsWith('\n[cut here]')).toBe(true)
      // The quote's lines get the 10,000 characters left (line text only).
      expect(carriedText(nm, [header]) - typed.length).toBe(10_000)
      expect(notes()[0].email_truncated).toBe(true)
    })

    // #282: who wrote a quote is decided by code (lib/email-in/reading.ts) and
    // reaches the model as written_by, never as a header for it to read.
    describe('credited quotes', () => {
      const NICO = { from_email: 'nico@example.com', from_name: 'Nico L', from_role: 'builder' as const }
      const TEST_M = { from_email: 'tm@yahoo.com', from_name: 'Test M', from_role: 'maker' as const }
      const TM_HEADER = 'On Nov 22, 2026, at 10:40 AM, Test M <tm@yahoo.com> wrote:'
      const NICO_HEADER = 'On Nov 22, 2026, at 10:40 AM, Nico L <nico@example.com> wrote:'
      const quoteLines = (text: string) => text.split('\n').map((l) => `> ${l}`)
      // The maker has never signed in: their name comes from the project's
      // requester fields, as the inbound check reads it.
      function seedMembers() {
        coll('project_members').set('mem1', { project_id: 'p1', email: 'tm@yahoo.com', role: 'maker' })
        coll('project_members').set('mem2', { project_id: 'p1', email: 'nico@example.com', role: 'owner' })
      }
      const requester = { requester_email: 'TM@Yahoo.com', requester_first_name: 'Test', requester_last_name: 'Mason' }

      it("credits the maker's words quoted in a builder's email to the maker (smoke step 4)", async () => {
        seedProject(requester)
        seedMembers()
        seedEmail(
          'e1_p1',
          '2026-11-22T18:45:00.000Z',
          [
            'Thanks, adding the project address.',
            '',
            TM_HEADER,
            '> I would like the start button to be green.',
            '> Payment should be by card only, please.',
          ].join('\n'),
          NICO
        )
        mockMessagesCreate.mockResolvedValue(noteResponse(someNote))

        await writeNoteForProject(db, 'p1')

        expect(newMessagesBlock()).toContain(
          [
            'Email from Builder (Nico L), received 2026-11-22:',
            '<typed>',
            'Thanks, adding the project address.',
            '</typed>',
            '<quoted written_by="Maker (Test M)">',
            TM_HEADER,
            'I would like the start button to be green.',
            'Payment should be by card only, please.',
            '</quoted>',
          ].join('\n')
        )
      })

      it('covers with no model call an email that typed nothing and quotes only lines the app holds', async () => {
        const questions = 'What colour should the start button be?\nShould payment be by card or by invoice?'
        seedProject({ ...requester, notes_through_at: '2026-11-22T18:00:00.000Z' })
        seedMembers()
        seedEmail('e1_p1', '2026-11-22T18:00:00.000Z', questions, NICO)
        seedEmail('e2_p1', '2026-11-22T18:30:00.000Z', [NICO_HEADER, ...quoteLines(questions)].join('\n'), TEST_M)

        const res = await writeNoteForProject(db, 'p1')

        expect(mockMessagesCreate).not.toHaveBeenCalled()
        expect(res).toEqual({ note_id: null, covered: 1, through: '2026-11-22T18:30:00.000Z' })
        expect(coll('projects').get('p1')!.notes_through_at).toBe('2026-11-22T18:30:00.000Z')
      })

      // Review Focus 4: a quote's context lines count toward the limit like its
      // new lines, and the cut falls inside the line that passes it.
      it('cuts an over-long quote at the line that passes the window limit, context counted, and marks the note truncated', async () => {
        const held = bigText('alpha', 20_000)
        const fresh = bigText('bravo', 30_000)
        seedProject({ notes_through_at: '2026-11-19T10:00:00.000Z' })
        seedEmail('e1_p1', '2026-11-19T10:00:00.000Z', held, NICO)
        seedEmail(
          'e2_p1',
          '2026-11-19T11:00:00.000Z',
          ['Short reply.', '', NICO_HEADER, ...quoteLines(held), ...quoteLines(fresh)].join('\n'),
          TEST_M
        )
        mockMessagesCreate.mockResolvedValue(noteResponse(someNote))

        const res = await writeNoteForProject(db, 'p1')

        const nm = newMessagesBlock()
        expect(block(nm, 'typed')).toBe('Short reply.')
        const quote = quoted(nm)!
        expect(quote.body.startsWith(`${NICO_HEADER}\n<already_recorded>\nalpha line 0 `)).toBe(true)
        expect(quote.body.endsWith('\n[cut here]')).toBe(true)
        expect(carriedText(nm, [NICO_HEADER])).toBe(EMAIL_WINDOW_CHAR_LIMIT)
        // The bravo lines after the cut are gone.
        expect(nm).not.toContain(fresh.split('\n').at(-1))
        expect(res).toMatchObject({ covered: 1, through: '2026-11-19T11:00:00.000Z' })
        expect(notes()[0]).toMatchObject({ email_ids: ['e2_p1'], email_truncated: true })
      })

      it('cuts an earlier-context email with a long quote to the context limit the same way', async () => {
        const fresh = bigText('bravo', 10_000)
        seedProject({ notes_through_at: '2026-11-19T11:00:00.000Z' })
        seedEmail('e1_p1', '2026-11-19T11:00:00.000Z', ['Short reply.', '', NICO_HEADER, ...quoteLines(fresh)].join('\n'), TEST_M)
        seedEmail('e2_p1', '2026-11-19T12:00:00.000Z', 'a brand new email here')
        mockMessagesCreate.mockResolvedValue(noteResponse(someNote))

        await writeNoteForProject(db, 'p1')

        const earlier = earlierBlock()
        expect(block(earlier, 'typed')).toBe('Short reply.')
        expect(quoted(earlier)!.body.endsWith('\n[cut here]')).toBe(true)
        expect(carriedText(earlier, [NICO_HEADER])).toBe(EMAIL_CONTEXT_CHAR_LIMIT)
        expect(notes()[0]).not.toHaveProperty('email_truncated')
      })

      // A quote none of whose lines fit is dropped whole: it is never shown as
      // a credited header with nothing under it. The mark ends what was kept.
      it('drops a quote when the typed text fills the limit exactly, and marks the typed text', async () => {
        const typed = bigText('alpha', EMAIL_CONTEXT_CHAR_LIMIT)
        seedProject({ notes_through_at: '2026-11-19T11:00:00.000Z' })
        seedEmail('e1_p1', '2026-11-19T11:00:00.000Z', [typed, '', NICO_HEADER, '> A quoted line nobody has seen yet'].join('\n'), TEST_M)
        seedEmail('e2_p1', '2026-11-19T12:00:00.000Z', 'a brand new email here')
        mockMessagesCreate.mockResolvedValue(noteResponse(someNote))

        await writeNoteForProject(db, 'p1')

        const earlier = earlierBlock()
        expect(block(earlier, 'typed')).toBe(`${typed}\n[cut here]`)
        expect(earlier).not.toContain('<quoted')
      })

      it('ends the first quote with the mark when it fills the limit exactly, and drops the second', async () => {
        const typed = 'Short reply.'
        // 18 lines of 100 and one of 188: 1,988 characters, so typed and the
        // first quote hold exactly EMAIL_CONTEXT_CHAR_LIMIT.
        const first = [
          ...Array.from({ length: 18 }, (_, i) => `bravo line ${i} `.padEnd(100, 'x')),
          'bravo last line '.padEnd(188, 'y'),
        ]
        expect(typed.length + first.join('').length).toBe(EMAIL_CONTEXT_CHAR_LIMIT)
        seedProject({ notes_through_at: '2026-11-19T11:00:00.000Z' })
        seedEmail(
          'e1_p1',
          '2026-11-19T11:00:00.000Z',
          [typed, '', NICO_HEADER, ...quoteLines(first.join('\n')), '', TM_HEADER, '> A charlie line nobody has seen yet'].join('\n'),
          TEST_M
        )
        seedEmail('e2_p1', '2026-11-19T12:00:00.000Z', 'a brand new email here')
        mockMessagesCreate.mockResolvedValue(noteResponse(someNote))

        await writeNoteForProject(db, 'p1')

        const earlier = earlierBlock()
        expect(block(earlier, 'typed')).toBe(typed)
        expect(earlier.match(/<quoted /g)).toHaveLength(1)
        expect(quoted(earlier)!.body).toBe([NICO_HEADER, ...first, '[cut here]'].join('\n'))
        expect(earlier).not.toContain('charlie')
        expect(earlier).not.toContain(TM_HEADER)
      })

      it('drops the quotes of an email whose typed text alone passes the limit', async () => {
        const typed = bigText('alpha', 3_000)
        seedProject({ notes_through_at: '2026-11-19T11:00:00.000Z' })
        seedEmail('e1_p1', '2026-11-19T11:00:00.000Z', [typed, '', NICO_HEADER, '> A quoted line nobody has seen yet'].join('\n'), TEST_M)
        seedEmail('e2_p1', '2026-11-19T12:00:00.000Z', 'a brand new email here')
        mockMessagesCreate.mockResolvedValue(noteResponse(someNote))

        await writeNoteForProject(db, 'p1')

        const earlier = earlierBlock()
        expect(block(earlier, 'typed')).toBe(`${typed.slice(0, EMAIL_CONTEXT_CHAR_LIMIT)}\n[cut here]`)
        expect(earlier).not.toContain('<quoted')
      })
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

    it('stamps made_from email on a note from emails only', async () => {
      seedProject()
      seedEmail('e1_p1', '2026-11-19T17:00:00.000Z', 'I want the gallery page to load fast')
      mockMessagesCreate.mockResolvedValue(noteResponse(someNote))

      await writeNoteForProject(db, 'p1')

      expect(notes()[0].made_from).toBe('email')
    })

    it('stamps made_from both on a note from chat and email', async () => {
      seedProject()
      seedSession('s1', '2026-11-19T00:00:00.000Z')
      seedMessage('m1', 's1', '2026-11-19T10:00:00.000Z', 'chat one')
      seedEmail('e1_p1', '2026-11-19T11:00:00.000Z', 'email after the chat')
      mockMessagesCreate.mockResolvedValue(noteResponse(someNote))

      await writeNoteForProject(db, 'p1')

      expect(notes()[0].made_from).toBe('both')
    })

    it('stamps made_from chat on a note from chat only', async () => {
      seedProject()
      seedSession('s1', '2026-10-01T00:00:00Z')
      seedMessage('m1', 's1', '2026-10-01T00:00:01Z', 'hello')
      mockMessagesCreate.mockResolvedValue(noteResponse(someNote))

      await writeNoteForProject(db, 'p1')

      expect(notes()[0].made_from).toBe('chat')
    })

    it('stamps made_from both when the chat sits in an archived session', async () => {
      seedProject()
      seedSession('s1', '2026-11-19T00:00:00.000Z', { status: 'archived' })
      seedMessage('m1', 's1', '2026-11-19T10:00:00.000Z', 'chat in a closed conversation')
      seedEmail('e1_p1', '2026-11-19T11:00:00.000Z', 'email after the chat')
      mockMessagesCreate.mockResolvedValue(noteResponse(someNote))

      await writeNoteForProject(db, 'p1')

      // session_id is null here, so made_from cannot lean on it.
      expect(notes()[0].session_id).toBeNull()
      expect(notes()[0].made_from).toBe('both')
    })

    it('counts a chat message from the agent as conversation', async () => {
      seedProject()
      seedSession('s1', '2026-11-19T00:00:00.000Z')
      seedMessage('m1', 's1', '2026-11-19T10:00:00.000Z', 'a greeting from Sam', 'agent')
      seedEmail('e1_p1', '2026-11-19T11:00:00.000Z', 'email after the greeting')
      mockMessagesCreate.mockResolvedValue(noteResponse(someNote))

      await writeNoteForProject(db, 'p1')

      expect(notes()[0].made_from).toBe('both')
    })

    it('an email with nothing new left does not count as email', async () => {
      const text = 'Please add a metronome to the practice page.\n\nThanks,\nBill'
      seedProject({ notes_through_at: '2026-11-19T10:00:00.000Z' })
      seedSession('s1', '2026-11-19T00:00:00.000Z')
      seedEmail('e1_p1', '2026-11-19T10:00:00.000Z', text)
      // The same words again: seen in full, so no text is left to read.
      seedEmail('e2_p1', '2026-11-19T11:00:00.000Z', text)
      seedMessage('m1', 's1', '2026-11-19T12:00:00.000Z', 'a chat message after it')
      mockMessagesCreate.mockResolvedValue(noteResponse(someNote))

      await writeNoteForProject(db, 'p1')

      expect(notes()[0].made_from).toBe('chat')
      expect(notes()[0].email_sources).toEqual([])
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
