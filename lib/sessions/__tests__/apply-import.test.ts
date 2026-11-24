import { describe, it, expect } from 'vitest'
import type { Firestore } from 'firebase-admin/firestore'
import { applyImportToOpenSession } from '../apply-import'
import { decideReminder } from '@/lib/api/reminder-cadence'

// Minimal in-memory Firestore: collections of docs, where/orderBy, and a
// transaction that records writes (nothing is applied to the data; tests assert
// on the record). Reads are only allowed through the transaction: a query's
// public get() is logged in directReads, which the code under test must leave
// empty. `interleave` simulates another write landing during the first attempt:
// that attempt's writes are dropped and the callback runs again.
type Row = Record<string, unknown>
type Ref = { collection: string; id: string }
type Data = Record<string, Record<string, Row>>

function makeDb(data: Data, opts: { interleave?: (data: Data) => void } = {}) {
  const writes: { op: string; collection: string; id: string; data?: Row }[] = []
  const directReads: string[] = []
  let nextId = 0
  const ref = (collection: string, id: string): Ref => ({ collection, id })
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
        async _run() {
          let rows = Object.entries(data[name] ?? {}).filter(([, d]) => filters.every(([f, v]) => d[f] === v))
          if (order) rows = rows.sort((a, b) => String(a[1][order!]).localeCompare(String(b[1][order!])))
          return { docs: rows.map(([id, d]) => ({ id, data: () => d, ref: ref(name, id) })) }
        },
        async get() {
          directReads.push(name)
          return q._run()
        },
        doc(id?: string) {
          return ref(name, id ?? `new-${nextId++}`)
        },
      }
      return q
    },
    batch() {
      throw new Error('apply-import must write through its transaction')
    },
    async runTransaction<T>(fn: (tx: unknown) => Promise<T>): Promise<T> {
      for (let attempt = 1; ; attempt++) {
        const pending: typeof writes = []
        const tx = {
          get: (q: { _run: () => Promise<unknown> }) => {
            // Real Firestore refuses a read after a write in the same transaction.
            if (pending.length > 0) throw new Error('Firestore transactions must read before they write')
            return q._run()
          },
          delete: (r: Ref) => pending.push({ op: 'delete', collection: r.collection, id: r.id }),
          update: (r: Ref, d: Row) => pending.push({ op: 'update', collection: r.collection, id: r.id, data: d }),
          set: (r: Ref, d: Row) => pending.push({ op: 'set', collection: r.collection, id: r.id, data: d }),
        }
        const result = await fn(tx)
        // Simulates Firestore aborting the first attempt because another write
        // touched what it read: that attempt's writes are dropped and it re-runs.
        if (attempt === 1 && opts.interleave) {
          opts.interleave(data)
          continue
        }
        writes.push(...pending) // commit
        return result
      }
    },
  }
  return { db: db as unknown as Firestore, writes, directReads }
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
    expect((await applyImportToOpenSession(db, 'p1', project, NOW)).result).toBe('no_session')
    expect(writes).toEqual([])
  })

  it('maker replied after the greeting → maker_replied, no writes', async () => {
    const { db, writes } = makeDb({
      sessions: { s1: activeSession },
      messages: { g: greeting, m: { session_id: 's1', role: 'user', created_at: '2026-10-11T00:00:00.000Z' } },
    })
    expect((await applyImportToOpenSession(db, 'p1', project, NOW)).result).toBe('maker_replied')
    expect(writes).toEqual([])
  })

  it('no greeting but a maker message → maker_replied', async () => {
    const { db, writes } = makeDb({ sessions: { s1: activeSession }, messages: { m: makerEarly } })
    expect((await applyImportToOpenSession(db, 'p1', project, NOW)).result).toBe('maker_replied')
    expect(writes).toEqual([])
  })

  it('maker message before the greeting only → applied: greeting deleted, snapshot updated, flags cleared', async () => {
    const { db, writes } = makeDb({
      sessions: { s1: activeSession },
      messages: { m: makerEarly, g: greeting },
    })
    expect((await applyImportToOpenSession(db, 'p1', project, NOW)).result).toBe('applied')
    expect(writes).toContainEqual({ op: 'delete', collection: 'messages', id: 'g' })
    expect(writes).not.toContainEqual(expect.objectContaining({ op: 'delete', id: 'm' }))
    expect(writes).toContainEqual({
      op: 'update',
      collection: 'sessions',
      id: 's1',
      data: { ...project, agent_model: null, last_kickoff_at: NOW, unqueued_notified_at: null, updated_at: NOW },
    })
    expect(writes).toContainEqual({
      op: 'update',
      collection: 'projects',
      id: 'p1',
      data: { maker_waiting_since: null, latest_session_created_at: NOW },
    })
  })

  it('restarts the reminder cadence when a welcome is posted', async () => {
    const { db, writes } = makeDb({ sessions: { s1: activeSession }, messages: { m: makerEarly, g: greeting } })
    await applyImportToOpenSession(db, 'p1', project, NOW)
    expect(writes).toContainEqual({
      op: 'update',
      collection: 'projects',
      id: 'p1',
      data: { maker_waiting_since: null, latest_session_created_at: NOW },
    })
  })

  it('leaves the reminder cadence alone when no welcome is posted', async () => {
    const { db, writes } = makeDb({
      sessions: { s1: { ...activeSession, welcome_message: 'Fresh welcome' } },
      messages: { m: makerEarly, g: greeting },
    })
    await applyImportToOpenSession(db, 'p1', project, NOW)
    const projectUpdate = writes.find((w) => w.op === 'update' && w.collection === 'projects')
    expect(projectUpdate?.data).toEqual({ maker_waiting_since: null })
  })

  it('after a posted welcome the cron no longer says the maker already responded', async () => {
    const lastMakerMessageAt = makerEarly.created_at
    const base = { autoRemindersEnabled: true, requesterEmail: 'maya@example.com', remindersSentCount: 0, lastMakerMessageAt }
    const before = decideReminder({ ...base, latestSessionCreatedAt: '2026-10-10T00:00:00.000Z' }, new Date('2026-10-30T00:00:00.000Z'))
    expect(before).toEqual({ send: false, reason: 'maker_already_responded' })
    const after = decideReminder({ ...base, latestSessionCreatedAt: NOW }, new Date('2026-10-30T00:00:00.000Z'))
    expect(after.send).toBe(true)
  })

  it('re-snapshots the project model as agent_model, null when unset (#189)', async () => {
    const run = async (p: Record<string, unknown>) => {
      const { db, writes } = makeDb({ sessions: { s1: activeSession }, messages: {} })
      await applyImportToOpenSession(db, 'p1', p, NOW)
      return (writes.find((w) => w.op === 'update' && w.collection === 'sessions') as { data: Record<string, unknown> }).data
    }
    expect((await run({ ...project, model: 'claude-opus-5-5' })).agent_model).toBe('claude-opus-5-5')
    expect((await run(project)).agent_model).toBeNull()
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
    expect(sets[0].data).toEqual({ session_id: 's1', role: 'agent', kind: 'welcome', content: 'Fresh welcome', created_at: NOW, updated_at: NOW })
  })

  it('keeps a canned greeting the maker rated, and still deletes an unrated one', async () => {
    const { db, writes } = makeDb({
      sessions: { s1: activeSession },
      messages: {
        gRated: { ...greeting, rating: 'down' },
        gPlain: { ...greeting, created_at: '2026-10-10T10:05:00.000Z' },
      },
    })
    expect((await applyImportToOpenSession(db, 'p1', project, NOW)).result).toBe('applied')
    expect(writes).not.toContainEqual(expect.objectContaining({ op: 'delete', id: 'gRated' }))
    expect(writes).toContainEqual({ op: 'delete', collection: 'messages', id: 'gPlain' })
  })

  it('does not post a welcome an earlier session already used', async () => {
    const { db, writes } = makeDb({
      sessions: { s1: activeSession, s0: { project_id: 'p1', status: 'completed', created_at: '2026-10-01T00:00:00.000Z', welcome_message: 'Fresh welcome' } },
      messages: { g: greeting },
    })
    expect((await applyImportToOpenSession(db, 'p1', project, NOW)).result).toBe('applied')
    expect(writes.filter((w) => w.op === 'set')).toEqual([])
  })

  it('session with no greeting and no maker message → applied (re-snapshot only)', async () => {
    const { db, writes } = makeDb({ sessions: { s1: activeSession }, messages: {} })
    expect((await applyImportToOpenSession(db, 'p1', project, NOW)).result).toBe('applied')
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
    expect((await applyImportToOpenSession(db, 'p1', project, NOW)).result).toBe('applied')
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

  // Project 5: replace an unanswered opening, judge replies from the opening point.
  const T1 = '2026-10-10T09:00:00.000Z'
  const T2 = '2026-10-10T10:00:00.000Z'
  const T3 = '2026-10-10T11:00:00.000Z'
  const T4 = '2026-10-10T12:00:00.000Z'
  const maker = (created_at: string) => ({ session_id: 's1', role: 'user', created_at })
  const sam = (content: string, created_at: string, extra: Row = {}) => ({ session_id: 's1', role: 'agent', content, created_at, ...extra })
  const deletes = (writes: { op: string; id: string }[]) => writes.filter((w) => w.op === 'delete').map((w) => w.id)

  it('a maker message before an import-posted welcome is not a reply → applied', async () => {
    const { db } = makeDb({
      sessions: { s1: activeSession },
      messages: { m1: maker(T1), a1: sam('Sam reply', T2), w1: sam('Older welcome', T3, { kind: 'welcome' }) },
    })
    expect((await applyImportToOpenSession(db, 'p1', project, NOW)).result).toBe('applied')
  })

  it('a maker message after an import-posted welcome is a reply → maker_replied, no writes', async () => {
    const { db, writes } = makeDb({
      sessions: { s1: activeSession },
      messages: { m1: maker(T1), a1: sam('Sam reply', T2), w1: sam('Older welcome', T3, { kind: 'welcome' }), m2: maker(T4) },
    })
    expect((await applyImportToOpenSession(db, 'p1', project, NOW)).result).toBe('maker_replied')
    expect(writes).toEqual([])
  })

  it('replaces an unanswered creation welcome instead of adding a second', async () => {
    const { db, writes } = makeDb({
      sessions: { s1: activeSession },
      messages: { w0: sam('Old', T1) },
    })
    await applyImportToOpenSession(db, 'p1', project, NOW)
    expect(writes).toContainEqual({ op: 'delete', collection: 'messages', id: 'w0' })
    const sets = writes.filter((w) => w.op === 'set' && w.collection === 'messages')
    expect(sets).toHaveLength(1)
    expect(sets[0].data).toMatchObject({ kind: 'welcome', content: 'Fresh welcome' })
  })

  it('replaces an unanswered import-posted welcome and keeps the answered history', async () => {
    const { db, writes } = makeDb({
      sessions: { s1: activeSession },
      messages: { m1: maker(T1), a1: sam('Sam reply', T2), w1: sam('Middle', T3, { kind: 'welcome' }) },
    })
    await applyImportToOpenSession(db, 'p1', project, NOW)
    expect(deletes(writes)).toEqual(['w1'])
    expect(writes.filter((w) => w.op === 'set')).toHaveLength(1)
  })

  it('re-opening after a greeting deletes the greeting only', async () => {
    const { db, writes } = makeDb({
      sessions: { s1: activeSession },
      messages: { m1: maker(T1), a1: sam('Sam reply', T2), g: { ...greeting, created_at: T3 } },
    })
    await applyImportToOpenSession(db, 'p1', project, NOW)
    expect(deletes(writes)).toEqual(['g'])
    expect(writes.filter((w) => w.op === 'set')).toHaveLength(1)
  })

  it('deletes nothing but greetings when no welcome is posted', async () => {
    const { db, writes } = makeDb({
      sessions: { s1: { ...activeSession, welcome_message: 'Fresh welcome' } },
      messages: { w0: sam('Fresh welcome', T1) },
    })
    await applyImportToOpenSession(db, 'p1', project, NOW)
    expect(deletes(writes)).toEqual([])
    expect(writes.filter((w) => w.op === 'set')).toEqual([])
  })

  it('keeps an unanswered opening the maker rated', async () => {
    const { db, writes } = makeDb({
      sessions: { s1: activeSession },
      messages: { w0: sam('Old', T1, { rating: 'up' }) },
    })
    await applyImportToOpenSession(db, 'p1', project, NOW)
    expect(deletes(writes)).toEqual([])
    expect(writes.filter((w) => w.op === 'set')).toHaveLength(1)
  })

  // #293 item 3: the reads and writes share one transaction.
  it('reads and writes only through the transaction', async () => {
    const { db, writes, directReads } = makeDb({ sessions: { s1: activeSession }, messages: { w0: sam('Old', T1) } })
    await applyImportToOpenSession(db, 'p1', project, NOW)
    expect(directReads).toEqual([])
    expect(writes).toContainEqual({ op: 'delete', collection: 'messages', id: 'w0' })
    expect(writes.filter((w) => w.op === 'set' && w.collection === 'messages')).toHaveLength(1)
  })

  it('a maker reply that lands while the import runs is seen on the retry → maker_replied, nothing written', async () => {
    const { db, writes } = makeDb(
      { sessions: { s1: activeSession }, messages: { w0: sam('Old', T1) } },
      { interleave: (d) => { d.messages.m9 = maker(T2) } }
    )
    expect((await applyImportToOpenSession(db, 'p1', project, NOW)).result).toBe('maker_replied')
    expect(writes).toEqual([])
  })

  it('a rating that lands while the import runs keeps the rated welcome', async () => {
    const { db, writes } = makeDb(
      { sessions: { s1: activeSession }, messages: { w0: sam('Old', T1) } },
      { interleave: (d) => { d.messages.w0.rating = 'up' } }
    )
    await applyImportToOpenSession(db, 'p1', project, NOW)
    expect(deletes(writes)).toEqual([])
    const sets = writes.filter((w) => w.op === 'set' && w.collection === 'messages')
    expect(sets).toHaveLength(1)
    expect(sets[0].data).toMatchObject({ content: 'Fresh welcome' })
  })

  it('a second import right after the first does not post the welcome twice', async () => {
    const { db, writes } = makeDb(
      { sessions: { s1: activeSession }, messages: { w0: sam('Old', T1) } },
      { interleave: (d) => { d.messages.wNew = sam('Fresh welcome', NOW, { kind: 'welcome' }) } }
    )
    await applyImportToOpenSession(db, 'p1', project, NOW)
    expect(writes.filter((w) => w.op === 'set' && w.collection === 'messages')).toEqual([])
  })

  // #293 item 2: the answer says whether a welcome was posted.
  it('says a welcome was posted when it posts one', async () => {
    const { db } = makeDb({ sessions: { s1: activeSession }, messages: { g: greeting } })
    expect(await applyImportToOpenSession(db, 'p1', project, NOW)).toEqual({ result: 'applied', welcomePosted: true })
  })

  it('says no welcome was posted when it only re-arms the conversation', async () => {
    const { db, writes } = makeDb({
      sessions: { s1: { ...activeSession, welcome_message: 'Fresh welcome' } },
      messages: { m: makerEarly, g: greeting },
    })
    expect(await applyImportToOpenSession(db, 'p1', project, NOW)).toEqual({ result: 'applied', welcomePosted: false })
    expect(writes).toContainEqual({ op: 'delete', collection: 'messages', id: 'g' })
  })

  it('never says a welcome was posted when it did not apply', async () => {
    const none = makeDb({ sessions: { s1: { ...activeSession, status: 'completed' } } })
    expect((await applyImportToOpenSession(none.db, 'p1', project, NOW)).welcomePosted).toBe(false)
    const replied = makeDb({
      sessions: { s1: activeSession },
      messages: { g: greeting, m: { session_id: 's1', role: 'user', created_at: '2026-10-11T00:00:00.000Z' } },
    })
    expect((await applyImportToOpenSession(replied.db, 'p1', project, NOW)).welcomePosted).toBe(false)
  })
})
