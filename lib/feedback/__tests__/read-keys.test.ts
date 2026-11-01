import { describe, it, expect, vi } from 'vitest'
import type { Firestore } from 'firebase-admin/firestore'
import { hashReadKey } from '../read-crypto'
import {
  READ_KEYS_COLLECTION,
  LAST_USED_THROTTLE_MS,
  mintReadKey,
  revokeReadKey,
  getReadKeyStatus,
  verifyReadKey,
  touchReadKey,
} from '../read-keys'

type Doc = Record<string, unknown>

// Small in-memory Firestore: only the calls the store makes. Every collection
// name used is recorded so tests can assert the store stays in its own one.
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

const NOW = new Date('2026-10-31T12:00:00.000Z')

describe('mintReadKey', () => {
  it('stores only the hash, in loop_read_keys', async () => {
    const f = fakeDb()
    const { key, created_at, rotated } = await mintReadKey(f.db, 'byside', 'uid1', NOW)
    expect(READ_KEYS_COLLECTION).toBe('loop_read_keys')
    expect([...f.collections]).toEqual(['loop_read_keys'])
    const stored = f.data.get('loop_read_keys/byside')!
    expect(stored.key_hash).toBe(hashReadKey(key))
    expect(stored.created_by).toBe('uid1')
    expect(stored.created_at).toBe(created_at)
    expect(created_at).toBe(NOW.toISOString())
    expect(JSON.stringify(stored)).not.toContain(key)
    expect(rotated).toBe(false)
  })

  it('rotating replaces the key and drops last_used_at', async () => {
    const f = fakeDb()
    const first = await mintReadKey(f.db, 'byside', 'uid1', NOW)
    await f.db
      .collection('loop_read_keys')
      .doc('byside')
      .update({ last_used_at: NOW.toISOString() })
    const second = await mintReadKey(f.db, 'byside', 'uid1', NOW)
    expect(second.rotated).toBe(true)
    expect(second.key).not.toBe(first.key)
    expect(await verifyReadKey(f.db, 'byside', first.key)).toBeNull()
    expect(await verifyReadKey(f.db, 'byside', second.key)).toEqual({ last_used_at: null })
  })
})

describe('verifyReadKey', () => {
  it('accepts the right key and rejects everything else', async () => {
    const f = fakeDb()
    const { key } = await mintReadKey(f.db, 'a', 'uid', NOW)
    await mintReadKey(f.db, 'b', 'uid', NOW)
    expect(await verifyReadKey(f.db, 'a', key)).toEqual({ last_used_at: null })
    expect(await verifyReadKey(f.db, 'a', key + 'x')).toBeNull()
    expect(await verifyReadKey(f.db, 'a', '')).toBeNull()
    expect(await verifyReadKey(f.db, 'a', 'short')).toBeNull()
    expect(await verifyReadKey(f.db, 'b', key)).toBeNull()
    expect(await verifyReadKey(f.db, 'nope', key)).toBeNull()
  })

  it('treats a doc without a string key_hash as no key, without throwing', async () => {
    const f = fakeDb()
    f.data.set('loop_read_keys/a', { key_hash: 123, created_at: NOW.toISOString() })
    f.data.set('loop_read_keys/b', { created_at: NOW.toISOString() })
    expect(await verifyReadKey(f.db, 'a', 'lrk_AAAAAAAAAAAAAAAAAAAAAA')).toBeNull()
    expect(await verifyReadKey(f.db, 'b', 'lrk_AAAAAAAAAAAAAAAAAAAAAA')).toBeNull()
  })
})

describe('revokeReadKey', () => {
  it('deletes once, then reports false', async () => {
    const f = fakeDb()
    const { key } = await mintReadKey(f.db, 'a', 'uid', NOW)
    expect(await revokeReadKey(f.db, 'a')).toBe(true)
    expect(await verifyReadKey(f.db, 'a', key)).toBeNull()
    expect(await revokeReadKey(f.db, 'a')).toBe(false)
  })
})

describe('getReadKeyStatus', () => {
  it('reports absence, then dates, never the hash', async () => {
    const f = fakeDb()
    expect(await getReadKeyStatus(f.db, 'a')).toEqual({
      exists: false,
      created_at: null,
      last_used_at: null,
    })
    await mintReadKey(f.db, 'a', 'uid', NOW)
    const status = await getReadKeyStatus(f.db, 'a')
    expect(status).toEqual({ exists: true, created_at: NOW.toISOString(), last_used_at: null })
    expect(JSON.stringify(status)).not.toContain('key_hash')
  })
})

describe('touchReadKey', () => {
  const ago = (ms: number) => new Date(NOW.getTime() - ms).toISOString()

  it('updates when never used', async () => {
    const f = fakeDb()
    await mintReadKey(f.db, 'a', 'uid', NOW)
    touchReadKey(f.db, 'a', null, NOW)
    await vi.waitFor(() => expect(f.updates).toHaveLength(1))
    expect(f.updates[0].fields).toEqual({ last_used_at: NOW.toISOString() })
  })

  it('skips when used under the throttle window ago', async () => {
    const f = fakeDb()
    await mintReadKey(f.db, 'a', 'uid', NOW)
    touchReadKey(f.db, 'a', ago(60 * 1000), NOW)
    await new Promise((r) => setTimeout(r, 10))
    expect(f.updates).toHaveLength(0)
  })

  it('updates when last use is older than the window', async () => {
    const f = fakeDb()
    await mintReadKey(f.db, 'a', 'uid', NOW)
    touchReadKey(f.db, 'a', ago(LAST_USED_THROTTLE_MS + 60 * 1000), NOW)
    await vi.waitFor(() => expect(f.updates).toHaveLength(1))
  })

  it('swallows a failed update', async () => {
    const f = fakeDb()
    await mintReadKey(f.db, 'a', 'uid', NOW)
    f.failUpdates()
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(() => touchReadKey(f.db, 'a', null, NOW)).not.toThrow()
    await vi.waitFor(() => expect(warn).toHaveBeenCalled())
    expect(JSON.stringify(warn.mock.calls)).not.toContain('boom')
    warn.mockRestore()
  })

  it('returns a promise that settles after the write and never rejects', async () => {
    const f = fakeDb()
    await mintReadKey(f.db, 'a', 'uid', NOW)
    await touchReadKey(f.db, 'a', null, NOW)
    expect(f.updates).toHaveLength(1)

    f.failUpdates()
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    await expect(touchReadKey(f.db, 'a', null, NOW)).resolves.toBeUndefined()
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()

    await expect(touchReadKey(f.db, 'a', ago(60 * 1000), NOW)).resolves.toBeUndefined()
  })
})
