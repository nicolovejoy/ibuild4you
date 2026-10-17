import { describe, it, expect } from 'vitest'
import type { Firestore } from 'firebase-admin/firestore'
import { applyImportToOpenSession } from '../apply-import'

// Minimal in-memory Firestore: collections of docs, where/orderBy/get, and a
// batch that records writes (nothing is applied; tests assert on the record).
type Row = Record<string, unknown>

function makeDb(data: Record<string, Record<string, Row>>) {
  const writes: { op: string; collection: string; id: string; data?: Row }[] = []
  let nextId = 0
  const ref = (collection: string, id: string) => ({ collection, id })
  const db = {
    collection(name: string) {
      const filters: [string, unknown][] = []
      let order: string | null = null
      const q = {
        where(field: string, _op: string, value: unknown) {
          filters.push([field, value])
          return q
        },
        orderBy(field: string) {
          order = field
          return q
        },
        async get() {
          let rows = Object.entries(data[name] ?? {}).filter(([, d]) => filters.every(([f, v]) => d[f] === v))
          if (order) rows = rows.sort((a, b) => String(a[1][order!]).localeCompare(String(b[1][order!])))
          return { docs: rows.map(([id, d]) => ({ id, data: () => d, ref: ref(name, id) })) }
        },
        doc(id?: string) {
          return ref(name, id ?? `new-${nextId++}`)
        },
      }
      return q
    },
    batch() {
      return {
        delete: (r: { collection: string; id: string }) => writes.push({ op: 'delete', collection: r.collection, id: r.id }),
        update: (r: { collection: string; id: string }, d: Row) => writes.push({ op: 'update', collection: r.collection, id: r.id, data: d }),
        set: (r: { collection: string; id: string }, d: Row) => writes.push({ op: 'set', collection: r.collection, id: r.id, data: d }),
        commit: async () => {},
      }
    },
  }
  return { db: db as unknown as Firestore, writes }
}

const NOW = '2026-10-17T12:00:00.000Z'
const project = {
  session_mode: 'converge',
  seed_questions: ['q'],
  builder_directives: ['d'],
  welcome_message: 'Fresh welcome',
  identity: 'Sam',
}
const greeting = { session_id: 's1', role: 'agent', kind: 'unqueued_greeting', created_at: '2026-10-10T10:00:00.000Z' }
const makerEarly = { session_id: 's1', role: 'user', created_at: '2026-10-10T09:00:00.000Z' }
const activeSession = { project_id: 'p1', status: 'active', created_at: '2026-10-10T00:00:00.000Z', welcome_message: 'Old' }

