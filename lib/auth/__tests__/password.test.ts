import { describe, it, expect } from 'vitest'
import { authErrorMessage, validatePassword } from '../password'

describe('validatePassword', () => {
  it('rejects passwords shorter than the minimum', () => {
    expect(validatePassword('short')).toMatch(/at least/i)
  })

  it('rejects empty/whitespace passwords', () => {
    expect(validatePassword('')).toMatch(/at least/i)
    expect(validatePassword('           ')).toMatch(/at least/i)
  })

  it('accepts a sufficiently long password', () => {
    expect(validatePassword('correct-horse-battery')).toBeNull()
  })

  it('accepts a password exactly at the minimum length', () => {
    expect(validatePassword('a'.repeat(8))).toBeNull()
  })
})

describe('authErrorMessage', () => {
  it('maps wrong-password / invalid-credential to a friendly message', () => {
    expect(authErrorMessage({ code: 'auth/wrong-password' })).toMatch(/incorrect|wrong|try again/i)
    expect(authErrorMessage({ code: 'auth/invalid-credential' })).toMatch(/incorrect|wrong|try again/i)
  })

  it('maps user-not-found to a message that does NOT leak account existence', () => {
    const msg = authErrorMessage({ code: 'auth/user-not-found' })
    // Same generic message as a bad password — never confirm the email exists.
    expect(msg).toBe(authErrorMessage({ code: 'auth/wrong-password' }))
  })

  it('maps too-many-requests to a rate-limit message', () => {
    expect(authErrorMessage({ code: 'auth/too-many-requests' })).toMatch(/too many|later/i)
  })

  it('maps requires-recent-login for set-password', () => {
    expect(authErrorMessage({ code: 'auth/requires-recent-login' })).toMatch(/sign in again/i)
  })

  it('maps provider-already-linked when a password already exists', () => {
    expect(authErrorMessage({ code: 'auth/provider-already-linked' })).toMatch(/already/i)
    expect(authErrorMessage({ code: 'auth/credential-already-in-use' })).toMatch(/already/i)
  })

  it('maps weak-password', () => {
    expect(authErrorMessage({ code: 'auth/weak-password' })).toMatch(/weak|at least/i)
  })

  it('maps invalid-email', () => {
    expect(authErrorMessage({ code: 'auth/invalid-email' })).toMatch(/valid email/i)
  })

  it('maps operation-not-allowed (provider not enabled) to a clear message', () => {
    expect(authErrorMessage({ code: 'auth/operation-not-allowed' })).toMatch(/not (yet )?enabled|not available/i)
  })

  it('falls back to a generic message for unknown codes', () => {
    expect(authErrorMessage({ code: 'auth/something-new' })).toMatch(/went wrong|try again/i)
  })

  it('handles a plain Error with no code', () => {
    expect(authErrorMessage(new Error('boom'))).toMatch(/went wrong|try again/i)
  })

  it('handles null/undefined', () => {
    expect(authErrorMessage(null)).toMatch(/went wrong|try again/i)
    expect(authErrorMessage(undefined)).toMatch(/went wrong|try again/i)
  })
})
