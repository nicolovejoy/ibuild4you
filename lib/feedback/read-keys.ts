import type { Firestore } from 'firebase-admin/firestore'
import type { ReadKeyStatus } from '@/lib/types'
import { generateReadKey, hashReadKey, readKeyMatches } from './read-crypto'

// =============================================================================
// Per-app read keys for the Loop read API. One doc per app in loop_read_keys,
// id == app slug. Only the SHA-256 hash of the key is stored: the key itself is
// shown once at mint time and cannot be recovered, so a leaked database does
// not leak working keys. Minting again replaces the doc (rotation); deleting it
// revokes.
// =============================================================================

export const READ_KEYS_COLLECTION = 'loop_read_keys'

// last_used_at is a hint for admins, not a log: write it at most this often.
export const LAST_USED_THROTTLE_MS = 5 * 60 * 1000

interface ReadKeyDoc {
  key_hash: string
  created_at: string
  created_by: string
  last_used_at?: string
}

export async function mintReadKey(
  db: Firestore,
  slug: string,
  actorUid: string,
  now: Date = new Date()
): Promise<{ key: string; created_at: string; rotated: boolean }> {
  const ref = db.collection(READ_KEYS_COLLECTION).doc(slug)
  const rotated = (await ref.get()).exists
  const key = generateReadKey()
  const created_at = now.toISOString()
  const doc: ReadKeyDoc = { key_hash: hashReadKey(key), created_at, created_by: actorUid }
  // set() replaces the whole doc, so a rotated key starts with no last_used_at.
  await ref.set(doc)
  return { key, created_at, rotated }
}

// True if a key existed and was removed.
export async function revokeReadKey(db: Firestore, slug: string): Promise<boolean> {
  const ref = db.collection(READ_KEYS_COLLECTION).doc(slug)
  if (!(await ref.get()).exists) return false
  await ref.delete()
  return true
}

// Never includes the hash.
export async function getReadKeyStatus(db: Firestore, slug: string): Promise<ReadKeyStatus> {
  const snap = await db.collection(READ_KEYS_COLLECTION).doc(slug).get()
  if (!snap.exists) return { exists: false, created_at: null, last_used_at: null }
  const data = snap.data() as ReadKeyDoc
  return {
    exists: true,
    created_at: data.created_at ?? null,
    last_used_at: data.last_used_at ?? null,
  }
}

// null when the app has no key or the presented one does not match.
export async function verifyReadKey(
  db: Firestore,
  slug: string,
  presented: string
): Promise<{ last_used_at: string | null } | null> {
  const snap = await db.collection(READ_KEYS_COLLECTION).doc(slug).get()
  if (!snap.exists) return null
  const data = snap.data() as Partial<ReadKeyDoc> | undefined
  // A malformed doc (no string hash) is treated as no key, never a throw.
  if (typeof data?.key_hash !== 'string') return null
  if (!readKeyMatches(presented, data.key_hash)) return null
  return { last_used_at: data.last_used_at ?? null }
}

// A failed write must never fail the read it rode along with: the returned
// promise never rejects. Returned (not floated) so the route can hand it to
// after() and keep the function alive until the write settles.
export function touchReadKey(
  db: Firestore,
  slug: string,
  lastUsedAt: string | null,
  now: Date = new Date()
): Promise<void> {
  if (lastUsedAt !== null && now.getTime() - Date.parse(lastUsedAt) < LAST_USED_THROTTLE_MS) {
    return Promise.resolve()
  }
  return db
    .collection(READ_KEYS_COLLECTION)
    .doc(slug)
    .update({ last_used_at: now.toISOString() })
    .then(
      () => undefined,
      () => console.warn('[loop-read] could not record last_used_at', { slug })
    )
}
