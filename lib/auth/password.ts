// Pure helpers for the email/password auth flow (#104).
// No Firebase imports here so this stays trivially unit-testable; the UI layers
// (login page, user menu) call the Firebase SDK and pipe errors through authErrorMessage.

export const MIN_PASSWORD_LENGTH = 8

/**
 * Validate a password before handing it to Firebase. Returns an error string to
 * show the user, or null when the password is acceptable.
 */
export function validatePassword(password: string): string | null {
  if (password.trim().length < MIN_PASSWORD_LENGTH) {
    return `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`
  }
  return null
}

const GENERIC = 'Something went wrong. Please try again.'

// Bad-credential codes collapse to one message so we never confirm whether an
// email has an account (user-not-found and wrong-password look identical).
const BAD_CREDENTIAL = 'Email or password is incorrect. Please try again.'

const MESSAGES: Record<string, string> = {
  'auth/wrong-password': BAD_CREDENTIAL,
  'auth/invalid-credential': BAD_CREDENTIAL,
  'auth/invalid-login-credentials': BAD_CREDENTIAL,
  'auth/user-not-found': BAD_CREDENTIAL,
  'auth/user-disabled': 'This account has been disabled.',
  'auth/too-many-requests': 'Too many attempts. Please wait a moment and try again later.',
  'auth/requires-recent-login': 'For security, please sign in again before changing your password.',
  'auth/provider-already-linked': 'A password is already set for this account. Use “Forgot password?” to reset it.',
  'auth/credential-already-in-use': 'A password is already set for this account. Use “Forgot password?” to reset it.',
  'auth/email-already-in-use': 'A password is already set for this account. Use “Forgot password?” to reset it.',
  'auth/weak-password': `Password is too weak — use at least ${MIN_PASSWORD_LENGTH} characters.`,
  'auth/invalid-email': 'Please enter a valid email address.',
  'auth/operation-not-allowed': 'Password sign-in is not yet enabled. Please use Google or a passcode for now.',
  'auth/missing-email': 'Please enter your email address.',
  'auth/network-request-failed': 'Network error. Check your connection and try again.',
}

/**
 * Map a Firebase Auth error (or anything thrown) to a friendly, non-leaky message.
 */
export function authErrorMessage(err: unknown): string {
  const code =
    err && typeof err === 'object' && 'code' in err
      ? String((err as { code: unknown }).code)
      : ''
  return MESSAGES[code] ?? GENERIC
}
