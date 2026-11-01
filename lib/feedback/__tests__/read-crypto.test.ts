import { describe, it, expect } from 'vitest'
import { createHmac } from 'node:crypto'
import {
  senderTag,
  encodeCursor,
  decodeCursor,
  generateReadKey,
  hashReadKey,
  readKeyMatches,
  READ_KEY_PREFIX,
} from '../read-crypto'

const b64 = (s: string) => Buffer.from(s).toString('base64url')

describe('senderTag', () => {
  it('is an HMAC of slug + normalized email, shortened', () => {
    const expected =
      'Sender ' +
      createHmac('sha256', 's3cret').update('byside\nsam@x.com').digest('hex').slice(0, 4)
    expect(senderTag('s3cret', 'byside', 'Sam@X.com ')).toBe(expected)
    expect(expected).toMatch(/^Sender [0-9a-f]{4}$/)
  })
  it('is stable across email casing', () => {
    expect(senderTag('s', 'byside', 'Sam@X.com')).toBe(senderTag('s', 'byside', 'sam@x.com'))
  })
  it('differs per app', () => {
    // Different slugs hash different input; 4 hex chars could collide, so use a fixed pair.
    expect(senderTag('s3cret', 'byside', 'sam@x.com')).not.toBe(
      senderTag('s3cret', 'prntd', 'sam@x.com')
    )
  })
  it('is anonymous without an email', () => {
    expect(senderTag('s', 'byside', null)).toBe('anonymous')
    expect(senderTag('s', 'byside', '')).toBe('anonymous')
    expect(senderTag('s', 'byside', '   ')).toBe('anonymous')
  })
})

describe('cursor', () => {
  it('round-trips', () => {
    const c = '2026-10-31T12:00:00.000Z'
    expect(decodeCursor(encodeCursor(c))).toBe(c)
  })
  it.each([['!!!'], [''], [b64('{"c":5}')], [b64('not json')], [b64('{"c":"nope"}')]])(
    'rejects %s',
    (bad) => {
      expect(decodeCursor(bad)).toBeNull()
    }
  )
})

describe('read keys', () => {
  it('generates lrk_ keys', () => {
    const k = generateReadKey()
    expect(k.startsWith(READ_KEY_PREFIX)).toBe(true)
    expect(k).toMatch(/^lrk_[A-Za-z0-9_-]{22}$/)
    expect(generateReadKey()).not.toBe(k)
  })
  it('hashes deterministically to sha256 hex', () => {
    expect(hashReadKey('lrk_x')).toMatch(/^[0-9a-f]{64}$/)
    expect(hashReadKey('lrk_x')).toBe(hashReadKey('lrk_x'))
  })
  it('matches only the right key', () => {
    const k = generateReadKey()
    expect(readKeyMatches(k, hashReadKey(k))).toBe(true)
    expect(readKeyMatches(generateReadKey(), hashReadKey(k))).toBe(false)
    expect(readKeyMatches('', hashReadKey(k))).toBe(false)
  })
  it('returns false for a malformed stored hash', () => {
    expect(readKeyMatches('lrk_x', 'abc')).toBe(false)
    expect(readKeyMatches('lrk_x', '')).toBe(false)
  })
})
