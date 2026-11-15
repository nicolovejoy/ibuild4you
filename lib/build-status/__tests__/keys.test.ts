import { describe, it, expect, vi } from 'vitest'
import type { Firestore } from 'firebase-admin/firestore'
import { hashReadKey } from '@/lib/feedback/read-crypto'
import {
  STATUS_KEYS_COLLECTION,
  STATUS_KEY_PREFIX,
  fullRepo,
  repoKeyId,
  mintStatusKey,
  revokeStatusKey,
  getStatusKeyStatus,
  verifyStatusKey,
  touchStatusKey,
} from '../keys'
import { LAST_USED_THROTTLE_MS } from '@/lib/feedback/read-keys'
import { fullRepo as githubFullRepo } from '@/lib/github/repo'

type Doc = Record<string, unknown>

// Small in-memory Firestore: only the calls the store makes. Every collection
// name used is recorded so tests can assert the store stays in its own one.
// (Same fake as lib/feedback/__tests__/read-keys.test.ts.)
function fakeDb() {
  const data = new Map<string, Doc>()
  const collections = new Set<string>()
  const updates: Array<{ id: string; fields: Doc }> = []
  let failUpdates = false
  const db = {
    collection: (name: string) => {
      collections.add(name)
      return {
        doc: (id: string) => ({
          get: async () => ({
            exists: data.has(`${name}/${id}`),
            data: () => data.get(`${name}/${id}`),
          }),
          set: async (doc: Doc) => {
            data.set(`${name}/${id}`, { ...doc })
          },
          update: async (fields: Doc) => {
            if (failUpdates) throw new Error('boom')
            updates.push({ id, fields })
            data.set(`${name}/${id}`, { ...data.get(`${name}/${id}`), ...fields })
          },
          delete: async () => {
            data.delete(`${name}/${id}`)
          },
        }),
      }
    },
  }
  return {
    db: db as unknown as Firestore,
    data,
    collections,
    updates,
    failUpdates: () => {
      failUpdates = true
    },
  }
}

const NOW = new Date('2026-11-15T12:00:00.000Z')
const REPO = 'nicolovejoy/l6-music'
const DOC = 'build_status_keys/nicolovejoy__l6-music'

describe('fullRepo', () => {
  // The function and its tests live in lib/github/repo.ts; keys.ts re-exports it.
  it('is the lib/github/repo function, re-exported', () => {
    expect(fullRepo).toBe(githubFullRepo)
  })
})

describe('repoKeyId', () => {
  it('swaps the slash so the repo is a legal doc id', () => {
    expect(repoKeyId('nicolovejoy/l6-music')).toBe('nicolovejoy__l6-music')
  })
})

describe('mintStatusKey', () => {
  it('stores only the hash, in build_status_keys', async () => {
    const f = fakeDb()
    const { key, created_at, rotated } = await mintStatusKey(f.db, REPO, 'uid1', NOW)
    expect(STATUS_KEYS_COLLECTION).toBe('build_status_keys')
    expect(key.startsWith(STATUS_KEY_PREFIX)).toBe(true)
    expect(STATUS_KEY_PREFIX).toBe('bsk_')
    expect([...f.collections]).toEqual(['build_status_keys'])
    const stored = f.data.get(DOC)!
    expect(stored.repo).toBe(REPO)
    expect(stored.key_hash).toBe(hashReadKey(key))
    expect(stored.created_by).toBe('uid1')
    expect(stored.created_at).toBe(created_at)
    expect(created_at).toBe(NOW.toISOString())
    expect(stored).not.toHaveProperty('key')
    expect(JSON.stringify(stored)).not.toContain(key)
    expect(rotated).toBe(false)
  })

  it('rotating replaces the key and drops last_used_at', async () => {
    const f = fakeDb()
    const first = await mintStatusKey(f.db, REPO, 'uid1', NOW)
    await f.db
      .collection('build_status_keys')
      .doc('nicolovejoy__l6-music')
      .update({ last_used_at: NOW.toISOString() })
    const second = await mintStatusKey(f.db, REPO, 'uid1', NOW)
    expect(second.rotated).toBe(true)
    expect(second.key).not.toBe(first.key)
    expect(await verifyStatusKey(f.db, REPO, first.key)).toBeNull()
    expect(await verifyStatusKey(f.db, REPO, second.key)).toEqual({ last_used_at: null })
    expect(f.data.get(DOC)).not.toHaveProperty('last_used_at')
  })
})