describe('applyImportToOpenSession', () => {
  it('no active session → no_session, no writes', async () => {
    const { db, writes } = makeDb({ sessions: { s1: { ...activeSession, status: 'completed' } } })
    expect(await applyImportToOpenSession(db, 'p1', project, NOW)).toBe('no_session')
    expect(writes).toEqual([])
  })

  it('maker replied after the greeting → maker_replied, no writes', async () => {
    const { db, writes } = makeDb({
      sessions: { s1: activeSession },
      messages: { g: greeting, m: { session_id: 's1', role: 'user', created_at: '2026-10-11T00:00:00.000Z' } },
    })
    expect(await applyImportToOpenSession(db, 'p1', project, NOW)).toBe('maker_replied')
    expect(writes).toEqual([])
  })

  it('no greeting but a maker message → maker_replied', async () => {
    const { db, writes } = makeDb({ sessions: { s1: activeSession }, messages: { m: makerEarly } })
    expect(await applyImportToOpenSession(db, 'p1', project, NOW)).toBe('maker_replied')
    expect(writes).toEqual([])
  })

  it('maker message before the greeting only → applied: greeting deleted, snapshot updated, flags cleared', async () => {
    const { db, writes } = makeDb({
      sessions: { s1: activeSession },
      messages: { m: makerEarly, g: greeting },
    })
    expect(await applyImportToOpenSession(db, 'p1', project, NOW)).toBe('applied')
    expect(writes).toContainEqual({ op: 'delete', collection: 'messages', id: 'g' })
    expect(writes).not.toContainEqual(expect.objectContaining({ op: 'delete', id: 'm' }))
    expect(writes).toContainEqual({
      op: 'update',
      collection: 'sessions',
      id: 's1',
      data: { ...project, last_kickoff_at: NOW, unqueued_notified_at: null, updated_at: NOW },
    })
    expect(writes).toContainEqual({ op: 'update', collection: 'projects', id: 'p1', data: { maker_waiting_since: null } })
  })

  it('posts the new welcome when it is new for this round', async () => {
    const { db, writes } = makeDb({
      sessions: { s1: activeSession, s0: { project_id: 'p1', status: 'completed', created_at: '2026-10-01T00:00:00.000Z', welcome_message: 'Older' } },
      messages: { g: greeting },
    })
    await applyImportToOpenSession(db, 'p1', project, NOW)
    const sets = writes.filter((w) => w.op === 'set')
    expect(sets).toHaveLength(1)
    expect(sets[0].collection).toBe('messages')
    expect(sets[0].data).toEqual({ session_id: 's1', role: 'agent', content: 'Fresh welcome', created_at: NOW, updated_at: NOW })
  })

  it('does not post a welcome an earlier session already used', async () => {
    const { db, writes } = makeDb({
      sessions: { s1: activeSession, s0: { project_id: 'p1', status: 'completed', created_at: '2026-10-01T00:00:00.000Z', welcome_message: 'Fresh welcome' } },
      messages: { g: greeting },
    })
    expect(await applyImportToOpenSession(db, 'p1', project, NOW)).toBe('applied')
    expect(writes.filter((w) => w.op === 'set')).toEqual([])
  })

  it('session with no greeting and no maker message → applied (re-snapshot only)', async () => {
    const { db, writes } = makeDb({ sessions: { s1: activeSession }, messages: {} })
    expect(await applyImportToOpenSession(db, 'p1', project, NOW)).toBe('applied')
    expect(writes.filter((w) => w.op === 'delete')).toEqual([])
    expect(writes).toContainEqual(expect.objectContaining({ op: 'update', collection: 'sessions', id: 's1' }))
  })

  it('picks the newest of several active sessions', async () => {
    const { db, writes } = makeDb({
      sessions: { s1: activeSession, s2: { ...activeSession, created_at: '2026-10-12T00:00:00.000Z' } },
      messages: {},
    })
    await applyImportToOpenSession(db, 'p1', project, NOW)
    expect(writes).toContainEqual(expect.objectContaining({ op: 'update', collection: 'sessions', id: 's2' }))
  })

  it('re-import with unchanged welcome does not re-post', async () => {
    const { db, writes } = makeDb({
      sessions: { s1: { ...activeSession, welcome_message: 'Fresh welcome' } },
      messages: { g: greeting },
    })
    expect(await applyImportToOpenSession(db, 'p1', project, NOW)).toBe('applied')
    expect(writes.filter((w) => w.op === 'set')).toEqual([])
  })

  it('welcome identical to an existing agent message is not re-posted', async () => {
    const { db, writes } = makeDb({
      sessions: { s1: activeSession },
      messages: { w: { session_id: 's1', role: 'agent', content: ' Fresh welcome ', created_at: '2026-10-10T08:00:00.000Z' }, g: greeting },
    })
    await applyImportToOpenSession(db, 'p1', project, NOW)
    expect(writes.filter((w) => w.op === 'set')).toEqual([])
  })

  it('posting a welcome stamps last_kickoff_at to now', async () => {
    const { db, writes } = makeDb({ sessions: { s1: activeSession }, messages: { g: greeting } })
    await applyImportToOpenSession(db, 'p1', project, NOW)
    const upd = writes.find((w) => w.collection === 'sessions' && w.op === 'update')
    expect(upd?.data?.last_kickoff_at).toBe(NOW)
  })

  it('no welcome posted leaves last_kickoff_at null', async () => {
    const { db, writes } = makeDb({ sessions: { s1: { ...activeSession, welcome_message: 'Fresh welcome' } }, messages: { g: greeting } })
    await applyImportToOpenSession(db, 'p1', project, NOW)
    const upd = writes.find((w) => w.collection === 'sessions' && w.op === 'update')
    expect(upd?.data?.last_kickoff_at).toBeNull()
  })
})
