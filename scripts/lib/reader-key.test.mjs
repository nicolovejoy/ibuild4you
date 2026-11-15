import { describe, it, expect, vi } from 'vitest'
import { ReaderKeyError, parseServiceAccountKey, resolveReaderKey, safeToken } from './reader-key.mjs'

const GOOD = JSON.stringify({ client_email: 'ro@example.iam.gserviceaccount.com', private_key: 'PRIVATE-KEY-BODY' })

describe('parseServiceAccountKey', () => {
  it('returns the trimmed key when it has an email and a private key', () => {
    expect(parseServiceAccountKey(`\n${GOOD}\n`)).toBe(GOOD)
  })
  it.each([
    ['empty', ''],
    ['whitespace', '  \n'],
    ['not JSON', 'PRIVATE-KEY-BODY not json'],
    ['an array', '[]'],
    ['no private key', JSON.stringify({ client_email: 'a@b.c' })],
    ['empty private key', JSON.stringify({ client_email: 'a@b.c', private_key: '' })],
  ])('refuses %s without echoing the input', (_name, text) => {
    let err
    try { parseServiceAccountKey(text) } catch (e) { err = e }
    expect(err).toBeInstanceOf(ReaderKeyError)
    expect(err.message).not.toContain('PRIVATE-KEY-BODY')
    expect(err.message).not.toContain('a@b.c')
  })
})

describe('safeToken', () => {
  it('passes short token-like strings and numbers', () => {
    expect(safeToken('ENOENT')).toBe('ENOENT')
    expect(safeToken('exit-1_a')).toBe('exit-1_a')
    expect(safeToken(1)).toBe('1')
  })
  it.each([
    ['a message with spaces', 'op: not signed in'],
    ['a newline', 'A\nB'],
    ['too long', 'A'.repeat(41)],
    ['empty', ''],
    ['an object', { code: 'X' }],
    ['undefined', undefined],
    ['null', null],
  ])('refuses %s', (_name, v) => {
    expect(safeToken(v)).toBeNull()
  })
})

describe('resolveReaderKey', () => {
  it('uses the environment key and does not call 1Password', () => {
    const fetchFromOnePassword = vi.fn()
    expect(resolveReaderKey({ env: { FIREBASE_SERVICE_ACCOUNT_RO: GOOD }, fetchFromOnePassword })).toEqual({ key: GOOD, source: 'env' })
    expect(fetchFromOnePassword).not.toHaveBeenCalled()
  })
  it('fetches from 1Password when the environment has no key', () => {
    expect(resolveReaderKey({ env: {}, fetchFromOnePassword: () => GOOD })).toEqual({ key: GOOD, source: '1password' })
    expect(resolveReaderKey({ env: { FIREBASE_SERVICE_ACCOUNT_RO: '' }, fetchFromOnePassword: () => GOOD }).source).toBe('1password')
  })
  it('refuses an empty answer from 1Password', () => {
    expect(() => resolveReaderKey({ env: {}, fetchFromOnePassword: () => '' })).toThrow(ReaderKeyError)
  })
  it('turns a failed fetch into one safe line', () => {
    const boom = Object.assign(new Error('op: PRIVATE-KEY-BODY leaked in message'), { code: 'ENOENT', stderr: 'PRIVATE-KEY-BODY', stdout: 'PRIVATE-KEY-BODY' })
    let err
    try { resolveReaderKey({ env: {}, fetchFromOnePassword: () => { throw boom } }) } catch (e) { err = e }
    expect(err).toBeInstanceOf(ReaderKeyError)
    expect(err.message).toContain('1Password')
    expect(err.message).toContain('ENOENT')
    expect(err.message).not.toContain('PRIVATE-KEY-BODY')
    expect(err.message).not.toContain('\n')
  })
  it('reports an exit status when there is no code', () => {
    const boom = Object.assign(new Error('x'), { status: 1 })
    expect(() => resolveReaderKey({ env: {}, fetchFromOnePassword: () => { throw boom } })).toThrow(/1Password.*1/)
  })
  const failWith = (props) => {
    const boom = Object.assign(new Error('op: PRIVATE-KEY-BODY leaked'), { stderr: 'PRIVATE-KEY-BODY', stdout: 'PRIVATE-KEY-BODY' }, props)
    let err
    try { resolveReaderKey({ env: {}, fetchFromOnePassword: () => { throw boom } }) } catch (e) { err = e }
    expect(err).toBeInstanceOf(ReaderKeyError)
    expect(err.message).not.toContain('PRIVATE-KEY-BODY')
    expect(err.message).not.toContain('\n')
    return err.message
  }
  it('says the op CLI is missing on ENOENT', () => {
    const msg = failWith({ code: 'ENOENT' })
    expect(msg).toBe('could not get the read-only key from 1Password (ENOENT): the op CLI was not found on PATH.')
    expect(msg).toContain('not found on PATH')
  })
  it('mentions a missed Touch ID prompt on ETIMEDOUT', () => {
    const msg = failWith({ code: 'ETIMEDOUT' })
    expect(msg).toBe('could not get the read-only key from 1Password (ETIMEDOUT): no answer in time, a Touch ID prompt may have been missed. Reconnect the reader (/mcp) to retry.')
    expect(msg).toContain('Touch ID')
  })
  it('tells the person to check op sign-in for any other code', () => {
    const msg = failWith({ code: 'EACCES' })
    expect(msg).toBe('could not get the read-only key from 1Password (EACCES): check that op is signed in and that the document ibuild4you-firestore-ro is in the dev-secrets vault, then reconnect the reader (/mcp).')
    expect(msg).toContain('signed in')
  })
  it('tells the person to check op sign-in on an exit status', () => {
    const msg = failWith({ status: 1 })
    expect(msg).toContain('(exit status 1)')
    expect(msg).toContain('signed in')
  })
})