describe('verifyStatusKey', () => {
  it('accepts the right key and rejects everything else', async () => {
    const f = fakeDb()
    const { key } = await mintStatusKey(f.db, 'a/one', 'uid', NOW)
    await mintStatusKey(f.db, 'a/two', 'uid', NOW)
    expect(await verifyStatusKey(f.db, 'a/one', key)).toEqual({ last_used_at: null })
    expect(await verifyStatusKey(f.db, 'a/one', key + 'x')).toBeNull()
    expect(await verifyStatusKey(f.db, 'a/one', '')).toBeNull()
    expect(await verifyStatusKey(f.db, 'a/one', 'short')).toBeNull()
    expect(await verifyStatusKey(f.db, 'a/two', key)).toBeNull()
    expect(await verifyStatusKey(f.db, 'a/none', key)).toBeNull()
  })

  it('treats a doc without a string key_hash as no key, without throwing', async () => {
    const f = fakeDb()
    f.data.set('build_status_keys/a__one', { key_hash: 123, created_at: NOW.toISOString() })
    f.data.set('build_status_keys/a__two', { created_at: NOW.toISOString() })
    expect(await verifyStatusKey(f.db, 'a/one', 'bsk_AAAAAAAAAAAAAAAAAAAAAA')).toBeNull()
    expect(await verifyStatusKey(f.db, 'a/two', 'bsk_AAAAAAAAAAAAAAAAAAAAAA')).toBeNull()
  })
})

describe('revokeStatusKey', () => {
  it('deletes once, then reports false', async () => {
    const f = fakeDb()
    const { key } = await mintStatusKey(f.db, REPO, 'uid', NOW)
    expect(await revokeStatusKey(f.db, REPO)).toBe(true)
    expect(await verifyStatusKey(f.db, REPO, key)).toBeNull()
    expect(await revokeStatusKey(f.db, REPO)).toBe(false)
  })
})

describe('getStatusKeyStatus', () => {
  it('reports absence, then dates, never the hash', async () => {
    const f = fakeDb()
    expect(await getStatusKeyStatus(f.db, REPO)).toEqual({
      exists: false,
      created_at: null,
      last_used_at: null,
    })
    await mintStatusKey(f.db, REPO, 'uid', NOW)
    const status = await getStatusKeyStatus(f.db, REPO)
    expect(status).toEqual({ exists: true, created_at: NOW.toISOString(), last_used_at: null })
    expect(JSON.stringify(status)).not.toContain('key_hash')
  })
})

describe('touchStatusKey', () => {
  const ago = (ms: number) => new Date(NOW.getTime() - ms).toISOString()

  it('updates when never used', async () => {
    const f = fakeDb()
    await mintStatusKey(f.db, REPO, 'uid', NOW)
    await touchStatusKey(f.db, REPO, null, NOW)
    expect(f.updates).toHaveLength(1)
    expect(f.updates[0].id).toBe('nicolovejoy__l6-music')
    expect(f.updates[0].fields).toEqual({ last_used_at: NOW.toISOString() })
  })

  it('writes nothing inside five minutes of the last use', async () => {
    const f = fakeDb()
    await mintStatusKey(f.db, REPO, 'uid', NOW)
    await touchStatusKey(f.db, REPO, ago(60 * 1000), NOW)
    expect(f.updates).toHaveLength(0)
  })

  it('writes when the last use is older than the window', async () => {
    const f = fakeDb()
    await mintStatusKey(f.db, REPO, 'uid', NOW)
    await touchStatusKey(f.db, REPO, ago(LAST_USED_THROTTLE_MS + 60 * 1000), NOW)
    expect(f.updates).toHaveLength(1)
  })

  it('resolves, never rejects, when the update fails, and logs no key material', async () => {
    const f = fakeDb()
    await mintStatusKey(f.db, REPO, 'uid', NOW)
    f.failUpdates()
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    await expect(touchStatusKey(f.db, REPO, null, NOW)).resolves.toBeUndefined()
    expect(warn).toHaveBeenCalled()
    expect(JSON.stringify(warn.mock.calls)).not.toContain('boom')
    warn.mockRestore()
  })
})
