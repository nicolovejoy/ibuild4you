import { describe, it, expect } from 'vitest'
import { createHmac } from 'node:crypto'
import { signIdentityAssertion, verifyIdentityAssertion } from '../identity'

const NOW = 1_800_000_000 // arbitrary fixed unix seconds
const SECRET_K1 = 'secret-k1-32-bytes-of-randomness'
const SECRET_K2 = 'secret-k2-different-randomness!!'

function makePayload(overrides: Partial<Parameters<typeof signIdentityAssertion>[0]> = {}) {
  return {
    v: 1 as const,
    email: 'Sam@Example.com',
    project: 'sample-cafe',
    ts: NOW,
    kid: 'k1',
    ...overrides,
  }
}

describe('signIdentityAssertion / verifyIdentityAssertion', () => {
  it('round-trips a valid token', () => {
    const token = signIdentityAssertion(makePayload(), SECRET_K1)
    const result = verifyIdentityAssertion(token, { k1: SECRET_K1 }, 'k1', NOW)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.email).toBe('sam@example.com') // normalized
      expect(result.kid).toBe('k1')
      expect(result.project).toBe('sample-cafe')
    }
  })

  it('rejects a tampered payload (signature no longer matches)', () => {
    const token = signIdentityAssertion(makePayload(), SECRET_K1)
    const [payloadB64url, sig] = token.split('.')
    const tamperedPayload = JSON.parse(Buffer.from(payloadB64url, 'base64url').toString('utf8'))
    tamperedPayload.email = 'attacker@evil.com'
    const tamperedB64url = Buffer.from(JSON.stringify(tamperedPayload)).toString('base64url')
    const tamperedToken = `${tamperedB64url}.${sig}`
    const result = verifyIdentityAssertion(tamperedToken, { k1: SECRET_K1 }, 'k1', NOW)
    expect(result.ok).toBe(false)
  })

  it('rejects a tampered signature', () => {
    const token = signIdentityAssertion(makePayload(), SECRET_K1)
    const [payloadB64url] = token.split('.')
    const tampered = `${payloadB64url}.${'A'.repeat(43)}`
    const result = verifyIdentityAssertion(tampered, { k1: SECRET_K1 }, 'k1', NOW)
    expect(result.ok).toBe(false)
  })

  it('rejects a token signed with the wrong secret', () => {
    const token = signIdentityAssertion(makePayload(), 'wrong-secret-entirely-different')
    const result = verifyIdentityAssertion(token, { k1: SECRET_K1 }, 'k1', NOW)
    expect(result.ok).toBe(false)
  })

  it('rejects an expired token (older than 12h)', () => {
    const token = signIdentityAssertion(makePayload({ ts: NOW - 12 * 60 * 60 - 1 }), SECRET_K1)
    const result = verifyIdentityAssertion(token, { k1: SECRET_K1 }, 'k1', NOW)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toMatch(/old/)
  })

  it('accepts a token right at the 12h boundary', () => {
    const token = signIdentityAssertion(makePayload({ ts: NOW - 12 * 60 * 60 }), SECRET_K1)
    const result = verifyIdentityAssertion(token, { k1: SECRET_K1 }, 'k1', NOW)
    expect(result.ok).toBe(true)
  })

  it('rejects a token with ts too far in the future (beyond 60s skew)', () => {
    const token = signIdentityAssertion(makePayload({ ts: NOW + 61 }), SECRET_K1)
    const result = verifyIdentityAssertion(token, { k1: SECRET_K1 }, 'k1', NOW)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toMatch(/future/)
  })

  it('accepts a token within the 60s future skew', () => {
    const token = signIdentityAssertion(makePayload({ ts: NOW + 60 }), SECRET_K1)
    const result = verifyIdentityAssertion(token, { k1: SECRET_K1 }, 'k1', NOW)
    expect(result.ok).toBe(true)
  })

  it('rejects an unsupported version', () => {
    const token = signIdentityAssertion(makePayload({ v: 2 as unknown as 1 }), SECRET_K1)
    const result = verifyIdentityAssertion(token, { k1: SECRET_K1 }, 'k1', NOW)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toMatch(/version/)
  })

  it('selects the key by the kid embedded in the token', () => {
    const token = signIdentityAssertion(makePayload({ kid: 'k2' }), SECRET_K2)
    const result = verifyIdentityAssertion(token, { k1: SECRET_K1, k2: SECRET_K2 }, 'k1', NOW)
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.kid).toBe('k2')
  })

  it('falls back to activeKid when the token has no kid field', () => {
    const payload = makePayload()
    delete (payload as { kid?: string }).kid
    const payloadB64url = Buffer.from(JSON.stringify(payload)).toString('base64url')
    const sig = createHmac('sha256', SECRET_K1).update(payloadB64url, 'utf8').digest('base64url')
    const token = `${payloadB64url}.${sig}`
    const result = verifyIdentityAssertion(token, { k1: SECRET_K1 }, 'k1', NOW)
    expect(result.ok).toBe(true)
  })

  it('rejects an unknown kid', () => {
    const token = signIdentityAssertion(makePayload({ kid: 'k9' }), SECRET_K1)
    const result = verifyIdentityAssertion(token, { k1: SECRET_K1 }, 'k1', NOW)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toMatch(/kid/)
  })

  it('supports rotation overlap: old (k1) and new (k2) tokens both verify', () => {
    const oldToken = signIdentityAssertion(makePayload({ kid: 'k1' }), SECRET_K1)
    const newToken = signIdentityAssertion(makePayload({ kid: 'k2' }), SECRET_K2)
    const keys = { k1: SECRET_K1, k2: SECRET_K2 }
    expect(verifyIdentityAssertion(oldToken, keys, 'k2', NOW).ok).toBe(true)
    expect(verifyIdentityAssertion(newToken, keys, 'k2', NOW).ok).toBe(true)
  })

  it('rejects a malformed token (no dot separator)', () => {
    const result = verifyIdentityAssertion('not-a-real-token', { k1: SECRET_K1 }, 'k1', NOW)
    expect(result.ok).toBe(false)
  })

  it('rejects an empty token', () => {
    const result = verifyIdentityAssertion('', { k1: SECRET_K1 }, 'k1', NOW)
    expect(result.ok).toBe(false)
  })

  it('rejects a payload missing project', () => {
    const token = signIdentityAssertion(
      { v: 1, email: 'sam@example.com', ts: NOW, kid: 'k1' } as unknown as Parameters<
        typeof signIdentityAssertion
      >[0],
      SECRET_K1
    )
    const result = verifyIdentityAssertion(token, { k1: SECRET_K1 }, 'k1', NOW)
    expect(result.ok).toBe(false)
  })
})
