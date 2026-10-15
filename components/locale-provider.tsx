'use client'

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { useAuth } from '@/lib/hooks/useAuth'
import { useCurrentUser, useUpdateCurrentUser } from '@/lib/query/hooks'
import { localeCookie, readLocaleCookie, resolveLocale } from '@/lib/locale-preference'
import { isLocale, type Locale } from '@/lib/locale'
import { makerCopy, type MakerCopy } from '@/lib/copy-maker'

// The viewer's language for maker-facing screens. See lib/locale-preference.ts
// for the resolution order (?lang= → saved profile → cookie → brief → English).
// Public pages (/, /about, /fr, /fr/about) take their language from the URL:
// they set a page override (usePageLocale), which wins while they're mounted.

interface LocaleContextValue {
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

const LocaleContext = createContext<LocaleContextValue | null>(null)

function writeCookie(locale: Locale) {
  try {
    document.cookie = localeCookie(locale)
  } catch {
    // cookies blocked — the in-memory choice still applies for this visit
  }
}

export function LocaleProvider({ children }: { children: React.ReactNode }) {
  const { isAuthenticated } = useAuth()
  const { data: currentUser } = useCurrentUser({ enabled: isAuthenticated })
  const updateUser = useUpdateCurrentUser()

  // Read once on mount; Providers renders client-only, so document exists.
  const [cookie, setCookie] = useState<Locale | null>(() => readLocaleCookie(document.cookie))
  const [query] = useState<Locale | null>(() => {
    const lang = new URLSearchParams(window.location.search).get('lang')
    return isLocale(lang) ? lang : null
  })
  const [brief, setBriefLanguage] = useState<Locale | null>(null)
  const [pageLocale, setPageLocale] = useState<Locale | null>(null)
  const userLocale = isAuthenticated ? (currentUser?.locale ?? null) : null

  const preferredLocale = resolveLocale({ query, user: userLocale, cookie, brief })
  const locale = pageLocale ?? preferredLocale

  // An explicit ?lang= link sticks for later visits.
  useEffect(() => {
    if (query) {
      writeCookie(query)
      setCookie(query)
    }
  }, [query])

  // Keep the cookie in step with the saved profile, so signed-out pages on this
  // device (sign-in after a session expires) stay in the same language.
  useEffect(() => {
    if (userLocale && userLocale !== cookie) {
      writeCookie(userLocale)
      setCookie(userLocale)
    }
  }, [userLocale, cookie])

  useEffect(() => {
    document.documentElement.lang = locale
  }, [locale])

  const rememberLocale = useCallback((next: Locale) => {
    writeCookie(next)
    setCookie(next)
  }, [])

  const { mutate: saveProfile } = updateUser
  const setLocale = useCallback(
    (next: Locale) => {
      rememberLocale(next)
      if (isAuthenticated) saveProfile({ locale: next })
    },
    [rememberLocale, isAuthenticated, saveProfile]
  )

  const value = useMemo(
    () => ({ locale, preferredLocale, setLocale, rememberLocale, setBriefLanguage, setPageLocale }),
    [locale, preferredLocale, setLocale, rememberLocale]
  )
  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>
}

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
