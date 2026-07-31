import { describe, it, expect } from 'vitest'
import { rewriteActionLink } from '../rewrite-action-link'

// Firebase's generatePasswordResetLink() returns a link to ITS hosted handler
// on <project>.firebaseapp.com. We host our own handler at /auth/action, so we
// swap the origin and path and keep the query — oobCode is the only part that
// carries state, and it's project-scoped, not host-scoped.
//
// Doing it here rather than via the console's "customize action URL" is
// deliberate: that setting refuses to save for a project not served by Firebase
// Hosting (we're on Vercel), and it would only cover Firebase-sent mail anyway.
// We send every one of these emails ourselves.

const FIREBASE_LINK =
  'https://ibuild4you-a0c4d.firebaseapp.com/__/auth/action' +
  '?mode=resetPassword&oobCode=ABC123&apiKey=AIzaFake&continueUrl=https%3A%2F%2Fibuild4you.com%2Fauth%2Flogin&lang=en'

describe('rewriteActionLink', () => {
  it('points the link at our own handler', () => {
    const out = rewriteActionLink(FIREBASE_LINK, 'https://ibuild4you.com')
    const url = new URL(out)
    expect(url.origin).toBe('https://ibuild4you.com')
    expect(url.pathname).toBe('/auth/action')
  })

  it('preserves the oobCode exactly — it is the whole payload', () => {
    const url = new URL(rewriteActionLink(FIREBASE_LINK, 'https://ibuild4you.com'))
    expect(url.searchParams.get('oobCode')).toBe('ABC123')
  })

  it('preserves mode and continueUrl', () => {
    const url = new URL(rewriteActionLink(FIREBASE_LINK, 'https://ibuild4you.com'))
    expect(url.searchParams.get('mode')).toBe('resetPassword')
    expect(url.searchParams.get('continueUrl')).toBe('https://ibuild4you.com/auth/login')
  })

  it('targets the preview host when that is the app origin', () => {
    const url = new URL(rewriteActionLink(FIREBASE_LINK, 'https://preview.ibuild4you.com'))
    expect(url.origin).toBe('https://preview.ibuild4you.com')
    expect(url.pathname).toBe('/auth/action')
    // The code is minted against the preview Firebase project, so it must ride along.
    expect(url.searchParams.get('oobCode')).toBe('ABC123')
  })

  it('tolerates a trailing slash on the origin', () => {
    const url = new URL(rewriteActionLink(FIREBASE_LINK, 'https://ibuild4you.com/'))
    expect(url.origin).toBe('https://ibuild4you.com')
    expect(url.pathname).toBe('/auth/action')
  })

  it('returns the original link unchanged when it cannot be parsed', () => {
    // Better a Firebase-hosted page than a broken link: the user can still
    // reset, they just lose the password-manager benefit.
    expect(rewriteActionLink('not a url', 'https://ibuild4you.com')).toBe('not a url')
  })

  it('returns the original link when the origin is unusable', () => {
    expect(rewriteActionLink(FIREBASE_LINK, 'nonsense')).toBe(FIREBASE_LINK)
  })

  it('is idempotent — rewriting an already-rewritten link changes nothing', () => {
    const once = rewriteActionLink(FIREBASE_LINK, 'https://ibuild4you.com')
    expect(rewriteActionLink(once, 'https://ibuild4you.com')).toBe(once)
  })
})
