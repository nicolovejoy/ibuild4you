import { describe, it, expect } from 'vitest'
import { parseActionMode, safeContinueUrl, DEFAULT_CONTINUE_PATH } from '../action-params'

// Query params on /auth/action come straight from a link in an email, so both
// helpers treat them as untrusted input. safeContinueUrl in particular is an
// open-redirect guard: continueUrl is attacker-controllable by anyone who can
// get a link in front of a user.

describe('parseActionMode', () => {
  it('recognizes the modes Firebase can send', () => {
    expect(parseActionMode('resetPassword')).toBe('resetPassword')
    expect(parseActionMode('verifyEmail')).toBe('verifyEmail')
    expect(parseActionMode('recoverEmail')).toBe('recoverEmail')
  })

  it('returns null for anything else, including junk and empties', () => {
    expect(parseActionMode('signIn')).toBeNull()
    expect(parseActionMode('')).toBeNull()
    expect(parseActionMode(null)).toBeNull()
    expect(parseActionMode('RESETPASSWORD')).toBeNull()
  })
})

describe('safeContinueUrl', () => {
  const origin = 'https://ibuild4you.com'

  it('keeps a same-origin URL', () => {
    expect(safeContinueUrl('https://ibuild4you.com/auth/login', origin)).toBe(
      'https://ibuild4you.com/auth/login'
    )
  })

  it('keeps a same-origin URL with a path and query', () => {
    expect(safeContinueUrl('https://ibuild4you.com/projects/abc?tab=brief', origin)).toBe(
      'https://ibuild4you.com/projects/abc?tab=brief'
    )
  })

  it('rejects a different host — the open-redirect case', () => {
    expect(safeContinueUrl('https://evil.example.com/phish', origin)).toBe(
      `${origin}${DEFAULT_CONTINUE_PATH}`
    )
  })

  it('rejects a lookalike subdomain', () => {
    expect(safeContinueUrl('https://ibuild4you.com.evil.example.com/', origin)).toBe(
      `${origin}${DEFAULT_CONTINUE_PATH}`
    )
  })

  it('rejects a protocol-relative URL that would leave the origin', () => {
    expect(safeContinueUrl('//evil.example.com/phish', origin)).toBe(
      `${origin}${DEFAULT_CONTINUE_PATH}`
    )
  })

  it('rejects javascript: and data: schemes', () => {
    expect(safeContinueUrl('javascript:alert(1)', origin)).toBe(`${origin}${DEFAULT_CONTINUE_PATH}`)
    expect(safeContinueUrl('data:text/html,<script>', origin)).toBe(
      `${origin}${DEFAULT_CONTINUE_PATH}`
    )
  })

  it('falls back for missing or unparseable input', () => {
    expect(safeContinueUrl(null, origin)).toBe(`${origin}${DEFAULT_CONTINUE_PATH}`)
    expect(safeContinueUrl('', origin)).toBe(`${origin}${DEFAULT_CONTINUE_PATH}`)
    expect(safeContinueUrl('not a url', origin)).toBe(`${origin}${DEFAULT_CONTINUE_PATH}`)
  })

  it('accepts a bare same-origin path', () => {
    expect(safeContinueUrl('/dashboard', origin)).toBe('https://ibuild4you.com/dashboard')
  })
})
