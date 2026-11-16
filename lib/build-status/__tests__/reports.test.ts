import { describe, it, expect } from 'vitest'
import type { Firestore } from 'firebase-admin/firestore'
import type { BuildReportBody } from '../report'
import {
  DUPLICATE_WINDOW_MS,
  MAX_UNFOLDED_REPORTS,
  addReport,
  foldReports,
  latestReportAt,
  listReports,
  listUnfoldedReports,
} from '../reports'

// In-memory stand-in for projects/{id}/build_reports: add(), doc(id).get() and
// .update(), orderBy(field, dir).get() and .limit(n).get(), and an equality
// where(field, '==', value) with .get() and .count().get(). One store per project.
function makeDb() {
  const stores = new Map<string, Map<string, Record<string, unknown>>>()
  // Each where()/orderBy() call, so a test can see which query a function ran.
  const queries: string[] = []
  let n = 0

  function storeFor(projectId: string) {
    if (!stores.has(projectId)) stores.set(projectId, new Map())
    return stores.get(projectId)!
  }

  function collectionFor(projectId: string) {
    const store = storeFor(projectId)
    return {
      where: (field: string, op: string, value: unknown) => {
        if (op !== '==') throw new Error(`unexpected op ${op}`)
        queries.push(`where ${field} == ${JSON.stringify(value)}`)
        // Firestore's == null matches only a stored null, not a missing field.
        const matching = () =>
          [...store.entries()]
            .filter(([, data]) => field in data && data[field] === value)
            .map(([id, data]) => ({ id, data: () => data }))
        return {
          get: async () => {
            const docs = matching()
            return { docs, empty: docs.length === 0, size: docs.length }
          },
          count: () => ({ get: async () => ({ data: () => ({ count: matching().length }) }) }),
        }
      },
      orderBy: (field: string, dir: 'asc' | 'desc' = 'asc') => {
        queries.push(`orderBy ${field} ${dir}`)
        const sorted = () => {
          const docs = [...store.entries()]
            .sort((a, b) => String(a[1][field]).localeCompare(String(b[1][field])))
            .map(([id, data]) => ({ id, data: () => data }))
          return dir === 'desc' ? docs.reverse() : docs
        }
        return {
          get: async () => ({ docs: sorted(), empty: store.size === 0 }),
          limit: (count: number) => ({
            get: async () => ({ docs: sorted().slice(0, count), empty: store.size === 0 }),
          }),
        }
      },
      add: async (data: Record<string, unknown>) => {
        const id = `r${++n}`
        store.set(id, data)
        return { id }
      },
      doc: (id: string) => {
        // Real Firestore throws on these ids; mirror it.
        if (
          !id ||
          id === '.' ||
          id === '..' ||
          id.length > 1500 ||
          id.includes('/') ||
          /^__.*__$/.test(id)
        )
          throw new Error(`invalid doc id ${id}`)
        return {
          get: async () => ({ id, exists: store.has(id), data: () => store.get(id) }),
          update: async (patch: Record<string, unknown>) => {
            if (!store.has(id)) throw new Error('NOT_FOUND')
            store.set(id, { ...store.get(id), ...patch })
          },
        }
      },
    }
  }

  const db = {
    collection: (name: string) => {
      if (name !== 'projects') throw new Error(`unexpected collection ${name}`)
      return {
        doc: (projectId: string) => ({
          collection: (sub: string) => {
            if (sub !== 'build_reports') throw new Error(`unexpected subcollection ${sub}`)
            return collectionFor(projectId)
          },
        }),
      }
    },
  }
  return { db: db as unknown as Firestore, storeFor, queries }
}

const body = (over: Partial<BuildReportBody> = {}): BuildReportBody => ({
  live: [{ what: 'Signup works', checked: 'Signed up on prod' }],
  merged: ['PR 12'],
  proposed: ['Add search'],
  questions: ['Which logo?'],
  ...over,
})

const input = (report: BuildReportBody) => ({
  repo: 'nicolovejoy/l6-music',
  brief_version_checked: 4,
  report,
})

const at = (iso: string) => new Date(iso)
const plusMinutes = (iso: string, minutes: number) =>
  new Date(Date.parse(iso) + minutes * 60 * 1000)

const T0 = '2026-11-15T10:00:00.000Z'

