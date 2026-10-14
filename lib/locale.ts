// Supported languages. Safe to import from server and client code.
//
// A brief has a `language` (projects.language) — the language the maker is
// addressed in and its link previews are shown in. The brief document itself
// always stays in English for the builder.

export type Locale = 'en' | 'fr'

export const LOCALES: readonly Locale[] = ['en', 'fr']

export const DEFAULT_LOCALE: Locale = 'en'

export function isLocale(value: unknown): value is Locale {
  return typeof value === 'string' && (LOCALES as readonly string[]).includes(value)
}

/** English name of a language, for prompts ("French"). */
export const LOCALE_NAMES: Record<Locale, string> = { en: 'English', fr: 'French' }

/** Normalise any stored/unknown value to a supported locale (default English). */
export function toLocale(value: unknown): Locale {
  return isLocale(value) ? value : DEFAULT_LOCALE
}
