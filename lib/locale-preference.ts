// Which language to show the viewer. Pure helpers (no DOM, no React) so they're
// unit-testable; components/locale-provider.tsx wires them to the browser.
//
// Resolution order (first supported value wins):
//   1. `?lang=` on the URL — an explicit link (e.g. from a French email)
//   2. users.locale — the signed-in viewer's saved choice (EN/FR toggle)
//   3. the `locale` cookie — set by visiting /fr pages and by the toggle, so a
//      signed-out visitor stays in French through sign-in
//   4. the current brief's language — a first-time arrival via a brief link
//   5. English

import { isLocale, DEFAULT_LOCALE, type Locale } from './locale'

export const LOCALE_COOKIE = 'locale'
const ONE_YEAR_S = 60 * 60 * 24 * 365

/** Parse the locale cookie out of a `document.cookie` string. */
export function readLocaleCookie(cookieString: string): Locale | null {
  for (const part of cookieString.split(';')) {
    const [name, value] = part.trim().split('=')
    if (name === LOCALE_COOKIE) return isLocale(value) ? value : null
  }
  return null
}

/** A `document.cookie` assignment that remembers the locale site-wide for a year. */
export function localeCookie(locale: Locale): string {
  return `${LOCALE_COOKIE}=${locale}; Path=/; Max-Age=${ONE_YEAR_S}; SameSite=Lax`
}

export function resolveLocale(sources: {
  query?: unknown
  user?: unknown
  cookie?: unknown
  brief?: unknown
}): Locale {
  for (const value of [sources.query, sources.user, sources.cookie, sources.brief]) {
    if (isLocale(value)) return value
  }
  return DEFAULT_LOCALE
}
