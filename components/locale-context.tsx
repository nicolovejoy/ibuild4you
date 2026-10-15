'use client'

import { createContext, useContext, useEffect } from 'react'
import type { Locale } from '@/lib/locale'
import { makerCopy, type MakerCopy } from '@/lib/copy-maker'

// The locale context and its hooks. Kept free of Firebase/auth imports so any
// component (and its unit tests) can read the copy without initialising auth;
// components/locale-provider.tsx supplies the value.

export interface LocaleContextValue {
  /** What to render in: the page override if any, else the viewer's preference. */
  locale: Locale
  /** The viewer's preference, ignoring any page override. */
  preferredLocale: Locale
  /** Explicit choice (EN/FR toggle): cookie + saved to the profile when signed in. */
  setLocale: (locale: Locale) => void
  /** Visiting a language-specific public page: cookie only, never the profile. */
  rememberLocale: (locale: Locale) => void
  /** The brief page reports its language, used when nothing else decides. */
  setBriefLanguage: (locale: Locale | null) => void
  /** A language-specific public page pins the language while mounted. */
  setPageLocale: (locale: Locale | null) => void
}

export const LocaleContext = createContext<LocaleContextValue | null>(null)

const FALLBACK: LocaleContextValue = {
  locale: 'en',
  preferredLocale: 'en',
  setLocale: () => {},
  rememberLocale: () => {},
  setBriefLanguage: () => {},
  setPageLocale: () => {},
}

export function useLocale(): LocaleContextValue {
  return useContext(LocaleContext) ?? FALLBACK
}

/**
 * Pin a public page's language from its URL while it's mounted. Visiting a
 * French page also remembers French (cookie only) so the rest of the visit —
 * sign-in, dashboard — stays French.
 */
export function usePageLocale(locale: Locale) {
  const { setPageLocale, rememberLocale } = useContext(LocaleContext) ?? FALLBACK
  useEffect(() => {
    setPageLocale(locale)
    if (locale !== 'en') rememberLocale(locale)
    return () => setPageLocale(null)
  }, [locale, setPageLocale, rememberLocale])
}

/**
 * Rendered by the brief's server layout with the brief's language, so a viewer
 * arriving via a brief link (even signed out, on the way to sign-in) gets that
 * language when nothing stronger (saved choice, cookie) decides. Deliberately
 * not cleared on unmount: the redirect to sign-in should stay in it.
 */
export function BriefLanguageHint({ language }: { language: Locale }) {
  const { setBriefLanguage } = useContext(LocaleContext) ?? FALLBACK
  useEffect(() => {
    setBriefLanguage(language)
  }, [language, setBriefLanguage])
  return null
}

/** The maker copy for the viewer's language. */
export function useMakerCopy(): MakerCopy {
  return makerCopy[useLocale().locale]
}
