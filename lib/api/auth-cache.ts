import type { SystemRole } from '@/lib/types'
import type { CachedUserData } from './firebase-server-helpers'

// Module-scoped cache for the users/<uid> doc. Fluid Compute reuses warm
// instances so this Map survives across requests on the same instance and
// eliminates most repeat reads from the same logged-in user.
//
// Set AUTH_CACHE_TTL_MS=0 (env) as a kill switch — every call becomes a miss.

type CacheEntry = {
  systemRoles: SystemRole[]
  userData: CachedUserData | null
  expiresAt: number
}

const DEFAULT_TTL_MS = 45_000
const MAX_ENTRIES = 500

const cache = new Map<string, CacheEntry>()

function ttlMs(): number {
  const raw = process.env.AUTH_CACHE_TTL_MS
  if (raw === undefined) return DEFAULT_TTL_MS
  const n = Number(raw)
  return Number.isFinite(n) && n >= 0 ? n : DEFAULT_TTL_MS
}

export function getCachedUser(uid: string): Omit<CacheEntry, 'expiresAt'> | null {
  if (ttlMs() === 0) return null
  const entry = cache.get(uid)
  if (!entry) return null
  if (entry.expiresAt <= Date.now()) {
    cache.delete(uid)
    return null
  }
  return { systemRoles: entry.systemRoles, userData: entry.userData }
}

export function setCachedUser(
  uid: string,
  value: { systemRoles: SystemRole[]; userData: CachedUserData | null }
): void {
  const ttl = ttlMs()
  if (ttl === 0) return
  // FIFO eviction once we hit the cap. Map iteration is insertion-ordered, so
  // the first key returned is the oldest. Cheap enough for the size we cap at.
  if (cache.size >= MAX_ENTRIES) {
    const oldest = cache.keys().next().value
    if (oldest !== undefined) cache.delete(oldest)
  }
  cache.set(uid, {
    systemRoles: value.systemRoles,
    userData: value.userData,
    expiresAt: Date.now() + ttl,
  })
}

export function invalidateUser(uid: string): void {
  cache.delete(uid)
}

// Test-only: clear everything. Not exported via index.
export function _resetAuthCache(): void {
  cache.clear()
}
