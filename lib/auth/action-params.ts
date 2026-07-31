// Pure parsing for the /auth/action page's query string.
//
// These params arrive from a link in an email, so they're untrusted: anyone who
// can put a link in front of a user controls them. No Firebase imports here so
// this stays trivially unit-testable.

export type ActionMode = 'resetPassword' | 'verifyEmail' | 'recoverEmail'

const MODES: ActionMode[] = ['resetPassword', 'verifyEmail', 'recoverEmail']

// Where we send people when continueUrl is missing or untrustworthy.
export const DEFAULT_CONTINUE_PATH = '/auth/login'

export function parseActionMode(raw: string | null | undefined): ActionMode | null {
  if (!raw) return null
  return (MODES as string[]).includes(raw) ? (raw as ActionMode) : null
}

/**
 * Open-redirect guard for Firebase's `continueUrl`.
 *
 * Only same-origin destinations survive; everything else collapses to our own
 * login page. Resolving against `origin` means a bare path like "/dashboard"
 * works, while "//evil.example.com" — which resolves to a *different* origin
 * rather than a path — does not.
 */
export function safeContinueUrl(raw: string | null | undefined, origin: string): string {
  const fallback = `${origin}${DEFAULT_CONTINUE_PATH}`
  if (!raw) return fallback

  // Must look like a path or an absolute http(s) URL. Without this, `new URL`
  // happily resolves free text ("not a url") into a same-origin 404 — safe,
  // but a poor place to land someone who just set a password.
  if (!raw.startsWith('/') && !/^https?:\/\//i.test(raw)) return fallback

  let parsed: URL
  try {
    parsed = new URL(raw, origin)
  } catch {
    return fallback
  }

  // Blocks javascript:, data:, and anything else exotic.
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return fallback
  // Exact origin match — a lookalike like "ibuild4you.com.evil.example.com" is
  // a different origin and fails here.
  if (parsed.origin !== origin) return fallback

  return parsed.toString()
}
