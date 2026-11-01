// Loop read API: sender tags, pagination cursors and per-app read keys.
// Hosts read their own app's feedback, but never see emails: each sender is a
// short per-app tag. Pure, no I/O; the route loads the secret and stored hash.

import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import { normalizeEmail } from '@/lib/email/normalize'

export const READ_KEY_PREFIX = 'lrk_'

// "Sender 3fa9": stable for one person within one app, not linkable across
// apps or reversible without the secret. Four hex chars are for telling
// senders apart in a list, not for security.
export function senderTag(secret: string, slug: string, email: string | null | undefined): string {
  const normalized = normalizeEmail(email)
  if (!normalized) return 'anonymous'
  const digest = createHmac('sha256', secret).update(`${slug}\n${normalized}`).digest('hex')
  return `Sender ${digest.slice(0, 4)}`
}

export function encodeCursor(createdAt: string): string {
  return Buffer.from(JSON.stringify({ c: createdAt })).toString('base64url')
}

// Returns the created_at the cursor points at, or null if it is not one of ours.
export function decodeCursor(cursor: string): string | null {
  try {
    const parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'))
    const c = parsed?.c
    if (typeof c !== 'string' || Number.isNaN(Date.parse(c))) return null
    return c
  } catch {
    return null
  }
}

export function generateReadKey(): string {
  return READ_KEY_PREFIX + randomBytes(16).toString('base64url')
}

export function hashReadKey(key: string): string {
  return createHash('sha256').update(key).digest('hex')
}

export function readKeyMatches(presented: string, storedHashHex: string): boolean {
  const a = createHash('sha256').update(presented).digest()
  const b = Buffer.from(storedHashHex, 'hex')
  // Comparing digests keeps both sides 32 bytes, so timingSafeEqual cannot throw.
  if (a.length !== 32 || b.length !== 32) return false
  return timingSafeEqual(a, b)
}
