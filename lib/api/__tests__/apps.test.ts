import { describe, it, expect } from 'vitest'
import type { Firestore } from 'firebase-admin/firestore'
import {
  isValidAppSlug,
  findAppBySlug,
  createApp,
  AppSlugInvalid,
  AppSlugTaken,
} from '../apps'

// In-memory stand-in for the `apps` collection: doc get/set by id, plus the
// where('legacy_slugs','array-contains',x).limit(n).get() query.
function makeDb(seed: Record<string, Record<string, unknown>> = {}) {
  const store = new Map(Object.entries(seed))
  const snap = (id: string) => ({
    id,
    exists: store.has(id),
    data: () => store.get(id),
  })
  const db = {
    collection: (name: string) => {
      if (name !== 'apps') throw new Error(`unexpected collection ${name}`)
      return {
        doc: (id: string) => ({
          get: async () => snap(id),
          set: async (data: Record<string, unknown>) => {
            store.set(id, data)
          },
          // Firestore create(): fails with gRPC ALREADY_EXISTS (6) if the doc is there.
          create: async (data: Record<string, unknown>) => {
            if (store.has(id)) throw Object.assign(new Error('ALREADY_EXISTS'), { code: 6 })
            store.set(id, data)
          },
        }),
        where: (field: string, op: string, value: string) => ({
          limit: () => ({
            get: async () => {
              const docs = [...store.entries()]
                .filter(
                  ([, d]) =>
                    field === 'legacy_slugs' &&
                    op === 'array-contains' &&
                    ((d.legacy_slugs as string[] | undefined) ?? []).includes(value)
                )
                .map(([id]) => snap(id))
              return { empty: docs.length === 0, docs }
            },
          }),
        }),
      }
    },
  }
  return { db: db as unknown as Firestore, store }
}

const base = { name: 'Existing', created_by: 'u1', created_at: 'x', updated_at: 'x' }

describe('isValidAppSlug', () => {
  it('accepts kebab-case and rejects case, spaces, dashes at ends, >64 chars', () => {
    expect(isValidAppSlug('byside')).toBe(true)
    expect(isValidAppSlug('l6-music')).toBe(true)
    expect(isValidAppSlug('Tideline')).toBe(false)
    expect(isValidAppSlug('two words')).toBe(false)
    expect(isValidAppSlug('-lead')).toBe(false)
    expect(isValidAppSlug('trail-')).toBe(false)
    expect(isValidAppSlug('a--b')).toBe(false)
    expect(isValidAppSlug('')).toBe(false)
    expect(isValidAppSlug('a'.repeat(64))).toBe(true)
    expect(isValidAppSlug('a'.repeat(65))).toBe(false)
  })
})

describe('findAppBySlug', () => {
  it('returns the app by canonical slug', async () => {
    const { db } = makeDb({ byside: { ...base, slug: 'byside' } })
    const app = await findAppBySlug(db, 'byside')
    expect(app?.slug).toBe('byside')
    expect(app?.id).toBe('byside')
  })
  it('returns the app by a legacy slug', async () => {
    const { db } = makeDb({ byside: { ...base, slug: 'byside', legacy_slugs: ['old-brief-slug'] } })
    const app = await findAppBySlug(db, 'old-brief-slug')
    expect(app?.slug).toBe('byside')
  })
  it('returns null for an unknown slug', async () => {
    const { db } = makeDb({ byside: { ...base, slug: 'byside' } })
    expect(await findAppBySlug(db, 'nope')).toBeNull()
  })
})

describe('createApp', () => {
  it('writes apps/{slug} with created_at and the given fields', async () => {
    const { db, store } = makeDb()
    const app = await createApp(db, { slug: 'prntd', name: 'PRNTD', created_by: 'u1', github_repo: 'a/b' })
    const doc = store.get('prntd')!
    expect(doc.name).toBe('PRNTD')
    expect(doc.github_repo).toBe('a/b')
    expect(doc.created_by).toBe('u1')
    expect(typeof doc.created_at).toBe('string')
    expect(doc.updated_at).toBe(doc.created_at)
    expect(app.id).toBe('prntd')
    expect(app.slug).toBe('prntd')
  })
  it('throws AppSlugInvalid for "Tideline"', async () => {
    const { db } = makeDb()
    await expect(createApp(db, { slug: 'Tideline', name: 'T', created_by: 'u1' })).rejects.toBeInstanceOf(AppSlugInvalid)
  })
  it('throws AppSlugTaken when the slug is another app’s canonical slug', async () => {
    const { db } = makeDb({ byside: { ...base, slug: 'byside' } })
    await expect(createApp(db, { slug: 'byside', name: 'X', created_by: 'u1' })).rejects.toBeInstanceOf(AppSlugTaken)
  })
  it('throws AppSlugTaken when the slug is another app’s legacy slug', async () => {
    const { db } = makeDb({ byside: { ...base, slug: 'byside', legacy_slugs: ['old'] } })
    await expect(createApp(db, { slug: 'old', name: 'X', created_by: 'u1' })).rejects.toBeInstanceOf(AppSlugTaken)
  })
  it('throws AppSlugTaken when a legacy_slugs entry is already an app slug', async () => {
    const { db } = makeDb({ byside: { ...base, slug: 'byside' } })
    await expect(
      createApp(db, { slug: 'new-app', name: 'X', created_by: 'u1', legacy_slugs: ['byside'] })
    ).rejects.toBeInstanceOf(AppSlugTaken)
  })
  it('maps Firestore ALREADY_EXISTS (a concurrent create) to AppSlugTaken', async () => {
    const { db, store } = makeDb()
    // Simulate the race: the slug looks free at check time, then another create lands.
    const realCollection = (db as unknown as { collection: (n: string) => any }).collection
    ;(db as unknown as { collection: unknown }).collection = (n: string) => {
      const c = realCollection(n)
      const realDoc = c.doc
      c.doc = (id: string) => {
        const d = realDoc(id)
        return {
          ...d,
          create: async () => {
            throw Object.assign(new Error('6 ALREADY_EXISTS'), { code: 6 })
          },
        }
      }
      return c
    }
    await expect(createApp(db, { slug: 'race', name: 'R', created_by: 'u1' })).rejects.toBeInstanceOf(AppSlugTaken)
    expect(store.has('race')).toBe(false)
  })
  it('a rejected create writes nothing', async () => {
    const { db, store } = makeDb({ byside: { ...base, slug: 'byside' } })
    await expect(createApp(db, { slug: 'byside', name: 'X', created_by: 'u1' })).rejects.toBeInstanceOf(AppSlugTaken)
    await expect(createApp(db, { slug: 'Bad', name: 'X', created_by: 'u1' })).rejects.toBeInstanceOf(AppSlugInvalid)
    expect([...store.keys()]).toEqual(['byside'])
  })
  it('de-duplicates legacy_slugs', async () => {
    const { db, store } = makeDb()
    await createApp(db, { slug: 'new-app', name: 'N', created_by: 'u1', legacy_slugs: ['old', 'old'] })
    expect(store.get('new-app')?.legacy_slugs).toEqual(['old'])
  })
})
