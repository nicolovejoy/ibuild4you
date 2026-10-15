// Pure helpers for the email/password auth flow (#104).
// No Firebase imports here so this stays trivially unit-testable; the UI layers
// (login page, user menu) call the Firebase SDK and pipe errors through authErrorMessage.

import type { Locale } from '@/lib/locale'

export const MIN_PASSWORD_LENGTH = 8

/**
 * Validate a password before handing it to Firebase. Returns an error string to
 * show the user, or null when the password is acceptable.
 */
export function validatePassword(password: string, locale: Locale = 'en'): string | null {
  if (password.trim().length < MIN_PASSWORD_LENGTH) {
    return locale === 'fr'
      ? `Le mot de passe doit contenir au moins ${MIN_PASSWORD_LENGTH} caractères.`
      : `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`
  }
  return null
}

// Bad-credential codes collapse to one message so we never confirm whether an
// email has an account (user-not-found and wrong-password look identical).
const TEXT = {
  en: {
    generic: 'Something went wrong. Please try again.',
    badCredential: 'Email or password is incorrect. Please try again.',
    disabled: 'This account has been disabled.',
    tooMany: 'Too many attempts. Please wait a moment and try again later.',
    recentLogin: 'For security, please sign in again before changing your password.',
    alreadySet: 'A password is already set for this account. Use “Forgot password?” to reset it.',
    weak: `Password is too weak — use at least ${MIN_PASSWORD_LENGTH} characters.`,
    invalidEmail: 'Please enter a valid email address.',
    notAllowed: 'Password sign-in is not yet enabled. Please use Google for now.',
    missingEmail: 'Please enter your email address.',
    network: 'Network error. Check your connection and try again.',
  },
  fr: {
    generic: 'Une erreur s’est produite. Veuillez réessayer.',
    badCredential: 'E-mail ou mot de passe incorrect. Veuillez réessayer.',
    disabled: 'Ce compte a été désactivé.',
    tooMany: 'Trop de tentatives. Patientez un moment puis réessayez.',
    recentLogin: 'Par sécurité, reconnectez-vous avant de changer votre mot de passe.',
    alreadySet: 'Un mot de passe existe déjà pour ce compte. Utilisez « Mot de passe oublié ? » pour le réinitialiser.',
    weak: `Mot de passe trop faible : utilisez au moins ${MIN_PASSWORD_LENGTH} caractères.`,
    invalidEmail: 'Veuillez saisir une adresse e-mail valide.',
    notAllowed: 'La connexion par mot de passe n’est pas encore activée. Utilisez Google pour le moment.',
    missingEmail: 'Veuillez saisir votre adresse e-mail.',
    network: 'Erreur réseau. Vérifiez votre connexion et réessayez.',
  },
} satisfies Record<Locale, Record<string, string>>

const CODE_TO_KEY: Record<string, keyof (typeof TEXT)['en']> = {
  'auth/wrong-password': 'badCredential',
  'auth/invalid-credential': 'badCredential',
  'auth/invalid-login-credentials': 'badCredential',
  'auth/user-not-found': 'badCredential',
  'auth/user-disabled': 'disabled',
  'auth/too-many-requests': 'tooMany',
  'auth/requires-recent-login': 'recentLogin',
  'auth/provider-already-linked': 'alreadySet',
  'auth/credential-already-in-use': 'alreadySet',
  'auth/email-already-in-use': 'alreadySet',
  'auth/weak-password': 'weak',
  'auth/invalid-email': 'invalidEmail',
  'auth/operation-not-allowed': 'notAllowed',
  'auth/missing-email': 'missingEmail',
  'auth/network-request-failed': 'network',
}

/**
 * Map a Firebase Auth error (or anything thrown) to a friendly, non-leaky message.
 */
export function authErrorMessage(err: unknown, locale: Locale = 'en'): string {
  const code =
    err && typeof err === 'object' && 'code' in err
      ? String((err as { code: unknown }).code)
      : ''
  return TEXT[locale][CODE_TO_KEY[code] ?? 'generic']
}