describe('build report store', () => {
  it('exports a ten minute duplicate window', () => {
    expect(DUPLICATE_WINDOW_MS).toBe(10 * 60 * 1000)
  })

  it('addReport stores the report with its hash, posted_at and folded_at null', async () => {
    const { db } = makeDb()
    const result = await addReport(db, 'p1', input(body()), at(T0))
    expect(result).toEqual({ posted_at: T0, duplicate: false, full: false })

    const [stored] = await listReports(db, 'p1')
    expect(stored).toMatchObject({
      repo: 'nicolovejoy/l6-music',
      brief_version_checked: 4,
      live: [{ what: 'Signup works', checked: 'Signed up on prod' }],
      merged: ['PR 12'],
      proposed: ['Add search'],
      questions: ['Which logo?'],
      posted_at: T0,
      folded_at: null,
    })
    expect(stored.body_hash).toMatch(/^[0-9a-f]{64}$/)
    expect(stored.id).toBeTruthy()
  })

  it('drops the same body posted 9 minutes later and returns the first posted_at', async () => {
    const { db } = makeDb()
    await addReport(db, 'p1', input(body()), at(T0))
    const result = await addReport(db, 'p1', input(body()), plusMinutes(T0, 9))
    expect(result).toEqual({ posted_at: T0, duplicate: true, full: false })
    expect(await listReports(db, 'p1')).toHaveLength(1)
  })

  it('stores the same body posted 11 minutes later', async () => {
    const { db } = makeDb()
    await addReport(db, 'p1', input(body()), at(T0))
    const later = plusMinutes(T0, 11)
    const result = await addReport(db, 'p1', input(body()), later)
    expect(result).toEqual({ posted_at: later.toISOString(), duplicate: false, full: false })
    expect(await listReports(db, 'p1')).toHaveLength(2)
  })

  it('stores a different body posted 1 minute later', async () => {
    const { db } = makeDb()
    await addReport(db, 'p1', input(body()), at(T0))
    const result = await addReport(db, 'p1', input(body({ merged: ['PR 13'] })), plusMinutes(T0, 1))
    expect(result.duplicate).toBe(false)
    expect(await listReports(db, 'p1')).toHaveLength(2)
  })

  it('stores the same body posted 1 minute later against a different brief version', async () => {
    const { db } = makeDb()
    await addReport(db, 'p1', input(body()), at(T0))
    const result = await addReport(
      db,
      'p1',
      { ...input(body()), brief_version_checked: 5 },
      plusMinutes(T0, 1)
    )
    expect(result).toEqual({
      posted_at: plusMinutes(T0, 1).toISOString(),
      duplicate: false,
      full: false,
    })
    expect(await listReports(db, 'p1')).toHaveLength(2)
  })

  it('exports a cap of 50 unfolded reports', () => {
    expect(MAX_UNFOLDED_REPORTS).toBe(50)
  })

  it('refuses a new report when the project already holds 50 unfolded ones', async () => {
    const { db } = makeDb()
    for (let i = 0; i < MAX_UNFOLDED_REPORTS; i++) {
      await addReport(db, 'p1', input(body({ merged: [`PR ${i}`] })), plusMinutes(T0, i))
    }
    const result = await addReport(db, 'p1', input(body({ merged: ['one more'] })), plusMinutes(T0, 60))
    expect(result).toEqual({ posted_at: null, duplicate: false, full: true })
    expect(await listReports(db, 'p1')).toHaveLength(MAX_UNFOLDED_REPORTS)
  })

  it('folded reports do not count toward the cap', async () => {
    const { db, storeFor } = makeDb()
    for (let i = 0; i < MAX_UNFOLDED_REPORTS; i++) {
      await addReport(db, 'p1', input(body({ merged: [`PR ${i}`] })), plusMinutes(T0, i))
    }
    const [firstId, first] = [...storeFor('p1').entries()][0]
    storeFor('p1').set(firstId, { ...first, folded_at: '2026-11-15T12:00:00.000Z' })
    const result = await addReport(db, 'p1', input(body({ merged: ['one more'] })), plusMinutes(T0, 60))
    expect(result.full).toBe(false)
    expect(result.posted_at).toBe(plusMinutes(T0, 60).toISOString())
  })

  it('compares only the latest report: a body repeated after a different one is stored', async () => {
    const { db } = makeDb()
    await addReport(db, 'p1', input(body()), at(T0))
    await addReport(db, 'p1', input(body({ merged: ['PR 13'] })), plusMinutes(T0, 1))
    const result = await addReport(db, 'p1', input(body()), plusMinutes(T0, 2))
    expect(result.duplicate).toBe(false)
    expect(await listReports(db, 'p1')).toHaveLength(3)
  })

  it("does not treat another project's report as a duplicate", async () => {
    const { db } = makeDb()
    await addReport(db, 'p1', input(body()), at(T0))
    const result = await addReport(db, 'p2', input(body()), plusMinutes(T0, 1))
    expect(result.duplicate).toBe(false)
  })

  it('listUnfoldedReports leaves out a folded report and lists oldest first', async () => {
    const { db, storeFor } = makeDb()
    await addReport(db, 'p1', input(body({ merged: ['second'] })), at('2026-11-15T11:00:00.000Z'))
    await addReport(db, 'p1', input(body({ merged: ['first'] })), at('2026-11-15T10:00:00.000Z'))
    await addReport(db, 'p1', input(body({ merged: ['folded'] })), at('2026-11-15T12:00:00.000Z'))
    const folded = [...storeFor('p1').entries()].find(
      ([, d]) => (d.merged as string[])[0] === 'folded'
    )!
    storeFor('p1').set(folded[0], { ...folded[1], folded_at: '2026-11-15T13:00:00.000Z' })

    const out = await listUnfoldedReports(db, 'p1')
    expect(out.map((r) => r.merged[0])).toEqual(['first', 'second'])
    expect(out.every((r) => r.id)).toBe(true)
    expect(await listReports(db, 'p1')).toHaveLength(3)
  })

  it('listUnfoldedReports queries folded_at == null rather than reading every report', async () => {
    const { db, queries } = makeDb()
    await addReport(db, 'p1', input(body()), at(T0))
    queries.length = 0
    await listUnfoldedReports(db, 'p1')
    expect(queries).toEqual(['where folded_at == null'])
  })

  it('latestReportAt is the newest posted_at, folded or not, and null with no reports', async () => {
    const { db, storeFor } = makeDb()
    expect(await latestReportAt(db, 'p1')).toBeNull()
    await addReport(db, 'p1', input(body({ merged: ['a'] })), at('2026-11-15T10:00:00.000Z'))
    await addReport(db, 'p1', input(body({ merged: ['b'] })), at('2026-11-15T12:00:00.000Z'))
    await addReport(db, 'p1', input(body({ merged: ['c'] })), at('2026-11-15T11:00:00.000Z'))
    const newest = [...storeFor('p1').entries()].find(([, d]) => (d.merged as string[])[0] === 'b')!
    storeFor('p1').set(newest[0], { ...newest[1], folded_at: '2026-11-15T13:00:00.000Z' })
    expect(await latestReportAt(db, 'p1')).toBe('2026-11-15T12:00:00.000Z')
  })

  it('foldReports folds listed unfolded ids and returns only those it folded', async () => {
    const { db, storeFor } = makeDb()
    await addReport(db, 'p1', input(body({ merged: ['a'] })), at('2026-11-15T10:00:00.000Z'))
    await addReport(db, 'p1', input(body({ merged: ['b'] })), at('2026-11-15T11:00:00.000Z'))
    const [a, b] = (await listReports(db, 'p1')).map((r) => r.id)
    storeFor('p1').set(b, { ...storeFor('p1').get(b)!, folded_at: '2026-11-15T12:00:00.000Z' })

    const folded = await foldReports(
      db,
      'p1',
      [a, 'missing', b, '../x'],
      '2026-11-15T20:00:00.000Z'
    )
    expect(folded).toEqual([a])

    const all = await listReports(db, 'p1')
    expect(all.find((r) => r.id === a)?.folded_at).toBe('2026-11-15T20:00:00.000Z')
    expect(all.find((r) => r.id === b)?.folded_at).toBe('2026-11-15T12:00:00.000Z')
  })

  it('foldReports on one project never touches a report with the same id in another', async () => {
    const { db, storeFor } = makeDb()
    const seed = {
      ...body(),
      repo: 'x/y',
      brief_version_checked: 1,
      folded_at: null,
      body_hash: 'h',
    }
    storeFor('pA').set('same', { ...seed, posted_at: T0 })
    storeFor('pB').set('same', { ...seed, posted_at: T0 })

    const folded = await foldReports(db, 'pA', ['same'], '2026-11-15T20:00:00.000Z')
    expect(folded).toEqual(['same'])
    expect((await listReports(db, 'pA'))[0].folded_at).toBe('2026-11-15T20:00:00.000Z')
    expect((await listReports(db, 'pB'))[0].folded_at).toBeNull()
  })
})
