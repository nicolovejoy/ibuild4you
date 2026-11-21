import { randomBytes } from 'node:crypto'
import type { Firestore } from 'firebase-admin/firestore'
import type { ReadKeyStatus } from '@/lib/types'
import { hashReadKey, readKeyMatches } from '@/lib/feedback/read-crypto'
import { LAST_USED_THROTTLE_MS } from '@/lib/feedback/read-keys'
import { fullRepo } from '@/lib/github/repo'

// fullRepo lives with the other repo helpers (the Settings tab uses it too);
// re-exported here because every key caller needs it.
export { fullRepo }

// =============================================================================
// Per-repo status keys for the build status return leg. One doc per repo in
// build_status_keys, id == the repo with "/" swapped for "__". Same shape as
// the Loop read keys (lib/feedback/read-keys.ts): only the SHA-256 hash is
// stored, the key is shown once at mint, minting again rotates, deleting
// revokes. A status key can add a report and nothing else.
// =============================================================================

export const STATUS_KEYS_COLLECTION = 'build_status_keys'
export const STATUS_KEY_PREFIX = 'bsk_'

interface StatusKeyDoc {
  repo: string
  key_hash: string
  created_at: string
  created_by: string
  last_used_at?: string
}

// Firestore doc ids cannot contain "/". Callers pass a fullRepo() result.
export function repoKeyId(repo: string): string {
  return repo.replace('/', '__')
}

function keyRef(db: Firestore, repo: string) {
  return db.collection(STATUS_KEYS_COLLECTION).doc(repoKeyId(repo))
}

export async function mintStatusKey(
  db: Firestore,
  repo: string,
  actorUid: string,
  now: Date = new Date()
): Promise<{ key: string; created_at: string; rotated: boolean }> {
  const ref = keyRef(db, repo)
  const rotated = (await ref.get()).exists
  const key = STATUS_KEY_PREFIX + randomBytes(16).toString('base64url')
  const created_at = now.toISOString()
  const doc: StatusKeyDoc = {
    repo,
    key_hash: hashReadKey(key),
    created_at,
    created_by: actorUid,
  }
  // set() replaces the whole doc, so a rotated key starts with no last_used_at.
  await ref.set(doc)
  return { key, created_at, rotated }
}

// True if a key existed and was removed.
export async function revokeStatusKey(db: Firestore, repo: string): Promise<boolean> {
  const ref = keyRef(db, repo)
  if (!(await ref.get()).exists) return false
  await ref.delete()
  return true
}

// Never includes the hash.
export async function getStatusKeyStatus(db: Firestore, repo: string): Promise<ReadKeyStatus> {
  const snap = await keyRef(db, repo).get()
  if (!snap.exists) return { exists: false, created_at: null, last_used_at: null }
  const data = snap.data() as StatusKeyDoc
  return {
    exists: true,
    created_at: data.created_at ?? null,
    last_used_at: data.last_used_at ?? null,
  }
}

// null when the repo has no key or the presented one does not match.
export async function verifyStatusKey(
  db: Firestore,
  repo: string,
  presented: string
): Promise<{ last_used_at: string | null } | null> {
  const snap = await keyRef(db, repo).get()
  if (!snap.exists) return null
  const data = snap.data() as Partial<StatusKeyDoc> | undefined
  // A malformed doc (no string hash) is treated as no key, never a throw.
  if (typeof data?.key_hash !== 'string') return null
  if (!readKeyMatches(presented, data.key_hash)) return null
  return { last_used_at: data.last_used_at ?? null }
}

// last_used_at is a hint for admins, not a log: write it at most every five
// minutes. A failed write must never fail the report it rode along with, so the
// returned promise never rejects. Logs the repo only, never key material.
export function touchStatusKey(
  db: Firestore,
  repo: string,
  lastUsedAt: string | null,
  now: Date = new Date()
): Promise<void> {
  if (lastUsedAt !== null && now.getTime() - Date.parse(lastUsedAt) < LAST_USED_THROTTLE_MS) {
    return Promise.resolve()
  }
  return keyRef(db, repo)
    .update({ last_used_at: now.toISOString() })
    .then(
      () => undefined,
      () => console.warn('[build-status] could not record last_used_at', { repo })
    )
}
