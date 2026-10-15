'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useAuth } from '@/lib/hooks/useAuth'
import { useCurrentUser, useUpdateCurrentUser } from '@/lib/query/hooks'
import { localeCookie, readLocaleCookie, resolveLocale } from '@/lib/locale-preference'
import { isLocale, type Locale } from '@/lib/locale'
import { LocaleContext } from '@/components/locale-context'

// The viewer's language for maker-facing screens. See lib/locale-preference.ts
// for the resolution order (?lang= → saved profile → cookie → brief → English).
// Public pages (/, /about, /fr, /fr/about) take their language from the URL:
// they set a page override (usePageLocale), which wins while they're mounted.


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

