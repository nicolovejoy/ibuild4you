import { describe, it, expect } from 'vitest'
import type { Firestore } from 'firebase-admin/firestore'
import {
  listNotes,
  listUnfoldedNotes,
  addNote,
  foldNotes,
  isEmptyNote,
  parsePrepStamp,
} from '../brief-notes'

// In-memory stand-in for briefs/{id}/notes: orderBy('created_at','asc').get(),
// add(), doc(id).update(), doc(id).get().
function makeDb() {
  const store = new Map<string, Record<string, unknown>>()
  let n = 0
  const notes = {
    orderBy: (field: string) => ({
      get: async () => ({
        docs: [...store.entries()]
          .sort((a, b) => String(a[1][field]).localeCompare(String(b[1][field])))
          .map(([id, data]) => ({ id, data: () => data })),
      }),
    }),
    add: async (data: Record<string, unknown>) => {
      const id = `n${++n}`
      store.set(id, data)
      return { id }
    },
    doc: (id: string) => ({
      get: async () => ({ id, exists: store.has(id), data: () => store.get(id) }),
      update: async (patch: Record<string, unknown>) => {
        if (!store.has(id)) throw new Error('NOT_FOUND')
        store.set(id, { ...store.get(id), ...patch })
      },
    }),
  }
  const db = {
    collection: (name: string) => {
      if (name !== 'briefs') throw new Error(`unexpected collection ${name}`)
      return { doc: () => ({ collection: () => notes }) }
    },
  }
  return db as unknown as Firestore
}

const note = (created_at: string, over: Record<string, unknown> = {}) => ({
  session_id: 's1',
  created_at,
  folded_at: null,
  text: 'Talked about payments.',
  decisions: [],
  risks_added: [],
  risks_resolved: [],
  lock_reversals: [],
  ...over,
})

describe('brief notes store', () => {
  it('listUnfoldedNotes returns only notes with folded_at null, oldest first', async () => {
    const db = makeDb()
    await addNote(db, 'b1', note('2026-10-02T00:00:00Z'))
    await addNote(db, 'b1', note('2026-10-01T00:00:00Z'))
    await addNote(db, 'b1', note('2026-10-03T00:00:00Z', { folded_at: '2026-10-04T00:00:00Z' }))
    const out = await listUnfoldedNotes(db, 'b1')
    expect(out.map((x) => x.created_at)).toEqual(['2026-10-01T00:00:00Z', '2026-10-02T00:00:00Z'])
    expect(await listNotes(db, 'b1')).toHaveLength(3)
  })

  it('foldNotes sets folded_at on listed unfolded ids and ignores unknown ids', async () => {
    const db = makeDb()
    const a = await addNote(db, 'b1', note('2026-10-01T00:00:00Z'))
    const b = await addNote(db, 'b1', note('2026-10-02T00:00:00Z'))
    await foldNotes(db, 'b1', [a, 'nope'], '2026-10-05T00:00:00Z')
    const all = await listNotes(db, 'b1')
    expect(all.find((x) => x.id === a)?.folded_at).toBe('2026-10-05T00:00:00Z')
    expect(all.find((x) => x.id === b)?.folded_at).toBeNull()
  })

  it("foldNotes leaves an already-folded note's folded_at unchanged", async () => {
    const db = makeDb()
    const a = await addNote(db, 'b1', note('2026-10-01T00:00:00Z', { folded_at: '2026-10-02T00:00:00Z' }))
    await foldNotes(db, 'b1', [a], '2026-10-09T00:00:00Z')
    expect((await listNotes(db, 'b1'))[0].folded_at).toBe('2026-10-02T00:00:00Z')
  })
})

describe('isEmptyNote', () => {
  const empty = { text: '  ', decisions: [], risks_added: [], risks_resolved: [], lock_reversals: [] }
  it('is true for blank text and empty arrays, false when any field has content', () => {
    expect(isEmptyNote(empty)).toBe(true)
    expect(isEmptyNote({ ...empty, text: 'x' })).toBe(false)
    expect(isEmptyNote({ ...empty, decisions: [{ topic: 'a', decision: 'b' }] })).toBe(false)
    expect(isEmptyNote({ ...empty, risks_added: ['r'] })).toBe(false)
    expect(isEmptyNote({ ...empty, risks_resolved: ['r'] })).toBe(false)
    expect(isEmptyNote({ ...empty, lock_reversals: [{ topic: 't', proposed: 'p', reason: 'r' }] })).toBe(false)
  })
})

describe('parsePrepStamp', () => {
  it("accepts {brief_version: 3, note_ids: ['a']}", () => {
    expect(parsePrepStamp({ brief_version: 3, note_ids: ['a'] })).toEqual({ brief_version: 3, note_ids: ['a'] })
  })
  it('returns null for malformed input', () => {
    expect(parsePrepStamp({})).toBeNull()
    expect(parsePrepStamp({ brief_version: -1, note_ids: [] })).toBeNull()
    expect(parsePrepStamp({ brief_version: 2, note_ids: [1] })).toBeNull()
    expect(parsePrepStamp(null)).toBeNull()
  })
})
